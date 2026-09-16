const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('TEACHER', 'ADMIN'));

function csvEscape(v) {
  const s = String(v === undefined || v === null ? '' : v);
return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}

// GET /api/export/results.csv?examId=... — Excel l'ouvre nativement (encodage + séparateur ; )
router.get('/results.csv', async (req, res) => {
  const where = { statut: 'soumis' };
  if (req.query.examId) where.session = { examId: req.query.examId };
  if (req.user.role !== 'ADMIN') where.session = { ...(where.session || {}), teacherId: req.user.sub };

  const attempts = await prisma.attempt.findMany({
    where, include: { result: true, session: { include: { exam: true } } }, orderBy: { nom: 'asc' },
  });

  const rows = [['Élève', 'Classe', 'Groupe', 'Examen', 'Total', 'Max', 'Pourcentage', 'Statut']];
  attempts.forEach(a => {
    rows.push([
      a.nom, a.classe || '', a.groupe || '', a.session.exam.titre,
      a.result?.total ?? '', a.result?.max ?? '', a.result ? a.result.pct + '%' : '',
      a.result ? (a.result.pct >= 50 ? 'Réussi' : 'Échec') : 'Non corrigé',
    ]);
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="resultats.csv"');
  res.send('\uFEFF' + toCsv(rows));
});

module.exports = router;
