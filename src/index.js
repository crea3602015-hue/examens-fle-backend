require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const teacherRoutes = require('./routes/teachers');
const adminRoutes = require('./routes/admins');
const quizRoutes = require('./routes/quiz');
const projectRoutes = require('./routes/projects');
const projectAssignmentRoutes = require('./routes/projectAssignments');
const projectEntryRoutes = require('./routes/projectEntries');
const uploadRoutes = require('./routes/uploads');
const settingsRoutes = require('./routes/settings');
const suiviRoutes = require('./routes/suivi');
const pedaRoutes = require('./routes/peda');
const convertRoutes = require('./routes/convert');
const accessRequestRoutes = require('./routes/accessRequests');
const examRoutes = require('./routes/exams');
const assignmentRoutes = require('./routes/assignments');
const sessionRoutes = require('./routes/sessions');
const attemptRoutes = require('./routes/attempts');
const resultRoutes = require('./routes/results');
const analyticsRoutes = require('./routes/analytics');
const auditRoutes = require('./routes/audit');
const exportRoutes = require('./routes/export');
const activityRoutes = require('./routes/activity');
const { actionLogger } = require('./activity');
const path = require('path');

const app = express();
// Derrière le proxy de Render : sans cela, tous les utilisateurs auraient la même adresse IP.
app.set('trust proxy', 1);

// Copie d'essai de l'application (dossier public/) servie par le serveur : on teste ici AVANT de déployer sur Netlify.
// Placée avant helmet pour ne pas bloquer les scripts de la page.
app.use('/test', express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: false, setHeaders: res => res.setHeader('Cache-Control', 'no-store') }));

// En-têtes de sécurité standards (protège contre le détournement de clics,
// le sniffing MIME, etc.). "crossOrigin*" désactivés car nos images/fichiers
// doivent pouvoir être chargés depuis le domaine du frontend.
app.use(helmet({ crossOriginResourcePolicy: false, crossOriginEmbedderPolicy: false }));

// N'accepte que les origines déclarées dans CORS_ORIGINS (le domaine du frontend).
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Origine non autorisée par la politique CORS.'));
  },
}));

app.use(actionLogger);
app.use(express.json({ limit: '4mb' })); // couvre un dessin ou un fichier importé (jusqu'à 2 Mo) encodé en base64

// Limite les tentatives de connexion — freine les attaques par force brute sur
// les mots de passe : 15 échecs / 15 min pour un même compte depuis une même adresse.
// Les connexions réussies ne comptent pas : 15 professeurs sur le même réseau de l'école peuvent se connecter le même jour.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true,
  keyGenerator: req => `${req.ip}|${String((req.body && req.body.email) || '').toLowerCase().trim()}`,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' },
});
app.use('/api/auth/login', loginLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/project-assignments', projectAssignmentRoutes);
app.use('/api/project-entries', projectEntryRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/suivi', suiviRoutes);
app.use('/api/peda', pedaRoutes);
app.use('/api/convert', convertRoutes);
app.use('/api/access-requests', accessRequestRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/activity', activityRoutes);

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
