const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { getSchoolLogo } = require('../logo');
const { generate, fromDocument, translate } = require('../peda/ai');
const { noDash } = require('../peda/text');
const { teacherReply, adminReassign } = require('../review');
const { layoutDocument } = require('../peda/layout');
const { renderPdf } = require('../peda/renderPdf');
const { renderDocx } = require('../peda/renderDocx');

const router = express.Router();
router.use(requireAuth);

const TYPES = ['apprentissages', 'guide'];
const LANGS = ['fr', 'es', 'en'];
const t = v => noDash(v).trim();
const slug = s => String(s == null ? '' : s).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const langOf = v => (LANGS.includes(v) ? v : 'fr');

/** Texte libre (cellules du tableau) : on garde les lignes vides et les retraits voulus. */
const free = (v, max = 4000) => noDash(v).replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/[ \t]+$/gm, '').replace(/\s+$/, '').slice(0, max);

/** Vérifie et nettoie les données d'un document reçu du navigateur. */
function cleanDoc(type, data) {
  if (!TYPES.includes(type)) throw new Error('Type de document inconnu.');
  if (!data || typeof data !== 'object') throw new Error('Document vide.');
  const info = data.info && typeof data.info === 'object' ? data.info : {};
  const items = Array.isArray(data.items) ? data.items.slice(0, 300) : [];
  const str = (o, k) => t(o[k]).slice(0, 2000);
  const cleanTr = tr => {
    const out = {};
    if (!tr || typeof tr !== 'object') return out;
    ['es', 'en'].forEach(l => {
      const x = tr[l]; if (!x || typeof x !== 'object') return;
      const o = {}; ['nom', 'texte', 'savoir', 'savoirFaire', 'resLibre'].forEach(f => { if (x[f] != null && String(x[f]).trim()) o[f] = free(x[f]); });
      if (Object.keys(o).length) out[l] = o;
    });
    return out;
  };
  const trInfo = {};
  if (data.trInfo && typeof data.trInfo === 'object') ['es', 'en'].forEach(l => {
    const x = data.trInfo[l]; if (!x || typeof x !== 'object') return;
    const o = {}; ['matiere', 'classe', 'section', 'periode', 'examenLabel'].forEach(k => { if (t(x[k])) o[k] = t(x[k]).slice(0, 300); });
    if (Object.keys(o).length) trInfo[l] = o;
  });
  return {
    presentation: data.presentation === 'liste' ? 'liste' : 'tableau',
    info: {
      etablissement: 'Collège Albert Camus', matiere: str(info, 'matiere'), annee: str(info, 'annee'), section: str(info, 'section'), classe: str(info, 'classe'),
      groupe: str(info, 'groupe'), periode: str(info, 'periode'), enseignant: str(info, 'enseignant'), niveauLinguistique: str(info, 'niveauLinguistique'), examenLabel: str(info, 'examenLabel'),
    },
    trInfo,
    items: items.map(it => ({
      id: str(it, 'id') || Math.random().toString(36).slice(2, 10), categorie: str(it, 'categorie'), nom: free(it.nom, 2000), indication: str(it, 'indication'),
      texte: free(it.texte), savoir: free(it.savoir), savoirFaire: free(it.savoirFaire), resLibre: free(it.resLibre), manuel: !!it.manuel, tr: cleanTr(it.tr),
      ressources: (Array.isArray(it.ressources) ? it.ressources : []).slice(0, 30).map(r => ({
        id: str(r, 'id'), type: str(r, 'type'), titre: str(r, 'titre'), chapitre: str(r, 'chapitre'), debut: str(r, 'debut'), fin: str(r, 'fin'), url: str(r, 'url'), commentaire: str(r, 'commentaire'),
      })),
    })),
  };
}

function defaultTitle(type, info) {
  return [type === 'guide' ? 'Guide de révision' : 'Apprentissages attendus', info.matiere, info.classe, info.periode, info.annee].map(t).filter(Boolean).join(', ');
}
const asgShape = (a, names) => ({ id: a.id, teacherId: a.teacherId, teacherName: (names && names.get(a.teacherId)) || '(compte supprimé)', assignedAt: a.assignedAt, reviewStatus: a.reviewStatus, reviewNotes: Array.isArray(a.reviewNotes) ? a.reviewNotes : [] });
const shape = (d, assignees) => ({ id: d.id, type: d.type, titre: d.titre, data: d.data, createdAt: d.createdAt, updatedAt: d.updatedAt, assignees: assignees || [] });

