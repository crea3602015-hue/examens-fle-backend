const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();
router.use(requireAuth);

function shape(p, assignedCount) {
  return {
    id: p.id, titre: p.titre, description: p.description, niveau: p.niveau, matiere: p.matiere,
    statut: p.statut, media: p.media, criteria: p.criteria, maxTotal: (p.criteria || []).reduce((s, c) => s + Number(c.points || 0), 0),
    assignedCount: assignedCount || 0, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

// GET /api/projects — admin: tout ; professeur: uniquement ses projets assignés
router.get('/', async (req, res) => {
  if (req.user.role === 'ADMIN') {
    const projects = await prisma.project.findMany({ include: { _count: { select: { assignments: true } } }, orderBy: { createdAt: 'desc' } });
    return res.json(projects.map(p => shape(p, p._count.assignments)));
  }
  const assignments = await prisma.projectAssignment.findMany({ where: { teacherId: req.user.sub }, include: { project: true } });
  const seen = new Set(); const projects = [];
  assignments.forEach(a => { if (seen.has(a.projectId)) return; seen.add(a.projectId); projects.push(shape(a.project)); });
  res.json(projects);
});

// GET /api/projects/:id
router.get('/:id', async (req, res) => {
  const p = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'Projet introuvable.' });
  if (req.user.role !== 'ADMIN') {
    const has = await prisma.projectAssignment.count({ where: { projectId: p.id, teacherId: req.user.sub } });
    if (!has) return res.status(403).json({ error: "Ce projet ne vous est pas assigné." });
  }
  res.json(shape(p));
});

router.use(requireRole('ADMIN'));

// POST /api/projects
router.post('/', async (req, res) => {
  const { titre, description, niveau, matiere, statut, media, criteria } = req.body || {};
  if (!titre || !Array.isArray(criteria) || criteria.length === 0) {
    return res.status(400).json({ error: 'Titre et au moins un critère sont requis.' });
  }
  const p = await prisma.project.create({
    data: { titre, description, niveau: niveau || 'Primaire', matiere: matiere || 'Français', statut: statut || 'brouillon', media, criteria },
  });
  await logAction(p.statut === 'publié' ? 'Projet publié' : 'Projet enregistré en brouillon', p.titre);
  res.status(201).json(shape(p));
});

// PUT /api/projects/:id
router.put('/:id', async (req, res) => {
  const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Projet introuvable.' });
  const { titre, description, niveau, matiere, statut, media, criteria } = req.body || {};
  const p = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      titre: titre ?? existing.titre, description: description ?? existing.description,
      niveau: niveau ?? existing.niveau, matiere: matiere ?? existing.matiere, statut: statut ?? existing.statut,
      media: media ?? existing.media, criteria: criteria ?? existing.criteria,
    },
  });
  await logAction('Projet modifié', p.titre);
  res.json(shape(p));
});

// PATCH /api/projects/:id/archive
router.patch('/:id/archive', async (req, res) => {
  const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Projet introuvable.' });
  const statut = existing.statut === 'archivé' ? 'brouillon' : 'archivé';
  const p = await prisma.project.update({ where: { id: req.params.id }, data: { statut } });
  await logAction('Projet archivé/désarchivé', p.titre);
  res.json(shape(p));
});

// POST /api/projects/:id/duplicate
router.post('/:id/duplicate', async (req, res) => {
  const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Projet introuvable.' });
  const copy = await prisma.project.create({
    data: {
      titre: existing.titre + ' (copie)', description: existing.description, niveau: existing.niveau,
      matiere: existing.matiere, statut: 'brouillon', media: existing.media, criteria: existing.criteria,
    },
  });
  await logAction('Projet dupliqué', copy.titre);
  res.status(201).json(shape(copy));
});

// DELETE /api/projects/:id — refusé si des assignations avec des notes existent déjà
router.delete('/:id', async (req, res) => {
  const existing = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Projet introuvable.' });
  const entryCount = await prisma.projectEntry.count({ where: { assignment: { projectId: existing.id } } });
  if (entryCount > 0) {
    return res.status(409).json({ error: `Impossible de supprimer : ${entryCount} note(s) déjà enregistrée(s). Archivez-le plutôt.` });
  }
  await prisma.project.delete({ where: { id: existing.id } });
  await logAction('Projet supprimé', existing.titre);
  res.json({ ok: true });
});

module.exports = router;
