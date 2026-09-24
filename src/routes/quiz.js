const express = require('express');
const { nanoid } = require('nanoid');
const { requireAuth, requireRole } = require('../auth');
const store = require('../quizStore');

const router = express.Router();

/* ---------------------------------------------------------
   Génération par IA — Groq (gratuit, sans carte bancaire).
   Créez une clé sur https://console.groq.com/keys et mettez-la
   dans la variable d'environnement GROQ_API_KEY. Sans elle,
   cette route répond clairement que la fonction est désactivée
   plutôt que de planter — tout le reste de l'app continue de
   fonctionner normalement.
--------------------------------------------------------- */
router.post('/generate', requireAuth, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: "La génération de quiz par IA n'est pas configurée sur ce serveur (GROQ_API_KEY absente)." });
  }
  const { topic, niveau, count } = req.body || {};
  if (!topic || typeof topic !== 'string') return res.status(400).json({ error: 'Un sujet est requis.' });
  const n = Math.min(Math.max(Number(count) || 5, 3), 10);

  const prompt = `Tu es un professeur de français langue étrangère qui crée un petit quiz ludique pour des élèves de niveau "${niveau || 'Primaire'}".
Sujet demandé : "${topic}".
Crée exactement ${n} questions à choix unique, en français, adaptées à ce niveau.
Réponds UNIQUEMENT avec un JSON valide, sans aucun texte autour, de cette forme exacte :
{"title": "Titre court du quiz", "questions": [{"enonce": "Texte de la question", "options": ["option A","option B","option C","option D"], "correct": 0}]}
"correct" est l'index (0,1,2 ou 3) de la bonne option dans le tableau "options". Chaque question doit avoir entre 2 et 4 options.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error('Erreur API Groq :', response.status, text);
      return res.status(502).json({ error: "L'IA n'a pas pu générer le quiz pour le moment." });
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('Réponse IA illisible.');
      parsed = JSON.parse(raw.slice(start, end + 1));
    }
    const questions = (parsed.questions || []).map(q => ({
      enonce: String(q.enonce || ''),
      options: (q.options || []).map(String),
      correct: Number(q.correct) || 0,
    })).filter(q => q.enonce && q.options.length >= 2);
    if (questions.length === 0) throw new Error('Aucune question valide générée.');
    res.json({ title: parsed.title || `Quiz — ${topic}`, questions });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "L'IA n'a pas pu générer un quiz exploitable, réessayez ou modifiez le sujet." });
  }
});

/* ---------------------------------------------------------
   Sessions de quiz — tout en mémoire, rien en base de données.
--------------------------------------------------------- */

// GET /api/quiz/sessions — liste les quiz actifs (admin: tous ; professeur: les siens)
router.get('/sessions', requireAuth, requireRole('TEACHER', 'ADMIN'), (req, res) => {
  const all = store.listAll();
  const scoped = req.user.role === 'ADMIN' ? all : all.filter(s => s.teacherId === req.user.sub);
  res.json(scoped.map(s => ({
    code: s.code, title: s.title, status: s.status, studentCount: s.students.size, createdAt: s.createdAt,
  })));
});

// POST /api/quiz/sessions — le professeur confirme le quiz (généré par IA ou modifié à la main)
router.post('/sessions', requireAuth, requireRole('TEACHER', 'ADMIN'), (req, res) => {
  const { title, description, questions } = req.body || {};
  if (!title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Titre et au moins une question sont requis.' });
  }
  const clean = questions.map(q => ({
    enonce: String(q.enonce || ''), options: (q.options || []).map(String), correct: Number(q.correct) || 0,
  })).filter(q => q.enonce && q.options.length >= 2);
  if (clean.length === 0) return res.status(400).json({ error: 'Aucune question valide.' });

  const session = store.createSession({ teacherId: req.user.sub, title, description, questions: clean });
  res.status(201).json({ code: session.code });
});

function ownedSessionOr403(req, res) {
  const session = store.get(req.params.code);
  if (!session) { res.status(404).json({ error: 'Quiz introuvable ou déjà terminé.' }); return null; }
  if (req.user.role !== 'ADMIN' && session.teacherId !== req.user.sub) {
    res.status(403).json({ error: "Ce quiz ne vous appartient pas." }); return null;
  }
  return session;
}

// POST /api/quiz/sessions/:code/start
router.post('/sessions/:code/start', requireAuth, requireRole('TEACHER', 'ADMIN'), (req, res) => {
  const session = ownedSessionOr403(req, res); if (!session) return;
  session.status = 'running';
  res.json({ ok: true });
});

// POST /api/quiz/sessions/:code/relaunch — relance une nouvelle manche sur le même code
// (efface les joueurs et les scores, garde les mêmes questions, retour au lobby)
router.post('/sessions/:code/relaunch', requireAuth, requireRole('TEACHER', 'ADMIN'), (req, res) => {
  const session = ownedSessionOr403(req, res); if (!session) return;
  session.students.clear();
  session.status = 'lobby';
  res.json({ ok: true });
});

// GET /api/quiz/sessions/:code/live — suivi en direct pour le professeur, avec classement
router.get('/sessions/:code/live', requireAuth, requireRole('TEACHER', 'ADMIN'), (req, res) => {
  const session = ownedSessionOr403(req, res); if (!session) return;
  const students = Array.from(session.students.values())
    .map(s => ({
      nom: s.nom, avatar: s.avatar || '🙂', index: s.index, total: session.questions.length,
      score: s.score, finished: s.finished, finishedAt: s.finishedAt || null,
    }))
    .sort((a, b) => (b.finished - a.finished) || (b.score - a.score) || ((a.finishedAt || Infinity) - (b.finishedAt || Infinity)));
  students.forEach((s, i) => { s.rank = i + 1; });
  res.json({ status: session.status, title: session.title, description: session.description, questionCount: session.questions.length, students });
});

// DELETE /api/quiz/sessions/:code — réinitialiser : efface tout immédiatement
router.delete('/sessions/:code', requireAuth, requireRole('TEACHER', 'ADMIN'), (req, res) => {
  const session = ownedSessionOr403(req, res); if (!session) return;
  store.remove(req.params.code);
  res.json({ ok: true });
});

// GET /api/quiz/sessions/by-code/:code — PUBLIC, écran d'accès élève
router.get('/sessions/by-code/:code', (req, res) => {
  const session = store.get(req.params.code);
  if (!session) return res.status(404).json({ error: 'Code de quiz introuvable ou expiré.' });
  res.json({ title: session.title, description: session.description, status: session.status, questionCount: session.questions.length });
});

// POST /api/quiz/sessions/:code/join — PUBLIC { nom, avatar }
router.post('/sessions/:code/join', (req, res) => {
  const session = store.get(req.params.code);
  if (!session) return res.status(404).json({ error: 'Code de quiz introuvable ou expiré.' });
  if (session.status === 'ended') return res.status(409).json({ error: 'Ce quiz est terminé.' });
  const { nom, avatar } = req.body || {};
  if (!nom || !String(nom).trim()) return res.status(400).json({ error: 'Nom requis.' });

  const secret = nanoid(20);
  session.students.set(String(nom).trim(), {
    nom: String(nom).trim(), avatar: avatar || '🙂', secret, index: 0, score: 0,
    finished: false, finishedAt: null, joinedAt: Date.now(),
  });
  res.status(201).json({
    secret, title: session.title, description: session.description,
    questions: session.questions.map(q => ({ enonce: q.enonce, options: q.options })), // jamais "correct"
  });
});

function findStudent(session, secret) {
  for (const s of session.students.values()) if (s.secret === secret) return s;
  return null;
}

// PATCH /api/quiz/sessions/:code/progress — PUBLIC { secret, index }
router.patch('/sessions/:code/progress', (req, res) => {
  const session = store.get(req.params.code);
  if (!session) return res.status(404).json({ error: 'Quiz introuvable.' });
  const student = findStudent(session, (req.body || {}).secret);
  if (!student) return res.status(403).json({ error: 'Accès refusé.' });
  student.index = Number((req.body || {}).index) || 0;
  res.json({ ok: true });
});

// POST /api/quiz/sessions/:code/submit — PUBLIC { secret, answers }
router.post('/sessions/:code/submit', (req, res) => {
  const session = store.get(req.params.code);
  if (!session) return res.status(404).json({ error: 'Quiz introuvable.' });
  const student = findStudent(session, (req.body || {}).secret);
  if (!student) return res.status(403).json({ error: 'Accès refusé.' });
  const answers = (req.body || {}).answers || [];
  let score = 0;
  session.questions.forEach((q, i) => { if (Number(answers[i]) === q.correct) score++; });
  student.score = score; student.finished = true; student.index = session.questions.length; student.finishedAt = Date.now();
  res.json({ ok: true, score, total: session.questions.length });
});

module.exports = router;
