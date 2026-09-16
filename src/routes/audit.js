const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// GET /api/audit?limit=200
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const list = await prisma.auditLog.findMany({ orderBy: { at: 'desc' }, take: limit });
  res.json(list);
});

module.exports = router;
