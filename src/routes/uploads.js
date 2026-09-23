const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

const MAX_BYTES = 2 * 1024 * 1024; // 2 Mo — pour préserver l'espace limité de la base de données
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg'];

// POST /api/uploads { dataBase64, mimeType } — professeur/admin uniquement
router.post('/', requireAuth, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const { dataBase64, mimeType } = req.body || {};
  if (!dataBase64 || !mimeType) return res.status(400).json({ error: 'Fichier ou type manquant.' });
  if (!ALLOWED_MIME.includes(mimeType)) return res.status(400).json({ error: 'Type de fichier non autorisé (image ou audio uniquement).' });

  const size = Buffer.byteLength(dataBase64, 'base64');
  if (size > MAX_BYTES) {
    return res.status(413).json({ error: `Fichier trop volumineux (${Math.round(size / 1024)} Ko) — compressez-le, 2 Mo maximum.` });
  }

  const file = await prisma.uploadedFile.create({ data: { mimeType, data: dataBase64, size } });
  res.status(201).json({ id: file.id, path: `/api/uploads/${file.id}` });
});

// GET /api/uploads/:id — PUBLIC (l'élève et les exports PDF doivent pouvoir le charger)
router.get('/:id', async (req, res) => {
  const file = await prisma.uploadedFile.findUnique({ where: { id: req.params.id } });
  if (!file) return res.status(404).send('Introuvable.');
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(file.data, 'base64'));
});

module.exports = router;