async function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  const users = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return new Map(users.map(u => [u.id, u.name]));
}
/** Migration douce : l'ancienne assignation à un seul professeur devient une PedaAssignment. */
async function migrateLegacy(docs) {
  for (const d of docs) {
    if (!d.teacherId) continue;
    try {
      const exists = await prisma.pedaAssignment.findFirst({ where: { docId: d.id, teacherId: d.teacherId } });
      if (!exists) await prisma.pedaAssignment.create({ data: { docId: d.id, teacherId: d.teacherId, assignedAt: d.assignedAt || new Date(), reviewStatus: d.reviewStatus || 'assigné', reviewNotes: Array.isArray(d.reviewNotes) ? d.reviewNotes : [] } });
      await prisma.pedaDocument.update({ where: { id: d.id }, data: { teacherId: null, assignedAt: null, reviewStatus: '', reviewNotes: [] } });
      d.teacherId = null;
    } catch (e) { console.error('Migration assignation :', e.message); }
  }
}

/* ---------- Espace professeur : documents qui lui sont assignés (version parents seulement) ---------- */
async function assignedToMe(req, res) {
  const asg = await prisma.pedaAssignment.findFirst({ where: { docId: req.params.id, teacherId: req.user.sub } });
  const doc = asg ? await prisma.pedaDocument.findUnique({ where: { id: req.params.id } }) : null;
  if (!doc) { res.status(404).json({ error: 'Document introuvable.' }); return null; }
  return { doc, asg };
}
router.get('/assignes', async (req, res) => {
  const asgs = await prisma.pedaAssignment.findMany({ where: { teacherId: req.user.sub }, orderBy: { assignedAt: 'desc' } });
  const out = [];
  for (const a of asgs) {
    const d = await prisma.pedaDocument.findUnique({ where: { id: a.docId } });
    if (d) out.push({ ...shape(d, []), assignmentId: a.id, reviewStatus: a.reviewStatus, reviewNotes: Array.isArray(a.reviewNotes) ? a.reviewNotes : [], assignedAt: a.assignedAt });
  }
  res.json(out);
});
router.get('/assignes/:id/apercu', async (req, res) => {
  const x = await assignedToMe(req, res); if (!x) return;
  const logo = await getSchoolLogo();
  res.json({ layout: await layoutDocument({ type: x.doc.type, data: x.doc.data, lang: langOf(req.query.lang) }, 'parents'), logoId: logo ? logo.id : null });
});
router.get('/assignes/:id/pdf', async (req, res) => {
  const x = await assignedToMe(req, res); if (!x) return;
  const lang = langOf(req.query.lang), info = x.doc.data.info || {};
  const logo = await getSchoolLogo();
  const buf = await renderPdf(await layoutDocument({ type: x.doc.type, data: x.doc.data, lang }, 'parents'), logo);
  const name = ['Camus', x.doc.type === 'guide' ? 'guide_revision' : 'apprentissages', slug(info.matiere), slug(info.classe), slug(info.periode), 'parents', lang === 'fr' ? '' : lang].filter(Boolean).join('_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
  res.send(buf);
});
router.post('/assignes/:id/revue', async (req, res) => {
  const x = await assignedToMe(req, res); if (!x) return;
  const r = teacherReply(x.asg.reviewNotes, req.body.action, req.body.note);
  if (r.error) return res.status(400).json({ error: r.error });
  const a = await prisma.pedaAssignment.update({ where: { id: x.asg.id }, data: r });
  res.json({ ...shape(x.doc, []), assignmentId: a.id, reviewStatus: a.reviewStatus, reviewNotes: a.reviewNotes });
});

router.use(requireRole('ADMIN')); // tout ce qui suit est réservé à l'administrateur

/** Document de l'administrateur connecté. */
async function mine(req, res) {
  const doc = await prisma.pedaDocument.findUnique({ where: { id: req.params.id } });
  if (!doc || doc.userId !== req.user.sub) { res.status(404).json({ error: 'Document introuvable.' }); return null; }
  return doc;
}
async function withAssignees(docs) {
  const ids = docs.map(d => d.id);
  const asgs = ids.length ? await prisma.pedaAssignment.findMany({ where: { docId: { in: ids } }, orderBy: { assignedAt: 'asc' } }) : [];
  const names = await namesOf(asgs.map(a => a.teacherId));
  return docs.map(d => shape(d, asgs.filter(a => a.docId === d.id).map(a => asgShape(a, names))));
}

/* ---------- Mes documents ---------- */
router.get('/documents', async (req, res) => {
  const where = { userId: req.user.sub, ...(TYPES.includes(req.query.type) ? { type: req.query.type } : {}) };
  const docs = await prisma.pedaDocument.findMany({ where, orderBy: { updatedAt: 'desc' } });
  await migrateLegacy(docs);
  res.json(await withAssignees(docs));
});

router.post('/documents', async (req, res) => {
  try {
    const type = t(req.body.type), data = cleanDoc(type, req.body.data);
    const doc = await prisma.pedaDocument.create({ data: { userId: req.user.sub, type, titre: t(req.body.titre) || defaultTitle(type, data.info), data } });
    res.status(201).json(shape(doc));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/documents/:id', async (req, res) => { const d = await mine(req, res); if (d) res.json((await withAssignees([d]))[0]); });

router.put('/documents/:id', async (req, res) => {
  const d = await mine(req, res); if (!d) return;
  try {
    const data = cleanDoc(d.type, req.body.data);
    const upd = await prisma.pedaDocument.update({ where: { id: d.id }, data: { titre: t(req.body.titre) || defaultTitle(d.type, data.info), data } });
    res.json((await withAssignees([upd]))[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Assigner à un ou plusieurs professeurs. La liste envoyée est la liste finale : on ajoute les nouveaux,
// on retire ceux qui ne sont plus cochés, et ceux qui avaient demandé des corrections sont invités à relire.
router.post('/documents/:id/assigner', async (req, res) => {
  const d = await mine(req, res); if (!d) return;
  const wanted = [...new Set((Array.isArray(req.body.teacherIds) ? req.body.teacherIds : [req.body.teacherId]).map(x => t(x)).filter(Boolean))];
  const teachers = wanted.length ? await prisma.user.findMany({ where: { id: { in: wanted } } }) : [];
  const valid = teachers.filter(u => u.role === 'TEACHER').map(u => u.id);
  if (wanted.length && valid.length !== wanted.length) return res.status(404).json({ error: 'Professeur introuvable.' });
  const note = t(req.body.note);
  const resend = new Set((Array.isArray(req.body.resend) ? req.body.resend : []).map(String));
  const current = await prisma.pedaAssignment.findMany({ where: { docId: d.id } });
  for (const a of current) {
    if (!valid.includes(a.teacherId)) { await prisma.pedaAssignment.delete({ where: { id: a.id } }); continue; }
    // Seuls ceux qui avaient demandé des corrections (ou qu'on invite explicitement) reçoivent une nouvelle relecture.
    if (a.reviewStatus === 'corrections' || resend.has(a.teacherId)) await prisma.pedaAssignment.update({ where: { id: a.id }, data: adminReassign(a.reviewStatus, a.reviewNotes, note) });
    else if (note && a.reviewStatus === 'assigné') await prisma.pedaAssignment.update({ where: { id: a.id }, data: { reviewNotes: [...(Array.isArray(a.reviewNotes) ? a.reviewNotes : []), { de: 'admin', texte: note, at: new Date().toISOString() }] } });
  }
  for (const id of valid) {
    if (current.some(a => a.teacherId === id)) continue;
    await prisma.pedaAssignment.create({ data: { docId: d.id, teacherId: id, reviewStatus: 'assigné', reviewNotes: note ? [{ de: 'admin', texte: note, at: new Date().toISOString() }] : [] } });
  }
  res.json((await withAssignees([d]))[0]);
});
router.post('/documents/:id/retirer-assignation', async (req, res) => {
  const d = await mine(req, res); if (!d) return;
  const where = { docId: d.id, ...(t(req.body.teacherId) ? { teacherId: t(req.body.teacherId) } : {}) };
  const list = await prisma.pedaAssignment.findMany({ where });
  for (const a of list) await prisma.pedaAssignment.delete({ where: { id: a.id } });
  res.json((await withAssignees([d]))[0]);
});

// Duplication : une copie totalement indépendante (la modifier ne change jamais l'original).
router.post('/documents/:id/duplicate', async (req, res) => {
  const d = await mine(req, res); if (!d) return;
  const copy = JSON.parse(JSON.stringify(d.data));
  res.status(201).json(shape(await prisma.pedaDocument.create({ data: { userId: req.user.sub, type: d.type, titre: `${d.titre} (copie)`, data: copy } })));
});

// Aucune suppression automatique : un document n'est supprimé que sur demande explicite (les assignations partent avec).
router.delete('/documents/:id', async (req, res) => {
  const d = await mine(req, res); if (!d) return;
  await prisma.pedaAssignment.deleteMany({ where: { docId: d.id } });
  await prisma.pedaDocument.delete({ where: { id: d.id } });
  res.json({ ok: true });
});

/* ---------- Rédaction par IA ---------- */
// POST /api/peda/generer { type, info, items:[{id, categorie, nom, indication?, savoir?, savoirFaire?}] }
router.post('/generer', async (req, res) => {
  const type = t(req.body.type);
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Type de document inconnu.' });
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 80).map(it => ({
    id: t(it.id), categorie: t(it.categorie), nom: t(it.nom).slice(0, 500), indication: t(it.indication).slice(0, 1000), savoir: t(it.savoir).slice(0, 1000), savoirFaire: t(it.savoirFaire).slice(0, 1000),
  })).filter(it => it.id);
  if (!items.length) return res.status(400).json({ error: 'Ajoutez au moins un contenu avant de générer.' });
  res.json(await generate(type, req.body.info || {}, items));
});

// POST /api/peda/traduire { info, items:[{id, nom, texte, savoir, savoirFaire}], langs:['es','en'] }
router.post('/traduire', async (req, res) => {
  const langs = (Array.isArray(req.body.langs) ? req.body.langs : []).filter(l => l === 'es' || l === 'en');
  if (!langs.length) return res.status(400).json({ error: 'Choisissez au moins une langue.' });
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 80).map(it => ({ id: t(it.id), nom: free(it.nom, 600), texte: free(it.texte, 1500), savoir: free(it.savoir, 1500), savoirFaire: free(it.savoirFaire, 1500) })).filter(it => it.id);
  if (!items.length) return res.status(400).json({ error: 'Rien à traduire.' });
  try { res.json(await translate(items, req.body.info || {}, langs)); }
  catch (e) { res.status(e.status || 502).json({ error: e.status === 503 ? e.message : "La traduction n'a pas abouti. Réessayez dans un instant." }); }
});

// POST /api/peda/depuis-document { type, info, text, categories } : l'IA prépare les contenus à partir d'un document Word ou PDF.
router.post('/depuis-document', async (req, res) => {
  const type = t(req.body.type);
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Type de document inconnu.' });
  const text = String(req.body.text || '').slice(0, 60000);
  if (text.trim().length < 10) return res.status(400).json({ error: 'Le document ne contient pas de texte lisible.' });
  const cats = (Array.isArray(req.body.categories) ? req.body.categories : []).map(t).filter(Boolean).slice(0, 40);
  const r = await fromDocument(type, req.body.info || {}, text, cats);
  res.json({ ...r, items: r.items.map(it => ({ id: Math.random().toString(36).slice(2, 10), ...it })) });
});

/* ---------- Aperçu et téléchargements ---------- */
async function prepare(req) {
  const type = t(req.body.type), data = cleanDoc(type, req.body.data);
  const version = req.body.version === 'eleves' ? 'eleves' : 'parents';
  const lang = langOf(req.body.lang);
  const layout = await layoutDocument({ type, data, lang }, version);
  return { type, data, version, lang, layout };
}

router.post('/apercu', async (req, res) => {
  try {
    const { layout } = await prepare(req);
    const logo = await getSchoolLogo();
    res.json({ layout, logoId: logo ? logo.id : null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/exporter', async (req, res) => {
  try {
    const { type, data, version, lang, layout } = await prepare(req);
    const logo = await getSchoolLogo();
    const format = req.body.format === 'docx' ? 'docx' : 'pdf';
    const name = ['Camus', type === 'guide' ? 'guide_revision' : 'apprentissages', slug(data.info.matiere), slug(data.info.classe), slug(data.info.periode), version === 'eleves' ? 'eleves' : 'parents', lang === 'fr' ? '' : lang].filter(Boolean).join('_');
    const buf = format === 'pdf' ? await renderPdf(layout, logo) : await renderDocx(layout, logo);
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.${format}"`);
    res.send(buf);
  } catch (e) { console.error('Export peda :', e); res.status(500).json({ error: "L'export a échoué." }); }
});

module.exports = router;
