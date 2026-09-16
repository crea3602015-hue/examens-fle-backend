const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');
const { computeResult } = require('../grading');

const router = express.Router();
router.use(requireAuth, requireRole('TEACHER', 'ADMIN'));

async function scopedSessionWhere(user, examId) {
  const where = { statut: 'soumis' };
  if (examId) where.session = { examId };
  if (user.role !== 'ADMIN') where.session = { ...(where.session || {}), teacherId: user.sub };
  return where;
}

// GET /api/results?examId=... — liste des copies soumises avec leur résultat courant
router.get('/', async (req, res) => {
  const where = await scopedSessionWhere(req.user, req.query.examId);
  const attempts = await prisma.attempt.findMany({
    where,
    include: { result: true, session: { include: { exam: true } } },
    orderBy: { submittedAt: 'desc' },
  });
  res.json(attempts.map(a => ({
    attemptId: a.id, nom: a.nom, classe: a.classe, groupe: a.groupe,
    examId: a.session.examId, examTitre: a.session.exam.titre, examMatiere: a.session.exam.matiere,
    examSections: a.session.exam.sections.map(s => ({ id: s.id, titre: s.titre, max: s.questions.reduce((sum, q) => sum + Number(q.points || 0), 0) })),
    submittedAt: a.submittedAt,
    sectionScores: a.result?.sectionScores ?? {},
    total: a.result?.total ?? null, max: a.result?.max ?? null, pct: a.result?.pct ?? null,
    manualPending: a.result?.manualPending ?? true, visibleEleve: a.result?.visibleEleve ?? false,
  })));
});

// GET /api/results/:attemptId — détail complet pour la fiche de correction
router.get('/:attemptId', async (req, res) => {
  const attempt = await prisma.attempt.findUnique({
    where: { id: req.params.attemptId },
    include: { result: true, session: { include: { exam: true } } },
  });
  if (!attempt) return res.status(404).json({ error: 'Copie introuvable.' });
  if (req.user.role !== 'ADMIN' && attempt.session.teacherId !== req.user.sub) {
    return res.status(403).json({ error: "Cette copie ne vous appartient pas." });
  }
  res.json({
    attempt: {
      id: attempt.id, nom: attempt.nom, classe: attempt.classe, groupe: attempt.groupe,
      reponses: attempt.reponses, submittedAt: attempt.submittedAt,
    },
    exam: attempt.session.exam,
    result: attempt.result,
  });
});

// PATCH /api/results/:attemptId { manualScores, oralNote } — enregistrer les notes
// (recalcule TOUJOURS le score automatique côté serveur, ne fait jamais confiance
// à un total envoyé par le client).
router.patch('/:attemptId', async (req, res) => {
  const { manualScores, oralNote } = req.body || {};
  const attempt = await prisma.attempt.findUnique({
    where: { id: req.params.attemptId }, include: { session: { include: { exam: true } } },
  });
  if (!attempt) return res.status(404).json({ error: 'Copie introuvable.' });
  if (req.user.role !== 'ADMIN' && attempt.session.teacherId !== req.user.sub) {
    return res.status(403).json({ error: "Cette copie ne vous appartient pas." });
  }

  const computed = computeResult(attempt.session.exam, attempt.reponses, manualScores || {}, oralNote ?? null);
  const result = await prisma.result.upsert({
    where: { attemptId: attempt.id },
    create: {
      attemptId: attempt.id, sectionScores: computed.sectionScores, manualScores: manualScores || {},
      autoDetail: computed.autoDetail, oralNote: computed.oralNote, total: computed.total, max: computed.max,
      pct: computed.pct, manualPending: computed.manualPending, visibleEleve: false,
    },
    update: {
      sectionScores: computed.sectionScores, manualScores: manualScores || {}, autoDetail: computed.autoDetail,
      oralNote: computed.oralNote, total: computed.total, max: computed.max, pct: computed.pct,
      manualPending: computed.manualPending,
    },
  });
  await logAction('Notes enregistrées', attempt.nom);
  res.json(result);
});

// POST /api/results/:attemptId/release — rendre le résultat définitif
router.post('/:attemptId/release', async (req, res) => {
  const attempt = await prisma.attempt.findUnique({
    where: { id: req.params.attemptId }, include: { session: true, result: true },
  });
  if (!attempt) return res.status(404).json({ error: 'Copie introuvable.' });
  if (req.user.role !== 'ADMIN' && attempt.session.teacherId !== req.user.sub) {
    return res.status(403).json({ error: "Cette copie ne vous appartient pas." });
  }
  if (!attempt.result) return res.status(400).json({ error: "Enregistrez d'abord les notes avant de générer le résultat." });

  const result = await prisma.result.update({ where: { attemptId: attempt.id }, data: { visibleEleve: true } });
  await logAction('Résultat généré', attempt.nom);
  res.json({ ok: true, manualPending: result.manualPending });
});

module.exports = router;
