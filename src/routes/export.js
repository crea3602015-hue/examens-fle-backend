const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { sectionPoints } = require('../grading');
const { describeSectionQuestions } = require('../questionText');
const { reportFilename, buildResultsXlsx, buildResultsPdf, buildAttemptXlsx, buildAttemptPdf, buildBulkAttemptsPdf } = require('../reports');

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

/** Shared: fetch submitted attempts for an exam (scoped to the requester), with results + exam. */
async function fetchScopedAttempts(req, examId) {
  const where = { statut: 'soumis' };
  if (examId) where.session = { examId };
  if (req.user.role !== 'ADMIN') where.session = { ...(where.session || {}), teacherId: req.user.sub };
  return prisma.attempt.findMany({
    where, include: { result: true, session: { include: { exam: true, teacher: { select: { name: true } } } } }, orderBy: { nom: 'asc' },
  });
}

/** Average % per section across a set of attempts, used for the "what to work on" chart. */
function computeSectionStats(exam, attemptsWithResult) {
  const agg = {};
  attemptsWithResult.forEach(a => {
    exam.sections.forEach(sec => {
      const score = a.result.sectionScores[sec.id];
      const max = sectionPoints(sec);
      if (score === undefined || !max) return;
      agg[sec.titre] = agg[sec.titre] || { sum: 0, max: 0 };
      agg[sec.titre].sum += score; agg[sec.titre].max += max;
    });
  });
  return Object.entries(agg).map(([titre, v]) => ({ titre, pct: Math.round((100 * v.sum) / v.max) }));
}

/** Detects a single shared classe/groupe/niveau across attempts, for the filename. */
function detectGrouping(attempts) {
  const isSecondaire = attempts.length && attempts[0].session.exam.niveau === 'Secondaire';
  const classes = [...new Set(attempts.map(a => a.classe).filter(Boolean))];
  const groupes = [...new Set(attempts.map(a => a.groupe).filter(Boolean))];
  return {
    isSecondaire,
    niveau: isSecondaire && classes.length === 1 ? classes[0] : null,
    classe: !isSecondaire && classes.length === 1 ? classes[0] : null,
    groupe: !isSecondaire && groupes.length === 1 ? groupes[0] : null,
  };
}

async function buildClassExportData(req) {
  const attempts = await fetchScopedAttempts(req, req.query.examId);
  if (attempts.length === 0) return null;
  const exam = attempts[0].session.exam;
  const teacherName = attempts[0].session.teacher?.name;
  const withResult = attempts.filter(a => a.result);
  const rows = attempts.map(a => ({
    nom: a.nom, classe: a.classe, groupe: a.groupe,
    total: a.result?.total ?? 0, max: a.result?.max ?? 0, pct: a.result ? a.result.pct : null,
  }));
  const sectionStats = computeSectionStats(exam, withResult);
  const grouping = detectGrouping(attempts);
  return { examTitle: exam.titre, matiere: exam.matiere, teacherName, rows, sectionStats, grouping };
}

