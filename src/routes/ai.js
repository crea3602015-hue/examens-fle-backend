const express = require('express');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// POST /api/ai/generate { prompt }
// Fonction optionnelle : ne fonctionne que si ANTHROPIC_API_KEY est définie dans
// les variables d'environnement du serveur. Sans elle, renvoie une erreur claire
// plutôt que de planter — l'IA reste une fonction "bonus", jamais bloquante.
router.post('/generate', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error: "La génération par IA n'est pas configurée sur ce serveur (ANTHROPIC_API_KEY absente).",
    });
  }
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Un champ "prompt" (texte) est requis.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error('Erreur API Anthropic :', response.status, text);
      return res.status(502).json({ error: "L'IA n'a pas pu répondre pour le moment." });
    }
    const data = await response.json();
    const text = (data.content || []).map(b => b.text || '').join('\n');
    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "L'IA n'a pas pu répondre pour le moment." });
  }
});

module.exports = router;
