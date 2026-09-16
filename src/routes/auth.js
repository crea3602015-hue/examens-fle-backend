const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { signToken } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();

// POST /api/auth/login { email, password }
// Le rôle (admin/professeur) est déterminé par le compte trouvé, pas par le client.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (!user) return res.status(401).json({ error: 'Aucun compte trouvé avec cet email.' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Ce compte est désactivé. Contactez la coordination.' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect.' });

  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  await logAction(user.role === 'ADMIN' ? 'Connexion administrateur' : 'Connexion professeur', user.name);

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, role: user.role, email: user.email, name: user.name, niveau: user.niveau },
  });
});

module.exports = router;