// GET /api/export/results.xlsx?examId=...
router.get('/results.xlsx', async (req, res) => {
  const data = await buildClassExportData(req);
  if (!data) return res.status(404).json({ error: 'Aucun résultat à exporter pour ce filtre.' });
  const buf = await buildResultsXlsx(data);
  const filename = reportFilename(data.examTitle || 'resultats', data.grouping) + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/results.pdf?examId=...
router.get('/results.pdf', async (req, res) => {
  const data = await buildClassExportData(req);
  if (!data) return res.status(404).json({ error: 'Aucun résultat à exporter pour ce filtre.' });
  const buf = await buildResultsPdf(data);
  const filename = reportFilename(data.examTitle || 'resultats', data.grouping) + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

async function buildAttemptExportData(req, attemptId) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { result: true, session: { include: { exam: true, teacher: { select: { name: true } } } } },
  });
  if (!attempt) return null;
  if (req.user.role !== 'ADMIN' && attempt.session.teacherId !== req.user.sub) return null;
  const exam = attempt.session.exam;
  const isSecondaire = exam.niveau === 'Secondaire';
  const sections = exam.sections.map(sec => {
    const score = attempt.result ? attempt.result.sectionScores[sec.id] : undefined;
    const max = sectionPoints(sec);
    return {
      titre: sec.titre,
      pct: score !== undefined && max ? Math.round((100 * score) / max) : 0,
      questions: describeSectionQuestions(sec, attempt.reponses, attempt.result?.autoDetail, attempt.result?.manualScores, attempt.result?.oralNote),
    };
  });
  return {
    examTitle: exam.titre, matiere: exam.matiere, teacherName: attempt.session.teacher?.name,
    student: { nom: attempt.nom, classe: attempt.classe, groupe: attempt.groupe, niveau: attempt.classe, isSecondaire },
    total: attempt.result?.total ?? 0, max: attempt.result?.max ?? 0, pct: attempt.result ? attempt.result.pct : null,
    sections,
    grouping: { isSecondaire, niveau: isSecondaire ? attempt.classe : null, classe: !isSecondaire ? attempt.classe : null, groupe: !isSecondaire ? attempt.groupe : null },
  };
}

// GET /api/export/attempt/:attemptId/xlsx
router.get('/attempt/:attemptId/xlsx', async (req, res) => {
  const data = await buildAttemptExportData(req, req.params.attemptId);
  if (!data) return res.status(404).json({ error: 'Copie introuvable.' });
  const buf = await buildAttemptXlsx(data);
  const filename = reportFilename(data.student.nom, data.grouping) + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/attempt/:attemptId/pdf
router.get('/attempt/:attemptId/pdf', async (req, res) => {
  const data = await buildAttemptExportData(req, req.params.attemptId);
  if (!data) return res.status(404).json({ error: 'Copie introuvable.' });
  const buf = await buildAttemptPdf(data);
  const filename = reportFilename(data.student.nom, data.grouping) + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/results-bulk.pdf?examId=... — une feuille par élève, dans un seul PDF à imprimer et séparer
router.get('/results-bulk.pdf', async (req, res) => {
  const attempts = await fetchScopedAttempts(req, req.query.examId);
  const withResult = attempts.filter(a => a.result);
  if (withResult.length === 0) return res.status(404).json({ error: 'Aucune copie corrigée à exporter pour ce filtre.' });
  const exam = withResult[0].session.exam;
  const teacherName = withResult[0].session.teacher?.name;
  const isSecondaire = exam.niveau === 'Secondaire';

  const attemptsData = withResult.map(a => {
    const sections = exam.sections.map(sec => {
      const score = a.result.sectionScores[sec.id];
      const max = sectionPoints(sec);
      return {
        titre: sec.titre,
        pct: score !== undefined && max ? Math.round((100 * score) / max) : 0,
        questions: describeSectionQuestions(sec, a.reponses, a.result.autoDetail, a.result.manualScores, a.result.oralNote),
      };
    });
    return {
      student: { nom: a.nom, classe: a.classe, groupe: a.groupe, niveau: a.classe, isSecondaire },
      total: a.result.total, max: a.result.max, pct: a.result.pct, sections,
    };
  });

  const buf = await buildBulkAttemptsPdf({ examTitle: exam.titre, matiere: exam.matiere, teacherName, attempts: attemptsData });
  const grouping = detectGrouping(withResult);
  const filename = reportFilename((exam.titre || 'resultats') + '_toutes_les_copies', grouping) + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/project-results.xlsx?projectId=...
router.get('/project-results.xlsx', async (req, res) => {
  const data = await buildProjectExportData(req);
  if (!data) return res.status(404).json({ error: 'Aucune note à exporter pour ce filtre.' });
  const buf = await buildResultsXlsx(data);
  const filename = reportFilename(data.examTitle || 'projet', data.grouping) + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/project-results.pdf?projectId=...
router.get('/project-results.pdf', async (req, res) => {
  const data = await buildProjectExportData(req);
  if (!data) return res.status(404).json({ error: 'Aucune note à exporter pour ce filtre.' });
  const buf = await buildResultsPdf(data);
  const filename = reportFilename(data.examTitle || 'projet', data.grouping) + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

async function buildProjectExportData(req) {
  const where = {};
  if (req.query.assignmentId) where.assignmentId = req.query.assignmentId;
  else if (req.query.projectId) where.assignment = { projectId: req.query.projectId };
  if (req.user.role !== 'ADMIN') where.assignment = { ...(where.assignment || {}), teacherId: req.user.sub };
  const entries = await prisma.projectEntry.findMany({
    where, include: { assignment: { include: { project: true, teacher: { select: { name: true } } } } }, orderBy: { nom: 'asc' },
  });
  if (entries.length === 0) return null;
  const project = entries[0].assignment.project;
  const teacherName = entries[0].assignment.teacher?.name;
  const rows = entries.map(e => ({ nom: e.nom, classe: e.classe, groupe: e.groupe, total: e.total, max: e.max, pct: e.pct }));
  const agg = {};
  entries.forEach(e => {
    project.criteria.forEach(c => {
      const v = e.scores[c.id];
      if (v === undefined || v === null || v === '' || !c.points) return;
      agg[c.titre] = agg[c.titre] || { sum: 0, max: 0 };
      agg[c.titre].sum += Number(v); agg[c.titre].max += Number(c.points);
    });
  });
  const sectionStats = Object.entries(agg).map(([titre, v]) => ({ titre, pct: Math.round((100 * v.sum) / v.max) }));
  const isSecondaire = project.niveau === 'Secondaire';
  const classes = [...new Set(entries.map(e => e.classe).filter(Boolean))];
  const groupes = [...new Set(entries.map(e => e.groupe).filter(Boolean))];
  const grouping = {
    isSecondaire,
    niveau: isSecondaire && classes.length === 1 ? classes[0] : null,
    classe: !isSecondaire && classes.length === 1 ? classes[0] : null,
    groupe: !isSecondaire && groupes.length === 1 ? groupes[0] : null,
  };
  return { examTitle: project.titre, matiere: project.matiere, teacherName, rows, sectionStats, grouping };
}

module.exports = router;
