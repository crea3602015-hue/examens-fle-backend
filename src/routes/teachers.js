const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// GET /api/teachers — liste tous les professeurs avec leur nombre d'examens assignés
router.get('/', async (req, res) => {
  const teachers = await prisma.user.findMany({
    where: { role: 'TEACHER' },
    include: { _count: { select: { assignments: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(teachers.map(t => ({
    id: t.id, name: t.name, email: t.email, niveau: t.niveau, status: t.status,
    createdAt: t.createdAt, lastLogin: t.lastLogin, examCount: t._count.assignments,
  })));
});

// POST /api/teachers — créer un compte professeur directement
router.post('/', async (req, res) => {
  const { name, email, password, niveau, grade } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });

  const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (existing) return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const teacher = await prisma.user.create({
    data: { role: 'TEACHER', name, email: String(email).toLowerCase().trim(), passwordHash, niveau, grade, status: 'active' },
  });
  await logAction('Professeur ajouté', teacher.name);
  res.status(201).json({ id: teacher.id, name: teacher.name, email: teacher.email });
});

// PATCH /api/teachers/:id — activer/désactiver
router.patch('/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  const teacher = await prisma.user.update({ where: { id: req.params.id }, data: { status } });
  await logAction('Statut professeur modifié', teacher.name);
  res.json({ ok: true });
});

// DELETE /api/teachers/:id — supprime le compte (les résultats historiques restent en base,
// liés à des sessions dont teacherId pointera vers un compte supprimé — voir onDelete: Cascade
// dans le schéma si vous préférez tout effacer ; ici on supprime bien le compte).
router.delete('/:id', async (req, res) => {
  const teacher = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!teacher) return res.status(404).json({ error: 'Professeur introuvable.' });
  await prisma.user.delete({ where: { id: req.params.id } });
  await logAction('Professeur supprimé', teacher.name);
  res.json({ ok: true });
});

module.exports = router;
