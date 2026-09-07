'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

loadEnv(path.join(__dirname, '.env'));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'verander-dit-wachtwoord';
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = process.env.DATA_DIR || (IS_VERCEL ? path.join('/tmp', '67school-data') : path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'responses.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const sseClients = new Set();
let writeChain = Promise.resolve();

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const clean = line.trim();
      if (!clean || clean.startsWith('#')) continue;
      const idx = clean.indexOf('=');
      if (idx === -1) continue;
      const key = clean.slice(0, idx).trim();
      const value = clean.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (_) {}
}

async function ensureDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(DATA_FILE);
  } catch {
    await fsp.writeFile(DATA_FILE, '[]\n', 'utf8');
  }
}

async function readResponses() {
  await ensureDataFile();
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Kon responses.json niet lezen:', error);
    return [];
  }
}

function writeResponses(rows) {
  writeChain = writeChain.then(async () => {
    await ensureDataFile();
    const temp = DATA_FILE + '.tmp';
    await fsp.writeFile(temp, JSON.stringify(rows, null, 2) + '\n', 'utf8');
    await fsp.rename(temp, DATA_FILE);
  });
  return writeChain;
}

function sanitizeText(value, max = 120) {
  return String(value ?? '').trim().replace(/[<>]/g, '').slice(0, max);
}

function sanitizeArray(value, maxItems = 20, maxLen = 80) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(v => sanitizeText(v, maxLen)).filter(Boolean))].slice(0, maxItems);
}

function parseCookies(req) {
  const result = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    result[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return result;
}

function makeAdminToken(expiresAt) {
  const payload = String(expiresAt);
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function isAdmin(req) {
  const token = parseCookies(req).admin_session || '';
  const [expiresRaw, sig] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (!expiresAt || !sig || Date.now() > expiresAt) return false;
  const expected = crypto.createHmac('sha256', ADMIN_PASSWORD).update(expiresRaw).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Niet ingelogd.' });
  next();
}

function notifyAdmins() {
  for (const res of sseClients) {
    res.write(`event: update\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  }
}

function countValues(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key];
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (!item) continue;
      counts[item] = (counts[item] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'nl'));
}

function buildStats(rows) {
  return {
    total: rows.length,
    classes: countValues(rows, 'className'),
    activities: countValues(rows, 'activities'),
    foods: countValues(rows, 'foods'),
    music: countValues(rows, 'music'),
    extras: countValues(rows, 'extras'),
    submittedToday: rows.filter(r => {
      const d = new Date(r.createdAt);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length
  };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.post('/api/submit', async (req, res) => {
  const body = req.body || {};
  const name = sanitizeText(body.name, 80);
  const className = sanitizeText(body.className, 40);
  const activities = sanitizeArray(body.activities);
  const foods = sanitizeArray(body.foods);
  const music = sanitizeArray(body.music);
  const extras = sanitizeArray(body.extras);
  const idea = sanitizeText(body.idea, 500);
  const dietary = sanitizeText(body.dietary, 300);

  if (name.length < 2) return res.status(400).json({ error: 'Vul je naam in.' });
  if (!className) return res.status(400).json({ error: 'Vul je klas in.' });
  if (!activities.length) return res.status(400).json({ error: 'Kies minimaal één activiteit.' });
  if (!foods.length) return res.status(400).json({ error: 'Kies minimaal één soort eten.' });

  const rows = await readResponses();
  const record = {
    id: crypto.randomUUID(),
    name,
    className,
    activities,
    foods,
    music,
    extras,
    idea,
    dietary,
    createdAt: new Date().toISOString()
  };
  rows.push(record);
  await writeResponses(rows);
  notifyAdmins();
  res.status(201).json({ ok: true, id: record.id });
});

app.post('/api/admin/login', (req, res) => {
  const candidate = String(req.body?.password || '');
  const a = Buffer.from(candidate);
  const b = Buffer.from(ADMIN_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Onjuist wachtwoord.' });

  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const token = makeAdminToken(expiresAt);
  const secure = process.env.NODE_ENV === 'production' || IS_VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (_req, res) => {
  const secure = process.env.NODE_ENV === 'production' || IS_VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ authenticated: isAdmin(req), defaultPasswordWarning: ADMIN_PASSWORD === 'verander-dit-wachtwoord' });
});

app.get('/api/admin/results', requireAdmin, async (req, res) => {
  const rows = await readResponses();
  const q = sanitizeText(req.query.q, 100).toLowerCase();
  const classFilter = sanitizeText(req.query.className, 40).toLowerCase();
  const filtered = rows.filter(row => {
    const matchQ = !q || row.name.toLowerCase().includes(q) || row.className.toLowerCase().includes(q) || row.idea.toLowerCase().includes(q);
    const matchClass = !classFilter || row.className.toLowerCase() === classFilter;
    return matchQ && matchClass;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ rows: filtered, stats: buildStats(rows), totalFiltered: filtered.length });
});

app.get('/api/admin/events', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write('event: ready\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/admin/export.csv', requireAdmin, async (_req, res) => {
  const rows = await readResponses();
  const headers = ['naam','klas','activiteiten','eten','muziek','extras','eigen_idee','dieet_allergie','ingediend_op'];
  const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.name, row.className, row.activities.join(' | '), row.foods.join(' | '), row.music.join(' | '), row.extras.join(' | '), row.idea, row.dietary, row.createdAt
    ].map(escape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="67school-resultaten.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});

app.delete('/api/admin/results/:id', requireAdmin, async (req, res) => {
  const rows = await readResponses();
  const next = rows.filter(r => r.id !== req.params.id);
  if (next.length === rows.length) return res.status(404).json({ error: 'Resultaat niet gevonden.' });
  await writeResponses(next);
  notifyAdmins();
  res.json({ ok: true });
});

app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

if (require.main === module) {
  ensureDataFile().then(() => {
    app.listen(PORT, () => {
      console.log(`67school draait op http://localhost:${PORT}`);
      if (ADMIN_PASSWORD === 'verander-dit-wachtwoord') {
        console.warn('WAARSCHUWING: wijzig ADMIN_PASSWORD in .env voordat je de site publiek zet.');
      }
    });
  });
}

module.exports = app;
