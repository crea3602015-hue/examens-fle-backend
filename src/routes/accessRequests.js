const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();

// POST /api/access-requests — PUBLIC, formulaire "Demander un accès professeur"
router.post('/', async (req, res) => {
  const { prenom, nom, email, niveau, grade, groupe } = req.body || {};
  if (!prenom || !nom || !email || !niveau) {
    return res.status(400).json({ error: 'Prénom, nom, email et niveau sont requis.' });
  }
  if (niveau === 'Secondaire' && !grade) {
    return res.status(400).json({ error: 'Le niveau (secondaire) est requis.' });
  }
  if (niveau !== 'Secondaire' && (!grade || !groupe)) {
    return res.status(400).json({ error: 'La classe et le groupe sont requis.' });
  }
  const reqDoc = await prisma.accessRequest.create({
    data: { prenom, nom, email, niveau, grade, groupe: niveau === 'Secondaire' ? null : groupe, status: 'pending' },
  });
  await logAction('Nouvelle demande d\'accès professeur', `${prenom} ${nom}`);
  res.status(201).json({ id: reqDoc.id });
});

// Le reste est réservé à l'administrateur.
router.use(requireAuth, requireRole('ADMIN'));

// GET /api/access-requests/pending-count — pour le badge de notification admin
router.get('/pending-count', async (req, res) => {
  const count = await prisma.accessRequest.count({ where: { status: 'pending' } });
  res.json({ count });
});

// GET /api/access-requests
router.get('/', async (req, res) => {
  const list = await prisma.accessRequest.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(list);
});

// POST /api/access-requests/:id/accept { password }
router.post('/:id/accept', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Un mot de passe temporaire est requis.' });
  const reqDoc = await prisma.accessRequest.findUnique({ where: { id: req.params.id } });
  if (!reqDoc) return res.status(404).json({ error: 'Demande introuvable.' });

  const existing = await prisma.user.findUnique({ where: { email: reqDoc.email.toLowerCase().trim() } });
  if (existing) return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      role: 'TEACHER', name: `${reqDoc.prenom} ${reqDoc.nom}`, email: reqDoc.email.toLowerCase().trim(),
      passwordHash, niveau: reqDoc.niveau, grade: reqDoc.grade, status: 'active',
    },
  });
  await prisma.accessRequest.update({ where: { id: reqDoc.id }, data: { status: 'accepted' } });
  await logAction('Demande d\'accès acceptée', reqDoc.email);
  res.json({ ok: true });
});

// POST /api/access-requests/:id/refuse
router.post('/:id/refuse', async (req, res) => {
  const reqDoc = await prisma.accessRequest.update({ where: { id: req.params.id }, data: { status: 'refused' } });
  await logAction('Demande d\'accès refusée', reqDoc.email);
  res.json({ ok: true });
});

module.exports = router;
