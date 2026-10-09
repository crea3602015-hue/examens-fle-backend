const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { record, device } = require('../activity');

const router = express.Router();
router.use(requireAuth);

// POST /api/activity/ping { tab } : l'application signale la page ouverte (une fois par changement de page).
router.post('/ping', async (req, res) => {
  const tab = String((req.body && req.body.tab) || '').replace(/[^a-zA-Z0-9_ -]/g, '').slice(0, 40);
  if (tab) await record({ userId: req.user.sub, userName: req.user.name || null, role: req.user.role || null, kind: 'page', action: tab, device: device(req.headers['user-agent']), ip: req.ip || null });
  res.json({ ok: true });
});

router.use(requireRole('ADMIN'));

const dayKey = (d, off) => new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
const hourOf = (d, off) => new Date(d.getTime() - off * 60000).getUTCHours();

// GET /api/activity/stats?days=30&tz=360  (tz = décalage du navigateur en minutes, comme Date.getTimezoneOffset)
router.get('/stats', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const off = Number.isFinite(Number(req.query.tz)) ? Number(req.query.tz) : 0;
  const since = new Date(Date.now() - days * 864e5);
  const [rows, users] = await Promise.all([
    prisma.activityLog.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' }, take: 30000 }),
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, lastLogin: true, status: true } }),
  ]);
  const per = new Map(users.map(u => [u.id, { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, lastLogin: u.lastLogin, logins: 0, failed: 0, actions: 0, pages: 0, lastSeen: null, devices: new Set() }]));
  const byHour = Array(24).fill(0), byDay = {}, devices = {}, tops = {};
  let logins = 0, failed = 0, actions = 0;
  rows.forEach(r => {
    const u = r.userId ? per.get(r.userId) : null;
    if (r.kind === 'login') { logins++; if (u) u.logins++; byHour[hourOf(r.at, off)]++; const k = dayKey(r.at, off); (byDay[k] = byDay[k] || { logins: 0, actions: 0 }).logins++; }
    else if (r.kind === 'login_failed') failed++, u && u.failed++;
    else if (r.kind === 'action') { actions++; if (u) u.actions++; tops[r.action] = (tops[r.action] || 0) + 1; const k = dayKey(r.at, off); (byDay[k] = byDay[k] || { logins: 0, actions: 0 }).actions++; }
    else if (r.kind === 'page' && u) u.pages++;
    if (u && r.kind !== 'login_failed') { u.lastSeen = r.at; if (r.device) u.devices.add(r.device); }
    if (r.kind === 'login' && r.device) devices[r.device] = (devices[r.device] || 0) + 1;
  });
  const list = [...per.values()].map(u => ({ ...u, devices: [...u.devices] })).sort((a, b) => (b.actions + b.logins) - (a.actions + a.logins));
  res.json({
    days, totals: { logins, failed, actions, activeUsers: list.filter(u => u.logins || u.actions || u.pages).length, users: list.length },
    users: list, byHour, byDay: Object.entries(byDay).sort().map(([day, v]) => ({ day, ...v })),
    devices: Object.entries(devices).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    topActions: Object.entries(tops).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([action, count]) => ({ action, count })),
  });
});

// GET /api/activity/recent?userId=&limit=100
router.get('/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const where = req.query.userId ? { userId: String(req.query.userId) } : {};
  res.json(await prisma.activityLog.findMany({ where, orderBy: { at: 'desc' }, take: limit }));
});

module.exports = router;
