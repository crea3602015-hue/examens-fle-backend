const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { signToken } = require('../auth');
const { logAction } = require('../audit');
const { record, device } = require('../activity');

const router = express.Router();

// POST /api/auth/login { email, password }
// Le rôle (admin/professeur) est déterminé par le compte trouvé, pas par le client.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  const GENERIC = 'Email ou mot de passe incorrect.';
  const dev = device(req.headers['user-agent']), ip = req.ip || null;
  if (!user) { await record({ kind: 'login_failed', action: 'Connexion refusée', detail: String(email).toLowerCase().trim().slice(0, 120), device: dev, ip }); return res.status(401).json({ error: GENERIC }); }
  if (user.status !== 'active') return res.status(403).json({ error: 'Ce compte est désactivé. Contactez la coordination.' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) { await record({ userId: user.id, userName: user.name, role: user.role, kind: 'login_failed', action: 'Mot de passe incorrect', device: dev, ip }); return res.status(401).json({ error: GENERIC }); }

  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  await logAction(user.role === 'ADMIN' ? 'Connexion administrateur' : 'Connexion professeur', user.name);

  await record({ userId: user.id, userName: user.name, role: user.role, kind: 'login', action: 'Connexion', device: dev, ip });

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, role: user.role, email: user.email, name: user.name, niveau: user.niveau },
  });
});

module.exports = router;
