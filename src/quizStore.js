// Stockage des quiz EN MÉMOIRE UNIQUEMENT — rien n'est écrit dans la base de
// données. C'est un choix voulu : les quiz sont éphémères, tout disparaît
// quand le professeur réinitialise ou quand le serveur redémarre.

const sessions = new Map(); // code -> session

function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (sessions.has(code));
  return code;
}

function createSession({ teacherId, title, description, questions }) {
  const code = genCode();
  const session = {
    code, teacherId, title, description: description || '', questions, // questions: [{enonce, options:[...], correct: index}]
    status: 'lobby', // lobby | running | ended
    students: new Map(), // name -> {secret, avatar, index, score, finished, joinedAt, finishedAt}
    createdAt: Date.now(),
  };
  sessions.set(code, session);
  return session;
}

function get(code) { return sessions.get(String(code || '').toUpperCase()); }
function remove(code) { sessions.delete(String(code || '').toUpperCase()); }
function listAll() { return Array.from(sessions.values()); }

// Ménage automatique : un quiz oublié plus de 6h est effacé (évite une fuite
// mémoire sur un serveur qui tourne longtemps sans redémarrer).
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, s] of sessions) if (s.createdAt < cutoff) sessions.delete(code);
}, 30 * 60 * 1000).unref();

module.exports = { createSession, get, remove, listAll };
