const express = require('express');
const { nanoid } = require('nanoid');
const prisma = require('../db');
const { logAction } = require('../audit');

const router = express.Router();

// Toutes les routes ci-dessous sont PUBLIQUES (accès élève sans compte), protégées
// uniquement par la connaissance du token de session puis du "secret" d'entrée
// (un identifiant aléatoire renvoyé une seule fois, à l'ouverture de la copie).
// Ce n'est pas une authentification forte, mais elle empêche un tiers qui ne
// connaît que l'ID de la copie de la lire ou la modifier.

// POST /api/attempts { token, nom, niveau, classe, groupe }
// Crée une nouvelle copie, ou reprend la copie en cours de cet élève si la
// reprise est autorisée pour cet examen et qu'une tentative "en_cours" existe déjà
// avec exactement le même nom (mécanisme simple, cohérent avec l'absence de compte élève).
router.post('/', async (req, res) => {
  const { token, nom, niveau, classe, groupe } = req.body || {};
  if (!token || !nom) return res.status(400).json({ error: 'Code de session et nom requis.' });

  const session = await prisma.examSession.findUnique({ where: { token: String(token).toUpperCase() }, include: { exam: true } });
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });
  if (session.statut === 'préparé') return res.status(409).json({ error: "La session n'a pas encore été démarrée par le professeur." });
  if (session.statut === 'terminé') return res.status(409).json({ error: 'Cette session est terminée.' });

  let attempt = await prisma.attempt.findFirst({
    where: { sessionId: session.id, nom: String(nom).trim(), statut: 'en_cours' },
  });

  if (attempt && !session.exam.autoriserReprise) {
    // Reprise non autorisée : on referme l'ancienne tentative et on repart de zéro.
    await prisma.attempt.update({ where: { id: attempt.id }, data: { statut: 'soumis', submittedAt: new Date() } });
    attempt = null;
  }

  const secret = nanoid(24);

  if (!attempt) {
    attempt = await prisma.attempt.create({
      data: {
        sessionId: session.id, secret, nom: String(nom).trim(), niveau: niveau || session.exam.niveau,
        classe, groupe, reponses: {}, incidents: [],
      },
    });
  } else {
    // On ne peut pas relire le secret d'origine (il n'est jamais stocké en clair
    // ailleurs que dans la ligne elle-même) : on le régénère pour cette reprise.
    attempt = await prisma.attempt.update({ where: { id: attempt.id }, data: { secret } });
  }

  res.status(201).json({
    attemptId: attempt.id,
    secret,
    reponses: attempt.reponses,
    examTitre: session.exam.titre,
  });
});

// PATCH /api/attempts/:id { secret, reponses } — sauvegarde automatique
router.patch('/:id', async (req, res) => {
  const { secret, reponses } = req.body || {};
  const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id } });
  if (!attempt || attempt.secret !== secret) return res.status(403).json({ error: 'Copie introuvable ou accès refusé.' });
  if (attempt.statut === 'soumis') return res.status(409).json({ error: 'Cette copie a déjà été envoyée.' });

  await prisma.attempt.update({ where: { id: attempt.id }, data: { reponses: reponses ?? attempt.reponses } });
  res.json({ ok: true });
});

// POST /api/attempts/:id/incident { secret, type } — journalise une sortie de focus/plein écran
router.post('/:id/incident', async (req, res) => {
  const { secret, type } = req.body || {};
  const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id } });
  if (!attempt || attempt.secret !== secret) return res.status(403).json({ error: 'Copie introuvable ou accès refusé.' });

  const incidents = Array.isArray(attempt.incidents) ? attempt.incidents : [];
  incidents.push({ type: type || 'unknown', at: new Date().toISOString() });
  await prisma.attempt.update({ where: { id: attempt.id }, data: { incidents } });
  res.json({ ok: true });
});

// POST /api/attempts/:id/submit { secret, reponses } — envoi final
router.post('/:id/submit', async (req, res) => {
  const { secret, reponses } = req.body || {};
  const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id }, include: { session: true } });
  if (!attempt || attempt.secret !== secret) return res.status(403).json({ error: 'Copie introuvable ou accès refusé.' });
  if (attempt.statut === 'soumis') return res.json({ ok: true, alreadySubmitted: true });

  await prisma.attempt.update({
    where: { id: attempt.id },
    data: { statut: 'soumis', submittedAt: new Date(), reponses: reponses ?? attempt.reponses },
  });
  await logAction('Copie soumise', `${attempt.nom} — session ${attempt.session.token}`);
  res.json({ ok: true });
});

module.exports = router;
