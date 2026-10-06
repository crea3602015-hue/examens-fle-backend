const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { getSchoolLogo } = require('../logo');
const { generate } = require('../peda/ai');
const { layoutDocument } = require('../peda/layout');
const { renderPdf } = require('../peda/renderPdf');
const { renderDocx } = require('../peda/renderDocx');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN')); // réservé à l'administrateur

const TYPES = ['apprentissages', 'guide'];
const t = v => String(v == null ? '' : v).trim();

/** Vérifie et nettoie les données d'un document reçu du navigateur. */
function cleanDoc(type, data) {
  if (!TYPES.includes(type)) throw new Error('Type de document inconnu.');
  if (!data || typeof data !== 'object') throw new Error('Document vide.');
  const info = data.info && typeof data.info === 'object' ? data.info : {};
  const items = Array.isArray(data.items) ? data.items.slice(0, 300) : [];
  const str = (o, k) => t(o[k]).slice(0, 2000);
  return {
    presentation: data.presentation === 'liste' ? 'liste' : 'tableau',
    info: {
      etablissement: 'Collège Albert Camus', matiere: str(info, 'matiere'), annee: str(info, 'annee'), section: str(info, 'section'), classe: str(info, 'classe'),
      groupe: str(info, 'groupe'), periode: str(info, 'periode'), enseignant: str(info, 'enseignant'), niveauLinguistique: str(info, 'niveauLinguistique'), examenLabel: str(info, 'examenLabel'),
    },
    items: items.map(it => ({
      id: str(it, 'id') || Math.random().toString(36).slice(2, 10), categorie: str(it, 'categorie'), nom: str(it, 'nom'), indication: str(it, 'indication'),
      texte: str(it, 'texte'), savoir: str(it, 'savoir'), savoirFaire: str(it, 'savoirFaire'), manuel: !!it.manuel,
      ressources: (Array.isArray(it.ressources) ? it.ressources : []).slice(0, 30).map(r => ({
        id: str(r, 'id'), type: str(r, 'type'), titre: str(r, 'titre'), chapitre: str(r, 'chapitre'), debut: str(r, 'debut'), fin: str(r, 'fin'), url: str(r, 'url'), commentaire: str(r, 'commentaire'),
      })),
    })),
  };
}

function defaultTitle(type, info) {
  return [type === 'guide' ? 'Guide de révision' : 'Apprentissages attendus', info.matiere, info.classe, info.periode, info.annee].map(t).filter(Boolean).join(' — ');
}
const shape = d => ({ id: d.id, type: d.type, titre: d.titre, data: d.data, createdAt: d.createdAt, updatedAt: d.updatedAt });

/* ---------- Mes documents ---------- */
router.get('/documents', async (req, res) => {
  const where = { userId: req.user.sub, ...(TYPES.includes(req.query.type) ? { type: req.query.type } : {}) };
  const docs = await prisma.pedaDocument.findMany({ where, orderBy: { updatedAt: 'desc' } });
  res.json(docs.map(shape));
});

router.post('/documents', async (req, res) => {
  try {
    const type = t(req.body.type), data = cleanDoc(type, req.body.data);
    const doc = await prisma.pedaDocument.create({ data: { userId: req.user.sub, type, titre: t(req.body.titre) || defaultTitle(type, data.info), data } });
    res.status(201).json(shape(doc));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

async function mine(req, res) {
  const doc = await prisma.pedaDocument.findUnique({ where: { id: req.params.id } });
  if (!doc || doc.userId !== req.user.sub) { res.status(404).json({ error: 'Document introuvable.' }); return null; }
  return doc;
}

router.get('/documents/:id', async (req, res) => { const d = await mine(req, res); if (d) res.json(shape(d)); });

router.put('/documents/:id', async (req, res) => {
  const d = await mine(req, res); if (!d) return;
  try {
    const data = cleanDoc(d.type, req.body.data);
    res.json(shape(await prisma.pedaDocument.update({ where: { id: d.id }, data: { titre: t(req.body.titre) || defaultTitle(d.type, data.info), data } })));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Duplication : une copie totalement indépendante (la modifier ne change jamais l'original).
router.post('/documents/:id/duplicate', async (req, res) => {
  const d = await mine(req, res); if (!d) return;
  const copy = JSON.parse(JSON.stringify(d.data));
  res.status(201).json(shape(await prisma.pedaDocument.create({ data: { userId: req.user.sub, type: d.type, titre: `${d.titre} (copie)`, data: copy } })));
});

// Aucune suppression automatique : un document n'est supprimé que sur demande explicite.
router.delete('/documents/:id', async (req, res) => {
  const d = await mine(req, res); if (!d) return;
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

/* ---------- Aperçu et téléchargements ---------- */
async function prepare(req) {
  const type = t(req.body.type), data = cleanDoc(type, req.body.data);
  const version = req.body.version === 'eleves' ? 'eleves' : 'parents';
  const layout = await layoutDocument({ type, data }, version);
  return { type, data, version, layout };
}

router.post('/apercu', async (req, res) => {
  try {
    const { layout } = await prepare(req);
    const logo = await getSchoolLogo();
    res.json({ layout, logoId: logo ? logo.id : null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const slug = s => t(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
router.post('/exporter', async (req, res) => {
  try {
    const { type, data, version, layout } = await prepare(req);
    const logo = await getSchoolLogo();
    const format = req.body.format === 'docx' ? 'docx' : 'pdf';
    const name = ['Camus', type === 'guide' ? 'guide_revision' : 'apprentissages', slug(data.info.matiere), slug(data.info.classe), slug(data.info.periode), version === 'eleves' ? 'eleves' : 'parents'].filter(Boolean).join('_');
    const buf = format === 'pdf' ? await renderPdf(layout, logo) : await renderDocx(layout, logo);
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.${format}"`);
    res.send(buf);
  } catch (e) { console.error('Export peda :', e); res.status(500).json({ error: "L'export a échoué." }); }
});

module.exports = router;
