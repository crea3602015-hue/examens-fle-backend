const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN')); // module strictement réservé à l'administrateur

const TYPES = ['guide', 'examen', 'projet'];
const KINDS = { section: null, classe: 'section', groupe: 'classe' }; // type -> type du parent attendu

const clean = v => String(v == null ? '' : v).trim();

/** Prochain rang d'ordre dans une liste (à la fin). */
async function nextOrdre(model, where = {}) {
  const last = await prisma[model].findFirst({ where, orderBy: { ordre: 'desc' }, select: { ordre: true } });
  return last ? last.ordre + 1 : 0;
}

/** Échange le rang d'un élément avec son voisin (haut/bas) parmi ses frères. */
async function move(model, id, dir, where = {}) {
  const siblings = await prisma[model].findMany({ where, orderBy: [{ ordre: 'asc' }, { id: 'asc' }] });
  const i = siblings.findIndex(s => s.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= siblings.length) return;
  // On renumérote proprement pour éviter les égalités de rang.
  const arr = siblings.map(s => s.id);
  [arr[i], arr[j]] = [arr[j], arr[i]];
  await prisma.$transaction(arr.map((sid, idx) => prisma[model].update({ where: { id: sid }, data: { ordre: idx } })));
}

/** Supprime les statuts et l'historique liés à des groupes/classes supprimés. */
async function purgeLeaves(ids) {
  if (!ids.length) return;
  await prisma.suiviStatus.deleteMany({ where: { leafId: { in: ids } } });
  await prisma.suiviHistory.deleteMany({ where: { leafId: { in: ids } } });
}

// GET /api/suivi/structure — tout ce qu'il faut pour afficher le module
router.get('/structure', async (req, res) => {
  const [years, nodes, matieres, niveaux] = await Promise.all([
    prisma.suiviYear.findMany({ orderBy: { label: 'asc' } }),
    prisma.suiviNode.findMany({ orderBy: [{ ordre: 'asc' }, { createdAt: 'asc' }] }),
    prisma.suiviMatiere.findMany({ orderBy: [{ ordre: 'asc' }, { id: 'asc' }] }),
    prisma.suiviNiveau.findMany({ orderBy: [{ ordre: 'asc' }, { id: 'asc' }] }),
  ]);
  res.json({ years, nodes, matieres, niveaux });
});

/* ---------- Sections / classes / groupes ---------- */
router.post('/nodes', async (req, res) => {
  const kind = clean(req.body.kind), nom = clean(req.body.nom), parentId = req.body.parentId || null;
  if (!(kind in KINDS)) return res.status(400).json({ error: 'Type de niveau de structure inconnu.' });
  if (!nom) return res.status(400).json({ error: 'Écrivez un nom.' });
  const expected = KINDS[kind];
  if (expected === null && parentId) return res.status(400).json({ error: 'Une section n\'a pas de parent.' });
  if (expected !== null) {
    const parent = parentId ? await prisma.suiviNode.findUnique({ where: { id: parentId } }) : null;
    if (!parent || parent.kind !== expected) return res.status(400).json({ error: `Une ${kind === 'classe' ? 'classe' : 'groupe'} doit être créé${kind === 'classe' ? 'e' : ''} dans ${expected === 'section' ? 'une section' : 'une classe'}.` });
  }
  const dup = await prisma.suiviNode.findFirst({ where: { parentId, kind, nom } });
  if (dup) return res.status(409).json({ error: `« ${nom} » existe déjà à cet endroit.` });
  const node = await prisma.suiviNode.create({ data: { parentId, kind, nom, ordre: await nextOrdre('suiviNode', { parentId, kind }) } });
  res.status(201).json(node);
});

router.put('/nodes/:id', async (req, res) => {
  const node = await prisma.suiviNode.findUnique({ where: { id: req.params.id } });
  if (!node) return res.status(404).json({ error: 'Introuvable.' });
  const data = {};
  if (req.body.nom !== undefined) {
    const nom = clean(req.body.nom);
    if (!nom) return res.status(400).json({ error: 'Le nom ne peut pas être vide.' });
    const dup = await prisma.suiviNode.findFirst({ where: { parentId: node.parentId, kind: node.kind, nom, NOT: { id: node.id } } });
    if (dup) return res.status(409).json({ error: `« ${nom} » existe déjà à cet endroit.` });
    data.nom = nom;
  }
  if (req.body.niveau !== undefined) data.niveau = clean(req.body.niveau) || null;
  if (req.body.matieres !== undefined) {
    if (node.kind !== 'section') return res.status(400).json({ error: 'Les matières se choisissent au niveau de la section.' });
    const ids = (Array.isArray(req.body.matieres) ? req.body.matieres : []).map(String);
    const ok = await prisma.suiviMatiere.findMany({ where: { id: { in: ids } }, select: { id: true } });
    data.matieres = ok.map(m => m.id);
  }
  res.json(await prisma.suiviNode.update({ where: { id: node.id }, data }));
});

