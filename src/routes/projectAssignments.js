const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();
router.use(requireAuth);

// GET /api/project-assignments — admin: tout ; professeur: les siennes
router.get('/', async (req, res) => {
  const where = req.user.role === 'ADMIN' ? {} : { teacherId: req.user.sub };
  const list = await prisma.projectAssignment.findMany({
    where, include: { project: true, teacher: { select: { id: true, name: true } }, _count: { select: { entries: true } } },
    orderBy: { id: 'desc' },
  });
  res.json(list.map(a => ({
    id: a.id, projectId: a.projectId, projectTitre: a.project?.titre, projectNiveau: a.project?.niveau,
    teacherId: a.teacherId, teacherName: a.teacher?.name || '(compte supprimé)',
    classe: a.classe, groupe: a.groupe, entryCount: a._count.entries,
  })));
});

router.use(requireRole('ADMIN'));

// POST /api/project-assignments { projectId, teacherId, classe, groupe }
router.post('/', async (req, res) => {
  const { projectId, teacherId, classe, groupe } = req.body || {};
  if (!projectId || !teacherId) return res.status(400).json({ error: 'Projet et professeur requis.' });
  const [project, teacher] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.user.findUnique({ where: { id: teacherId } }),
  ]);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  if (!teacher) return res.status(404).json({ error: 'Professeur introuvable.' });

  const assignment = await prisma.projectAssignment.create({ data: { projectId, teacherId, classe, groupe } });
  await logAction('Projet assigné', `${project.titre} → ${teacher.name}`);
  res.status(201).json({ id: assignment.id });
});

// DELETE /api/project-assignments/:id
router.delete('/:id', async (req, res) => {
  await prisma.projectAssignment.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
