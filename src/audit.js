const prisma = require('./db');

async function logAction(action, details) {
  try {
    await prisma.auditLog.create({ data: { action, details: details ? String(details) : null } });
  } catch (e) {
    // L'historique ne doit jamais faire échouer l'action principale.
    console.error('Échec de journalisation :', e.message);
  }
}

module.exports = { logAction };
