// Journal d'activité : qui se connecte, quand, depuis quel appareil, et ce qu'il fait.
// Alimente la page « Statistiques d'utilisation » de l'administrateur.
const jwt = require('jsonwebtoken');
const prisma = require('./db');

function device(ua) {
  const s = String(ua || '');
  const kind = /iPad|Tablet/i.test(s) ? 'Tablette' : /Mobi|Android|iPhone/i.test(s) ? 'Téléphone' : 'Ordinateur';
  const browser = /Edg\/|EdgA|EdgiOS/.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\/|FxiOS/.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Autre';
  return `${kind}, ${browser}`;
}

async function record(e) {
  try {
    await prisma.activityLog.create({ data: e });
    if (Math.random() < 0.01) await prisma.activityLog.deleteMany({ where: { at: { lt: new Date(Date.now() - 365 * 864e5) } } }); // on garde un an
  } catch (err) { console.error('Journal d\'activité :', err.message); }
}

/** Utilisateur déduit du jeton, sans bloquer la requête s'il est absent ou invalide. */
function softUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ') || !process.env.JWT_SECRET) return null;
  try { return jwt.verify(h.slice(7), process.env.JWT_SECRET); } catch (e) { return null; }
}

const LABELS = [
  [/^POST \/api\/exams$/, 'Crée un examen'], [/^PUT \/api\/exams\/:id$/, 'Modifie un examen'], [/^DELETE \/api\/exams\/:id/, 'Supprime un examen'],
  [/^POST \/api\/assignments$/, 'Assigne un examen'], [/^POST \/api\/assignments\/:id\/revue$/, 'Relit un examen assigné'], [/^POST \/api\/assignments\/:id\/reassigner$/, 'Réassigne un examen'],
  [/^POST \/api\/project-assignments$/, 'Assigne un projet'], [/^POST \/api\/project-assignments\/:id\/revue$/, 'Relit un projet assigné'],
  [/^POST \/api\/sessions/, 'Lance ou gère une session d\'examen'], [/^POST \/api\/convert\/exam$/, 'Convertit un examen avec l\'IA'],
  [/^POST \/api\/peda\/documents$/, 'Crée un document pédagogique'], [/^PUT \/api\/peda\/documents\/:id$/, 'Modifie un document pédagogique'],
  [/^POST \/api\/peda\/documents\/:id\/assigner$/, 'Assigne un document à des professeurs'], [/^DELETE \/api\/peda\/documents\/:id$/, 'Supprime un document pédagogique'],
  [/^POST \/api\/peda\/assignes\/:id\/revue$/, 'Relit un document assigné'], [/^POST \/api\/peda\/generer$/, 'Génère un document avec l\'IA'],
  [/^POST \/api\/peda\/traduire$/, 'Traduit un document'], [/^POST \/api\/peda\/depuis-document$/, 'Importe un Word ou PDF dans un document'],
  [/^POST \/api\/peda\/exporter$/, 'Télécharge un document pédagogique'], [/^PUT \/api\/suivi\/statut$/, 'Change un statut du suivi'],
  [/^POST \/api\/project-entries/, 'Saisit une note de projet'], [/^POST \/api\/teachers/, 'Gère un compte professeur'], [/^POST \/api\/quiz/, 'Utilise un quiz'],
];
function labelFor(method, path) {
  const key = `${method} ${path}`;
  const hit = LABELS.find(([re]) => re.test(key));
  return hit ? hit[1] : key;
}

/** À brancher une fois : enregistre les actions (créer, modifier, supprimer…) réussies d'un utilisateur connecté. */
function actionLogger(req, res, next) {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const u = softUser(req); if (!u) return;
    const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/[a-z0-9]{20,}/gi, ':id');
    if (/^\/api\/(activity|auth)/.test(path)) return;
    record({ userId: u.sub, userName: u.name || null, role: u.role || null, kind: 'action', action: labelFor(req.method, path), device: device(req.headers['user-agent']), ip: req.ip || null });
  });
  next();
}

module.exports = { record, device, softUser, actionLogger };