router.post('/nodes/:id/move', async (req, res) => {
  const node = await prisma.suiviNode.findUnique({ where: { id: req.params.id } });
  if (!node) return res.status(404).json({ error: 'Introuvable.' });
  await move('suiviNode', node.id, req.body.dir === 'up' ? 'up' : 'down', { parentId: node.parentId, kind: node.kind });
  res.json({ ok: true });
});

router.delete('/nodes/:id', async (req, res) => {
  const node = await prisma.suiviNode.findUnique({ where: { id: req.params.id } });
  if (!node) return res.status(404).json({ error: 'Introuvable.' });
  // On collecte l'élément et tous ses descendants.
  const all = await prisma.suiviNode.findMany();
  const ids = []; const walk = id => { ids.push(id); all.filter(n => n.parentId === id).forEach(n => walk(n.id)); };
  walk(node.id);
  await purgeLeaves(ids);
  await prisma.suiviNode.deleteMany({ where: { id: { in: ids } } });
  await logAction('Suivi — structure supprimée', `${node.kind} « ${node.nom} »`);
  res.json({ ok: true, removed: ids.length });
});

/* ---------- Matières et niveaux (même logique) ---------- */
function listRoutes(path, model, label) {
  router.post(path, async (req, res) => {
    const nom = clean(req.body.nom);
    if (!nom) return res.status(400).json({ error: 'Écrivez un nom.' });
    if (await prisma[model].findFirst({ where: { nom } })) return res.status(409).json({ error: `« ${nom} » existe déjà.` });
    res.status(201).json(await prisma[model].create({ data: { nom, ordre: await nextOrdre(model) } }));
  });
  router.put(`${path}/:id`, async (req, res) => {
    const nom = clean(req.body.nom);
    if (!nom) return res.status(400).json({ error: 'Le nom ne peut pas être vide.' });
    const dup = await prisma[model].findFirst({ where: { nom, NOT: { id: req.params.id } } });
    if (dup) return res.status(409).json({ error: `« ${nom} » existe déjà.` });
    const before = await prisma[model].findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Introuvable.' });
    const item = await prisma[model].update({ where: { id: req.params.id }, data: { nom } });
    // Un niveau renommé doit rester associé à ses groupes.
    if (model === 'suiviNiveau') await prisma.suiviNode.updateMany({ where: { niveau: before.nom }, data: { niveau: nom } });
    res.json(item);
  });
  router.post(`${path}/:id/move`, async (req, res) => {
    await move(model, req.params.id, req.body.dir === 'up' ? 'up' : 'down');
    res.json({ ok: true });
  });
  router.delete(`${path}/:id`, async (req, res) => {
    const item = await prisma[model].findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Introuvable.' });
    if (model === 'suiviMatiere') {
      await prisma.suiviStatus.deleteMany({ where: { matiereId: item.id } });
      await prisma.suiviHistory.deleteMany({ where: { matiereId: item.id } });
    } else {
      await prisma.suiviNode.updateMany({ where: { niveau: item.nom }, data: { niveau: null } });
    }
    await prisma[model].delete({ where: { id: item.id } });
    await logAction(`Suivi — ${label} supprimé(e)`, item.nom);
    res.json({ ok: true });
  });
}
listRoutes('/matieres', 'suiviMatiere', 'matière');
listRoutes('/niveaux', 'suiviNiveau', 'niveau');

/* ---------- Années scolaires ---------- */
router.post('/years', async (req, res) => {
  const label = clean(req.body.label);
  if (!label) return res.status(400).json({ error: 'Écrivez l\'année scolaire (ex. 2026-2027).' });
  if (await prisma.suiviYear.findUnique({ where: { label } })) return res.status(409).json({ error: 'Cette année existe déjà.' });
  res.status(201).json(await prisma.suiviYear.create({ data: { label } }));
});
router.delete('/years/:id', async (req, res) => {
  const y = await prisma.suiviYear.findUnique({ where: { id: req.params.id } });
  if (!y) return res.status(404).json({ error: 'Introuvable.' });
  await prisma.suiviStatus.deleteMany({ where: { annee: y.label } });
  await prisma.suiviHistory.deleteMany({ where: { annee: y.label } });
  await prisma.suiviYear.delete({ where: { id: y.id } });
  await logAction('Suivi — année supprimée', y.label);
  res.json({ ok: true });
});

/* ---------- Statuts ---------- */
// GET /api/suivi/statuts?annee=2026-2027&trimestre=1
router.get('/statuts', async (req, res) => {
  const annee = clean(req.query.annee), trimestre = Number(req.query.trimestre);
  if (!annee || ![1, 2, 3].includes(trimestre)) return res.status(400).json({ error: 'Année et trimestre requis.' });
  res.json(await prisma.suiviStatus.findMany({ where: { annee, trimestre } }));
});

