const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// GET /api/admins — liste tous les comptes administrateur
router.get('/', async (req, res) => {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  res.json(admins.map(a => ({
    id: a.id, name: a.name, email: a.email, status: a.status,
    createdAt: a.createdAt, lastLogin: a.lastLogin, isSelf: a.id === req.user.sub,
  })));
});

// POST /api/admins/:id/demote — repasse un administrateur en professeur
router.post('/:id/demote', async (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'Vous ne pouvez pas retirer vos propres droits administrateur.' });
  }
  const adminCount = await prisma.user.count({ where: { role: 'ADMIN', status: 'active' } });
  if (adminCount <= 1) {
    return res.status(400).json({ error: "Impossible : il doit toujours rester au moins un administrateur actif." });
  }
  const { niveau } = req.body || {};
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target || target.role !== 'ADMIN') return res.status(404).json({ error: 'Administrateur introuvable.' });

  const updated = await prisma.user.update({
    where: { id: target.id }, data: { role: 'TEACHER', niveau: niveau || target.niveau || 'Primaire' },
  });
  await logAction('Administrateur rétrogradé en professeur', updated.name);
  res.json({ ok: true });
});

module.exports = router;
