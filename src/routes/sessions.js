const express = require('express');
const { customAlphabet } = require('nanoid');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');
const { sanitizeExam } = require('../sanitizeExam');

const router = express.Router();
const genToken = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6); // sans caractères ambigus

// GET /api/sessions/by-token/:token — PUBLIC, utilisé par l'écran d'accès élève.
// Ne renvoie jamais les réponses correctes.
router.get('/by-token/:token', async (req, res) => {
  const session = await prisma.examSession.findUnique({
    where: { token: req.params.token.toUpperCase() },
    include: { exam: true },
  });
  if (!session) return res.status(404).json({ error: 'Code de session introuvable.' });
  res.json({
    sessionId: session.id,
    statut: session.statut,
    exam: sanitizeExam(session.exam),
  });
});

router.use(requireAuth);

// GET /api/sessions — admin: tout ; professeur: les siennes
router.get('/', async (req, res) => {
  const where = req.user.role === 'ADMIN' ? {} : { teacherId: req.user.sub };
  const sessions = await prisma.examSession.findMany({
    where,
    include: { exam: { select: { titre: true } }, teacher: { select: { name: true } }, _count: { select: { attempts: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(sessions.map(s => ({
    id: s.id, token: s.token, statut: s.statut, examId: s.examId, examTitre: s.exam?.titre,
    teacherName: s.teacher?.name || '(compte supprimé)', createdAt: s.createdAt,
    startedAt: s.startedAt, attemptCount: s._count.attempts,
  })));
});

// POST /api/sessions { assignmentId } — professeur "Préparer l'examen"
router.post('/', requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const { assignmentId } = req.body || {};
  if (!assignmentId) return res.status(400).json({ error: 'assignmentId requis.' });
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) return res.status(404).json({ error: 'Assignation introuvable.' });
  if (req.user.role !== 'ADMIN' && assignment.teacherId !== req.user.sub) {
    return res.status(403).json({ error: "Cette assignation n'est pas la vôtre." });
  }

  let token, exists = true;
  while (exists) {
    token = genToken();
    exists = await prisma.examSession.findUnique({ where: { token } });
  }

  const session = await prisma.examSession.create({
    data: { examId: assignment.examId, teacherId: assignment.teacherId, assignmentId: assignment.id, token, statut: 'préparé' },
  });
  await logAction('Session préparée', token);
  res.status(201).json({ id: session.id, token: session.token, statut: session.statut, examId: session.examId });
});

// POST /api/sessions/:id/start — professeur "Démarrer la session"
router.post('/:id/start', requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const session = await prisma.examSession.findUnique({ where: { id: req.params.id } });
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });
  if (req.user.role !== 'ADMIN' && session.teacherId !== req.user.sub) {
    return res.status(403).json({ error: "Cette session n'est pas la vôtre." });
  }
  const updated = await prisma.examSession.update({
    where: { id: session.id }, data: { statut: 'en_cours', startedAt: new Date() },
  });
  await logAction('Session démarrée', updated.token);
  res.json({ ok: true, statut: updated.statut });
});

// GET /api/sessions/:id/live — professeur suit en direct qui a commencé/terminé
router.get('/:id/live', requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const session = await prisma.examSession.findUnique({ where: { id: req.params.id } });
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });
  if (req.user.role !== 'ADMIN' && session.teacherId !== req.user.sub) {
    return res.status(403).json({ error: "Cette session n'est pas la vôtre." });
  }
  const attempts = await prisma.attempt.findMany({ where: { sessionId: session.id } });
  res.json({
    started: attempts.length,
    finished: attempts.filter(a => a.statut === 'soumis').length,
  });
});

module.exports = router;