// PUT /api/suivi/statut { annee, trimestre, type, leafId, matiereId, statut } — chaque statut est indépendant
router.put('/statut', async (req, res) => {
  const annee = clean(req.body.annee), trimestre = Number(req.body.trimestre), type = clean(req.body.type);
  const leafId = clean(req.body.leafId), matiereId = clean(req.body.matiereId), statut = Number(req.body.statut);
  if (!annee || ![1, 2, 3].includes(trimestre) || !TYPES.includes(type) || !leafId || !matiereId || !Number.isInteger(statut) || statut < 0 || statut > 7) {
    return res.status(400).json({ error: 'Données de statut invalides.' });
  }
  const [leaf, matiere] = await Promise.all([
    prisma.suiviNode.findUnique({ where: { id: leafId } }), prisma.suiviMatiere.findUnique({ where: { id: matiereId } }),
  ]);
  if (!leaf || leaf.kind === 'section' || !matiere) return res.status(404).json({ error: 'Groupe ou matière introuvable.' });

  const key = { annee, trimestre, type, leafId, matiereId };
  const current = await prisma.suiviStatus.findUnique({ where: { annee_trimestre_type_leafId_matiereId: key } });
  if (current ? current.statut === statut : statut === 0) return res.json(current || { ...key, statut: 0 }); // rien à changer
  const row = await prisma.suiviStatus.upsert({
    where: { annee_trimestre_type_leafId_matiereId: key }, create: { ...key, statut }, update: { statut },
  });
  await prisma.suiviHistory.create({ data: { ...key, statut, par: req.user.name || req.user.email || null } });
  res.json(row);
});

// GET /api/suivi/historique?annee&trimestre&type&leafId&matiereId
router.get('/historique', async (req, res) => {
  const where = {
    annee: clean(req.query.annee), trimestre: Number(req.query.trimestre), type: clean(req.query.type),
    leafId: clean(req.query.leafId), matiereId: clean(req.query.matiereId),
  };
  res.json(await prisma.suiviHistory.findMany({ where, orderBy: { at: 'asc' } }));
});

// POST /api/suivi/matieres-habituelles — Préscolaire : français + mathématiques ; Primaire : français + sciences ; Secondaire : français seulement.
router.post('/matieres-habituelles', async (req, res) => {
  const fold = x => clean(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rules = { prescolaire: ['Français', 'Mathématiques'], primaire: ['Français', 'Sciences'], secondaire: ['Français'] };
  const sections = await prisma.suiviNode.findMany({ where: { kind: 'section' } });
  const concerned = sections.filter(sec => rules[fold(sec.nom)]);
  if (!concerned.length) return res.status(404).json({ error: 'Aucune section nommée Préscolaire, Primaire ou Secondaire.' });
  const byName = async nom => {
    const all = await prisma.suiviMatiere.findMany();
    const found = all.find(m => fold(m.nom) === fold(nom));
    return found || prisma.suiviMatiere.create({ data: { nom, ordre: await nextOrdre('suiviMatiere') } });
  };
  for (const sec of concerned) {
    const ids = [];
    for (const nom of rules[fold(sec.nom)]) ids.push((await byName(nom)).id);
    await prisma.suiviNode.update({ where: { id: sec.id }, data: { matieres: ids } });
  }
  res.json({ ok: true, sections: concerned.length });
});

// POST /api/suivi/modele — structure type facultative (n'est jamais imposée : l'administrateur la modifie librement)
router.post('/modele', async (req, res) => {
  if (await prisma.suiviNode.count()) return res.status(409).json({ error: 'La structure contient déjà des éléments.' });
  const add = (parentId, kind, nom, ordre) => prisma.suiviNode.create({ data: { parentId, kind, nom, ordre } });
  const pre = await add(null, 'section', 'Préscolaire', 0), pri = await add(null, 'section', 'Primaire', 1), sec = await add(null, 'section', 'Secondaire', 2);
  for (const [i, n] of ['Petite section', 'Moyenne section', 'Grande section'].entries()) await add(pre.id, 'classe', n, i);
  for (const [i, n] of ['1re année', '2e année', '3e année', '4e année', '5e année', '6e année'].entries()) await add(pri.id, 'classe', n, i);
  for (const [i, n] of ['1re secondaire', '2e secondaire', '3e secondaire'].entries()) await add(sec.id, 'classe', n, i);
  if (!(await prisma.suiviMatiere.count())) { for (const [i, n] of ['Français', 'Sciences', 'Mathématiques'].entries()) await prisma.suiviMatiere.create({ data: { nom: n, ordre: i } }); }
  const mats = await prisma.suiviMatiere.findMany(), idOf = n => (mats.find(m => m.nom === n) || {}).id;
  const setM = (sec, names) => prisma.suiviNode.update({ where: { id: sec.id }, data: { matieres: names.map(idOf).filter(Boolean) } });
  await setM(pre, ['Français', 'Mathématiques']); await setM(pri, ['Français', 'Sciences']); await setM(sec, ['Français']);
  if (!(await prisma.suiviNiveau.count())) for (const [i, n] of ['A1', 'A2', 'B1', 'B1+', 'B2', 'B2+'].entries()) await prisma.suiviNiveau.create({ data: { nom: n, ordre: i } });
  res.json({ ok: true });
});

module.exports = router;
