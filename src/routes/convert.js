const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { convertChunk } = require('../convert/examAi');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN', 'TEACHER'));

// POST /api/convert/exam { text, part, parts, niveau, matiere, imageCount }
// Le navigateur lit le Word/PDF, découpe le texte en parties de taille raisonnable et appelle cette route pour chacune.
router.post('/exam', async (req, res) => {
  const text = String(req.body.text || '');
  if (text.trim().length < 20) return res.status(400).json({ error: 'Aucun texte à convertir.' });
  if (text.length > 16000) return res.status(413).json({ error: 'Cette partie du document est trop longue.' });
  try {
    const result = await convertChunk({
      text, part: Number(req.body.part) || 1, parts: Number(req.body.parts) || 1,
      niveau: String(req.body.niveau || '').slice(0, 40), matiere: String(req.body.matiere || '').slice(0, 40), imageCount: Math.min(Number(req.body.imageCount) || 0, 300),
    });
    res.json({ ia: true, ...result });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || 'La conversion a échoué.' }); }
});

module.exports = router;
