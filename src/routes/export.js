const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { sectionPoints } = require('../grading');
const { describeSectionQuestions } = require('../questionText');
const {
  reportFilename, buildResultsXlsx, buildResultsPdf, buildAttemptXlsx, buildAttemptPdf, buildBulkAttemptsPdf,
  buildProjectEntryPdf, buildBulkProjectEntriesPdf, buildGlobalReportPdf,
} = require('../reports');

const router = express.Router();
router.use(requireAuth, requireRole('TEACHER', 'ADMIN'));

/** Fetches the school logo (if configured) as a Buffer + file extension, ready
    to embed in a PDF/Excel export. Never throws — a missing/broken logo must
    never break an export. */
async function getLogo() {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    if (!settings || !settings.schoolLogoId) return { logoBuffer: null, logoExt: null };
    const file = await prisma.uploadedFile.findUnique({ where: { id: settings.schoolLogoId } });
    if (!file) return { logoBuffer: null, logoExt: null };
    const ext = file.mimeType.includes('png') ? 'png' : file.mimeType.includes('jpeg') || file.mimeType.includes('jpg') ? 'jpeg' : 'png';
    return { logoBuffer: Buffer.from(file.data, 'base64'), logoExt: ext };
  } catch (e) {
    return { logoBuffer: null, logoExt: null };
  }
}

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
  const { logoBuffer, logoExt } = await getLogo();
  const buf = await buildResultsXlsx({ ...data, logoBuffer, logoExt });
  const filename = reportFilename(data.examTitle || 'resultats', data.grouping) + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/results.pdf?examId=...
