const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');
const { examTotalPoints } = require('../grading');

const router = express.Router();
router.use(requireAuth);

function shape(exam, assignedCount) {
  return {
    id: exam.id, titre: exam.titre, niveau: exam.niveau, matiere: exam.matiere, statut: exam.statut,
    navMode: exam.navMode, duree: exam.duree, autoriserReprise: exam.autoriserReprise, logoId: exam.logoId || null,
    imported: exam.imported, verified: exam.verified, sections: exam.sections,
    totalPoints: examTotalPoints(exam), assignedCount: assignedCount || 0,
    createdAt: exam.createdAt, updatedAt: exam.updatedAt,
  };
}

// GET /api/exams — admin voit tout ; professeur ne voit que ses examens assignés
router.get('/', async (req, res) => {
  if (req.user.role === 'ADMIN') {
    const exams = await prisma.exam.findMany({
      include: { _count: { select: { assignments: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(exams.map(e => shape(e, e._count.assignments)));
  }
  // Professeur : uniquement les examens pour lesquels il a une assignation.
  const assignments = await prisma.assignment.findMany({
    where: { teacherId: req.user.sub },
    include: { exam: true },
  });
  const seen = new Set();
  const exams = [];
  assignments.forEach(a => {
    if (seen.has(a.examId)) return;
    seen.add(a.examId);
    exams.push(shape(a.exam));
  });
  res.json(exams);
});

// GET /api/exams/:id
router.get('/:id', async (req, res) => {
  const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
  if (!exam) return res.status(404).json({ error: 'Examen introuvable.' });
  if (req.user.role !== 'ADMIN') {
    const has = await prisma.assignment.count({ where: { examId: exam.id, teacherId: req.user.sub } });
    if (!has) return res.status(403).json({ error: 'Cet examen ne vous est pas assigné.' });
  }
  res.json(shape(exam));
});

router.use(requireRole('ADMIN'));

// POST /api/exams — création (brouillon ou publication directe)
router.post('/', async (req, res) => {
  const { titre, niveau, matiere, statut, navMode, duree, autoriserReprise, sections, imported, verified, logoId } = req.body || {};
  if (!titre || !sections || !Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ error: 'Titre et au moins une section sont requis.' });
  }
  const exam = await prisma.exam.create({
    data: {
      titre, niveau: niveau || 'Primaire', matiere: matiere || 'Français', statut: statut || 'brouillon', navMode: navMode || 'libre',
      duree: Number(duree || 0), autoriserReprise: autoriserReprise !== false, logoId: logoId || null, sections,
      imported: !!imported, verified: imported ? !!verified : true,
    },
  });
  await logAction(exam.statut === 'publié' ? 'Examen publié' : 'Examen enregistré en brouillon', exam.titre);
  res.status(201).json(shape(exam));
});

// PUT /api/exams/:id — édition complète (aussi utilisé pour publier un import/variante IA vérifiés)
router.put('/:id', async (req, res) => {
  const existing = await prisma.exam.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Examen introuvable.' });
  const { titre, niveau, matiere, statut, navMode, duree, autoriserReprise, sections, verified, logoId } = req.body || {};

  if (statut === 'publié' && existing.imported && !(verified ?? existing.verified)) {
    return res.status(400).json({ error: "Cet examen importé doit être vérifié avant publication." });
  }

  const exam = await prisma.exam.update({
    where: { id: req.params.id },
    data: {
      titre: titre ?? existing.titre, niveau: niveau ?? existing.niveau, matiere: matiere ?? existing.matiere, statut: statut ?? existing.statut,
      navMode: navMode ?? existing.navMode, duree: duree !== undefined ? Number(duree) : existing.duree,
      autoriserReprise: autoriserReprise ?? existing.autoriserReprise,
      logoId: logoId === undefined ? existing.logoId : (logoId || null),
      sections: sections ?? existing.sections, verified: verified ?? existing.verified,
    },
  });
  await logAction('Examen modifié', exam.titre);
  res.json(shape(exam));
});

// PATCH /api/exams/:id/archive — bascule brouillon/archivé
router.patch('/:id/archive', async (req, res) => {
  const existing = await prisma.exam.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Examen introuvable.' });
  const statut = existing.statut === 'archivé' ? 'brouillon' : 'archivé';
  const exam = await prisma.exam.update({ where: { id: req.params.id }, data: { statut } });
  await logAction('Examen archivé/désarchivé', exam.titre);
  res.json(shape(exam));
});

// POST /api/exams/:id/duplicate
router.post('/:id/duplicate', async (req, res) => {
  const existing = await prisma.exam.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Examen introuvable.' });
  const copy = await prisma.exam.create({
    data: {
      titre: existing.titre + ' (copie)', niveau: existing.niveau, matiere: existing.matiere, statut: 'brouillon',
      navMode: existing.navMode, duree: existing.duree, autoriserReprise: existing.autoriserReprise, logoId: existing.logoId,
      sections: existing.sections, imported: false, verified: true,
    },
  });
  await logAction('Examen dupliqué', copy.titre);
  res.status(201).json(shape(copy));
});

// GET /api/exams/:id/usage — ce qui serait supprimé en même temps que l'examen
router.get('/:id/usage', async (req, res) => {
  const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
  if (!exam) return res.status(404).json({ error: 'Examen introuvable.' });
  const sessions = await prisma.examSession.count({ where: { examId: exam.id } });
  const attempts = await prisma.attempt.count({ where: { session: { examId: exam.id } } });
  res.json({ sessions, attempts });
});

/** Identifiants des images téléversées utilisées dans les questions d'un examen. */
function uploadIds(sections) {
  const ids = new Set();
  JSON.stringify(sections || []).replace(/\/api\/uploads\/([A-Za-z0-9_-]+)/g, (m, id) => { ids.add(id); return m; });
  return [...ids];
}

// DELETE /api/exams/:id
//   sans option        : refusé s'il existe des sessions (protection contre une suppression par erreur)
//   ?definitif=1       : suppression DÉFINITIVE de l'examen, de ses assignations, de ses sessions, des copies
//                        des élèves et de leurs résultats, et des images qui ne servent plus à aucun autre examen.
router.delete('/:id', async (req, res) => {
  const existing = await prisma.exam.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Examen introuvable.' });
  const definitif = req.query.definitif === '1';
  const sessionCount = await prisma.examSession.count({ where: { examId: existing.id } });
  if (sessionCount > 0 && !definitif) {
    return res.status(409).json({
      error: `${sessionCount} session(s) et leurs résultats existent pour cet examen. Utilisez « Supprimer définitivement » pour tout effacer.`,
    });
  }
  const attemptCount = await prisma.attempt.count({ where: { session: { examId: existing.id } } });
  const mine = uploadIds(existing.sections);

  await prisma.exam.delete({ where: { id: existing.id } }); // les sessions, copies et résultats suivent (suppression en cascade)

  // Libère l'espace : on supprime les images de cet examen que plus personne n'utilise.
  let freed = 0;
  if (mine.length) {
    const [others, projects, settings] = await Promise.all([
      prisma.exam.findMany({ select: { sections: true } }), prisma.project.findMany(), prisma.settings.findUnique({ where: { id: 'singleton' } }),
    ]);
    const haystack = JSON.stringify(others.map(o => o.sections)) + JSON.stringify(projects);
    const orphans = mine.filter(id => !haystack.includes(id) && !(settings && settings.schoolLogoId === id));
    if (orphans.length) { freed = (await prisma.uploadedFile.deleteMany({ where: { id: { in: orphans } } })).count; }
  }
  await logAction(definitif ? 'Examen supprimé définitivement' : 'Examen supprimé', `${existing.titre} (${sessionCount} session(s), ${attemptCount} copie(s), ${freed} image(s))`);
  res.json({ ok: true, sessions: sessionCount, copies: attemptCount, images: freed });
});

module.exports = router;
