require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const teacherRoutes = require('./routes/teachers');
const accessRequestRoutes = require('./routes/accessRequests');
const examRoutes = require('./routes/exams');
const assignmentRoutes = require('./routes/assignments');
const sessionRoutes = require('./routes/sessions');
const attemptRoutes = require('./routes/attempts');
const resultRoutes = require('./routes/results');
const analyticsRoutes = require('./routes/analytics');
const auditRoutes = require('./routes/audit');
const exportRoutes = require('./routes/export');
const aiRoutes = require('./routes/ai');

const app = express();

// N'accepte que les origines déclarées dans CORS_ORIGINS (le domaine du frontend).
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Origine non autorisée par la politique CORS.'));
  },
}));

app.use(express.json({ limit: '2mb' })); // 2mb : suffisant pour un dessin encodé en base64

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/access-requests', accessRequestRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/ai', aiRoutes);

// Gestionnaire d'erreurs générique — évite qu'une exception non prévue fasse
// planter le serveur ou fuite une trace technique vers le client.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.publicMessage || 'Erreur interne du serveur.' });
});

const PORT = process.env.PORT || 3000;

async function ensureSeedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'Coordination FLE';
  if (!email || !password) return; // pas configuré : on ne crée rien, silencieusement
  try {
    const prisma = require('./db');
    const bcrypt = require('bcryptjs');
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return;
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { role: 'ADMIN', email, name, passwordHash, status: 'active' } });
    console.log(`Compte administrateur créé automatiquement : ${email}`);
  } catch (e) {
    // Ne bloque jamais le démarrage du serveur si la création échoue
    // (ex : base de données pas encore migrée) — le seed manuel reste possible.
    console.error('Création automatique du compte admin : ', e.message);
  }
}

ensureSeedAdmin().finally(() => {
  app.listen(PORT, () => {
    console.log(`API Examens FLE en écoute sur le port ${PORT}`);
  });
});