router.get('/results.pdf', async (req, res) => {
  const data = await buildClassExportData(req);
  if (!data) return res.status(404).json({ error: 'Aucun résultat à exporter pour ce filtre.' });
  const { logoBuffer } = await getLogo();
  const buf = await buildResultsPdf({ ...data, logoBuffer });
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
  const { logoBuffer } = await getLogo();
  const buf = await buildAttemptPdf({ ...data, logoBuffer });
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

  const { logoBuffer } = await getLogo();
  const buf = await buildBulkAttemptsPdf({ examTitle: exam.titre, matiere: exam.matiere, teacherName, attempts: attemptsData, logoBuffer });
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
  const { logoBuffer, logoExt } = await getLogo();
  const buf = await buildResultsXlsx({ ...data, logoBuffer, logoExt });
  const filename = reportFilename(data.examTitle || 'projet', data.grouping) + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/project-results.pdf?projectId=...
router.get('/project-results.pdf', async (req, res) => {
  const data = await buildProjectExportData(req);
  if (!data) return res.status(404).json({ error: 'Aucune note à exporter pour ce filtre.' });
  const { logoBuffer } = await getLogo();
  const buf = await buildResultsPdf({ ...data, logoBuffer });
  const filename = reportFilename(data.examTitle || 'projet', data.grouping) + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

async function buildProjectEntryExportData(req, entryId) {
  const entry = await prisma.projectEntry.findUnique({
    where: { id: entryId },
    include: { assignment: { include: { project: true, teacher: { select: { name: true } } } } },
  });
  if (!entry) return null;
  if (req.user.role !== 'ADMIN' && entry.assignment.teacherId !== req.user.sub) return null;
  const project = entry.assignment.project;
  const isSecondaire = project.niveau === 'Secondaire';
  const criteriaScores = project.criteria.map(c => ({ titre: c.titre, points: c.points, given: entry.scores[c.id] ?? null }));
  return {
    projectTitle: project.titre, matiere: project.matiere, teacherName: entry.assignment.teacher?.name,
    student: { nom: entry.nom, classe: entry.classe, groupe: entry.groupe, niveau: entry.classe, isSecondaire },
    total: entry.total, max: entry.max, pct: entry.pct, criteriaScores,
    grouping: { isSecondaire, niveau: isSecondaire ? entry.classe : null, classe: !isSecondaire ? entry.classe : null, groupe: !isSecondaire ? entry.groupe : null },
  };
}

// GET /api/export/project-entry/:entryId/pdf — la feuille d'un seul élève, espacement généreux
router.get('/project-entry/:entryId/pdf', async (req, res) => {
  const data = await buildProjectEntryExportData(req, req.params.entryId);
  if (!data) return res.status(404).json({ error: 'Note introuvable.' });
  const { logoBuffer } = await getLogo();
  const buf = await buildProjectEntryPdf({ ...data, logoBuffer });
  const filename = reportFilename(data.student.nom, data.grouping) + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/project-entries-bulk.pdf?projectId=...&assignmentId=... — une feuille par élève, un seul PDF
router.get('/project-entries-bulk.pdf', async (req, res) => {
  const where = {};
  if (req.query.assignmentId) where.assignmentId = req.query.assignmentId;
  else if (req.query.projectId) where.assignment = { projectId: req.query.projectId };
  if (req.user.role !== 'ADMIN') where.assignment = { ...(where.assignment || {}), teacherId: req.user.sub };
  const entries = await prisma.projectEntry.findMany({
    where, include: { assignment: { include: { project: true, teacher: { select: { name: true } } } } }, orderBy: { nom: 'asc' },
  });
  if (entries.length === 0) return res.status(404).json({ error: 'Aucune note à exporter pour ce filtre.' });
  const project = entries[0].assignment.project;
  const teacherName = entries[0].assignment.teacher?.name;
  const isSecondaire = project.niveau === 'Secondaire';

  const entriesData = entries.map(e => ({
    student: { nom: e.nom, classe: e.classe, groupe: e.groupe, niveau: e.classe, isSecondaire },
    total: e.total, max: e.max, pct: e.pct,
    criteriaScores: project.criteria.map(c => ({ titre: c.titre, points: c.points, given: e.scores[c.id] ?? null })),
  }));

  const { logoBuffer } = await getLogo();
  const buf = await buildBulkProjectEntriesPdf({ projectTitle: project.titre, matiere: project.matiere, teacherName, entries: entriesData, logoBuffer });
  const classes = [...new Set(entries.map(e => e.classe).filter(Boolean))];
  const groupes = [...new Set(entries.map(e => e.groupe).filter(Boolean))];
  const grouping = {
    isSecondaire, niveau: isSecondaire && classes.length === 1 ? classes[0] : null,
    classe: !isSecondaire && classes.length === 1 ? classes[0] : null, groupe: !isSecondaire && groupes.length === 1 ? groupes[0] : null,
  };
  const filename = reportFilename((project.titre || 'projet') + '_toutes_les_copies', grouping) + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

// GET /api/export/global-report.pdf — rapport pédagogique complet, coloré, pour la direction (admin uniquement)
router.get('/global-report.pdf', requireRole('ADMIN'), async (req, res) => {
  const [examCount, teacherCount, attempts] = await Promise.all([
    prisma.exam.count(),
    prisma.user.count({ where: { role: 'TEACHER' } }),
    prisma.attempt.findMany({ where: { statut: 'soumis' }, include: { result: true, session: { include: { exam: { select: { niveau: true, sections: true } } } } } }),
  ]);
  const withResult = attempts.filter(a => a.result);
  const avgPct = withResult.length ? Math.round(withResult.reduce((s, a) => s + a.result.pct, 0) / withResult.length) : 0;
  const successRate = withResult.length ? Math.round((100 * withResult.filter(a => a.result.pct >= 50).length) / withResult.length) : 0;
  const byLevel = {};
  ['Préscolaire', 'Primaire', 'Secondaire'].forEach(niv => {
    const rel = withResult.filter(a => a.session.exam.niveau === niv);
    byLevel[niv] = rel.length ? Math.round(rel.reduce((s, a) => s + a.result.pct, 0) / rel.length) : null;
  });

  const classes = [...new Set(attempts.map(a => a.classe).filter(Boolean))];
  const classBreakdown = [];
  classes.forEach(cls => {
    const rel = withResult.filter(a => a.classe === cls);
    if (rel.length === 0) return;
    const agg = {};
    rel.forEach(a => {
      a.session.exam.sections.forEach(sec => {
        const score = a.result.sectionScores[sec.id]; const max = sectionPoints(sec);
        if (score === undefined || !max) return;
        agg[sec.titre] = agg[sec.titre] || { sum: 0, max: 0 };
        agg[sec.titre].sum += score; agg[sec.titre].max += max;
      });
    });
    const sections = Object.entries(agg).map(([titre, v]) => ({ titre, pct: Math.round((100 * v.sum) / v.max) })).sort((a, b) => a.pct - b.pct);
    if (sections.length) classBreakdown.push({ classe: cls, sections });
  });

  const { logoBuffer } = await getLogo();
  const buf = await buildGlobalReportPdf({
    stats: { examCount, teacherCount, submittedCount: attempts.length, avgPct, successRate },
    byLevel, classBreakdown, logoBuffer,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="rapport_pedagogique_global.pdf"');
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
