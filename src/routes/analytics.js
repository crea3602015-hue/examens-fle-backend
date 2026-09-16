const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { sectionPoints } = require('../grading');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// GET /api/analytics/dashboard — compteurs globaux + moyenne par niveau
router.get('/dashboard', async (req, res) => {
  const [examCount, activeSessions, teacherCount, attempts] = await Promise.all([
    prisma.exam.count(),
    prisma.examSession.count({ where: { statut: 'en_cours' } }),
    prisma.user.count({ where: { role: 'TEACHER' } }),
    prisma.attempt.findMany({
      where: { statut: 'soumis' },
      include: { result: true, session: { include: { exam: { select: { niveau: true } } } } },
    }),
  ]);

  const withResult = attempts.filter(a => a.result);
  const avgPct = withResult.length ? Math.round(withResult.reduce((s, a) => s + a.result.pct, 0) / withResult.length) : 0;
  const successRate = withResult.length ? Math.round((100 * withResult.filter(a => a.result.pct >= 50).length) / withResult.length) : 0;

  const byLevel = {};
  ['Préscolaire', 'Primaire', 'Secondaire'].forEach(niv => {
    const rel = withResult.filter(a => a.session.exam.niveau === niv);
    byLevel[niv] = rel.length ? Math.round(rel.reduce((s, a) => s + a.result.pct, 0) / rel.length) : null;
  });

  res.json({
    examCount, activeSessions, teacherCount, submittedCount: attempts.length,
    avgPct, successRate, byLevel,
  });
});

// GET /api/analytics/class/:classe — moyenne par section pour identifier la compétence prioritaire
router.get('/class/:classe', async (req, res) => {
  const attempts = await prisma.attempt.findMany({
    where: { classe: req.params.classe, statut: 'soumis' },
    include: { result: true, session: { include: { exam: true } } },
  });
  const withResult = attempts.filter(a => a.result);
  if (withResult.length === 0) return res.json({ classe: req.params.classe, sections: [] });

  const agg = {};
  withResult.forEach(a => {
    a.session.exam.sections.forEach(sec => {
      const score = a.result.sectionScores[sec.id];
      const max = sectionPoints(sec);
      if (score === undefined || !max) return;
      agg[sec.titre] = agg[sec.titre] || { sum: 0, max: 0 };
      agg[sec.titre].sum += score;
      agg[sec.titre].max += max;
    });
  });
  const sections = Object.entries(agg)
    .map(([titre, v]) => ({ titre, pct: Math.round((100 * v.sum) / v.max) }))
    .sort((a, b) => a.pct - b.pct);

  res.json({ classe: req.params.classe, sections, priority: sections[0]?.titre || null });
});

module.exports = router;
