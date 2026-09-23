const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAction } = require('../audit');

const router = express.Router();

async function getOrCreateSettings() {
  let s = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  if (!s) s = await prisma.settings.create({ data: { id: 'singleton' } });
  return s;
}

// GET /api/settings — public : le logo doit pouvoir s'afficher partout, y compris pour un élève
router.get('/', async (req, res) => {
  const s = await getOrCreateSettings();
  res.json({ schoolLogoId: s.schoolLogoId, schoolLogoUrl: s.schoolLogoId ? `/api/uploads/${s.schoolLogoId}` : null });
});

// PUT /api/settings { schoolLogoId } — admin uniquement
router.put('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { schoolLogoId } = req.body || {};
  const s = await prisma.settings.upsert({
    where: { id: 'singleton' }, create: { id: 'singleton', schoolLogoId }, update: { schoolLogoId },
  });
  await logAction('Logo de l\'établissement mis à jour');
  res.json({ schoolLogoId: s.schoolLogoId, schoolLogoUrl: s.schoolLogoId ? `/api/uploads/${s.schoolLogoId}` : null });
});

module.exports = router;
