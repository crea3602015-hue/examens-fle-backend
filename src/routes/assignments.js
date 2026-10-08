const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');
const { examTotalPoints } = require('../grading');
const { teacherReply, adminReassign } = require('../review');

const router = express.Router();
router.use(requireAuth);

// GET /api/assignments — admin: tout ; professeur: les siennes
router.get('/', async (req, res) => {
  const where = req.user.role === 'ADMIN' ? {} : { teacherId: req.user.sub };
  const list = await prisma.assignment.findMany({
    where, include: { exam: true, teacher: { select: { id: true, name: true } } },
    orderBy: { id: 'desc' },
  });
  res.json(list.map(a => ({
    id: a.id, examId: a.examId, examTitre: a.exam?.titre, examNiveau: a.exam?.niveau,
    examDuree: a.exam?.duree, examSectionCount: a.exam?.sections?.length || 0,
    examTotalPoints: a.exam ? examTotalPoints(a.exam) : 0,
    teacherId: a.teacherId, teacherName: a.teacher?.name || '(compte supprimé)',
    classe: a.classe, groupe: a.groupe, reviewStatus: a.reviewStatus, reviewNotes: a.reviewNotes,
  })));
});

// POST /api/assignments/:id/revue { action:'valider'|'corrections', note } — le professeur concerné
router.post('/:id/revue', async (req, res) => {
  const a = await prisma.assignment.findUnique({ where: { id: req.params.id } });
  if (!a || a.teacherId !== req.user.sub) return res.status(404).json({ error: 'Assignation introuvable.' });
  const r = teacherReply(a.reviewNotes, req.body.action, req.body.note);
  if (r.error) return res.status(400).json({ error: r.error });
  await prisma.assignment.update({ where: { id: a.id }, data: r });
  res.json(r);
});

router.use(requireRole('ADMIN'));

// POST /api/assignments { examId, teacherId, classe, groupe }
router.post('/', async (req, res) => {
  const { examId, teacherId, classe, groupe } = req.body || {};
  if (!examId || !teacherId) return res.status(400).json({ error: 'Examen et professeur requis.' });
  const [exam, teacher] = await Promise.all([
    prisma.exam.findUnique({ where: { id: examId } }),
    prisma.user.findUnique({ where: { id: teacherId } }),
  ]);
  if (!exam) return res.status(404).json({ error: 'Examen introuvable.' });
  if (!teacher || teacher.role !== 'TEACHER') return res.status(404).json({ error: 'Professeur introuvable.' });

  const assignment = await prisma.assignment.create({ data: { examId, teacherId, classe, groupe } });
  await logAction('Examen assigné', `${exam.titre} → ${teacher.name}`);
  res.status(201).json({ id: assignment.id });
});

// POST /api/assignments/:id/reassigner { note } — après corrections
router.post('/:id/reassigner', async (req, res) => {
  const a = await prisma.assignment.findUnique({ where: { id: req.params.id } });
  if (!a) return res.status(404).json({ error: 'Assignation introuvable.' });
  const r = adminReassign(a.reviewStatus, a.reviewNotes, req.body.note);
  await prisma.assignment.update({ where: { id: a.id }, data: r });
  res.json(r);
});

// DELETE /api/assignments/:id
router.delete('/:id', async (req, res) => {
  await prisma.assignment.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
