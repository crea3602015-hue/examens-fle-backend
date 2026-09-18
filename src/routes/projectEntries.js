const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('TEACHER', 'ADMIN'));

function computeTotals(criteria, scores) {
  let total = 0, max = 0;
  criteria.forEach(c => {
    max += Number(c.points || 0);
    const v = scores[c.id];
    if (v !== undefined && v !== null && v !== '') total += Number(v);
  });
  const pct = max ? Math.round((100 * total) / max) : 0;
  return { total, max, pct };
}

async function assertOwnsAssignment(req, assignmentId) {
  const assignment = await prisma.projectAssignment.findUnique({ where: { id: assignmentId }, include: { project: true } });
  if (!assignment) return null;
  if (req.user.role !== 'ADMIN' && assignment.teacherId !== req.user.sub) return null;
  return assignment;
}

// GET /api/project-entries?assignmentId=...&projectId=...
router.get('/', async (req, res) => {
  const where = {};
  if (req.query.assignmentId) where.assignmentId = req.query.assignmentId;
  if (req.query.projectId) where.assignment = { projectId: req.query.projectId };
  if (req.user.role !== 'ADMIN') where.assignment = { ...(where.assignment || {}), teacherId: req.user.sub };

  const entries = await prisma.projectEntry.findMany({
    where, include: { assignment: { include: { project: true, teacher: { select: { name: true } } } } }, orderBy: { nom: 'asc' },
  });
  res.json(entries.map(e => ({
    id: e.id, nom: e.nom, classe: e.classe, groupe: e.groupe, scores: e.scores,
    total: e.total, max: e.max, pct: e.pct,
    projectId: e.assignment.projectId, projectTitre: e.assignment.project.titre, projectMatiere: e.assignment.project.matiere,
    criteria: e.assignment.project.criteria, teacherName: e.assignment.teacher?.name,
  })));
});

// POST /api/project-entries { assignmentId, nom, classe, groupe, scores } — crée ou met à jour (par nom)
router.post('/', async (req, res) => {
  const { assignmentId, nom, classe, groupe, scores } = req.body || {};
  if (!assignmentId || !nom) return res.status(400).json({ error: 'Assignation et nom sont requis.' });
  const assignment = await assertOwnsAssignment(req, assignmentId);
  if (!assignment) return res.status(404).json({ error: 'Assignation introuvable ou non autorisée.' });

  const { total, max, pct } = computeTotals(assignment.project.criteria, scores || {});
  const existing = await prisma.projectEntry.findFirst({ where: { assignmentId, nom: String(nom).trim() } });
  let entry;
  if (existing) {
    entry = await prisma.projectEntry.update({ where: { id: existing.id }, data: { classe, groupe, scores: scores || {}, total, max, pct } });
  } else {
    entry = await prisma.projectEntry.create({ data: { assignmentId, nom: String(nom).trim(), classe, groupe, scores: scores || {}, total, max, pct } });
  }
  await logAction('Note de projet enregistrée', `${nom} — ${assignment.project.titre}`);
  res.status(201).json({ id: entry.id, total, max, pct });
});

// DELETE /api/project-entries/:id
router.delete('/:id', async (req, res) => {
  const entry = await prisma.projectEntry.findUnique({ where: { id: req.params.id }, include: { assignment: true } });
  if (!entry) return res.status(404).json({ error: 'Introuvable.' });
  if (req.user.role !== 'ADMIN' && entry.assignment.teacherId !== req.user.sub) return res.status(403).json({ error: 'Non autorisé.' });
  await prisma.projectEntry.delete({ where: { id: entry.id } });
  res.json({ ok: true });
});

module.exports = router;
