'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

loadEnv(path.join(__dirname, '.env'));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = Boolean(process.env.VERCEL);
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOCAL_DATA_DIR = path.join(__dirname, 'data');
const LOCAL_DATA_FILE = path.join(LOCAL_DATA_DIR, 'responses.json');
const LOCAL_BACKUP_DIR = path.join(LOCAL_DATA_DIR, 'backups');
const SEED_FILE = path.join(LOCAL_DATA_DIR, 'seed-responses.json');
const RESPONSE_PREFIX = 'responses/';
const BACKUP_PREFIX = 'backups/';
const TOMBSTONE_PREFIX = 'deleted/';
const LOCAL_TOMBSTONES_FILE = path.join(LOCAL_DATA_DIR, 'deleted-ids.json');
let localWriteChain = Promise.resolve();
let blobSdkPromise = null;

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

function getAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || '').trim();
}

function getCronSecret() {
  return String(process.env.CRON_SECRET || '').trim();
}

async function getBlobSdk() {
  if (!blobSdkPromise) blobSdkPromise = import('@vercel/blob');
  return blobSdkPromise;
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

function safeEqual(aValue, bValue) {
  const a = Buffer.from(String(aValue ?? ''));
  const b = Buffer.from(String(bValue ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeAdminToken(expiresAt) {
  const password = getAdminPassword();
  const payload = String(expiresAt);
  const sig = crypto.createHmac('sha256', password).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function isAdmin(req) {
  const password = getAdminPassword();
  if (!password) return false;
  const token = parseCookies(req).admin_session || '';
  const [expiresRaw, sig] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (!expiresAt || !sig || Date.now() > expiresAt) return false;
  const expected = crypto.createHmac('sha256', password).update(expiresRaw).digest('hex');
  return safeEqual(sig, expected);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Niet ingelogd.' });
  next();
}

async function ensureLocalDataFile() {
  await fsp.mkdir(LOCAL_DATA_DIR, { recursive: true });
  try { await fsp.access(LOCAL_DATA_FILE); }
  catch { await fsp.writeFile(LOCAL_DATA_FILE, '[]\n', 'utf8'); }
}

async function readLocalResponses() {
  await ensureLocalDataFile();
  try {
    const parsed = JSON.parse(await fsp.readFile(LOCAL_DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Kon lokale responses.json niet lezen:', error);
    return [];
  }
}

async function writeLocalResponses(rows) {
  localWriteChain = localWriteChain.then(async () => {
    await ensureLocalDataFile();
    const temp = LOCAL_DATA_FILE + '.tmp';
    await fsp.writeFile(temp, JSON.stringify(rows, null, 2) + '\n', 'utf8');
    await fsp.rename(temp, LOCAL_DATA_FILE);
  });
  return localWriteChain;
}

async function readBlobJson(pathname) {
  const { get } = await getBlobSdk();
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function listBlobObjects(prefix) {
  const { list } = await getBlobSdk();
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function readBlobResponses() {
  const blobs = await listBlobObjects(RESPONSE_PREFIX);
  const rows = [];
  const batchSize = 25;
  for (let i = 0; i < blobs.length; i += batchSize) {
    const batch = blobs.slice(i, i + batchSize);
    const values = await Promise.all(batch.map(async blob => {
      try { return await readBlobJson(blob.pathname); }
      catch (error) { console.error('Blob lezen mislukt:', blob.pathname, error); return null; }
    }));
    rows.push(...values.filter(Boolean));
  }
  return rows;
}


async function readSeedResponses() {
  try {
    const parsed = JSON.parse(await fsp.readFile(SEED_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

async function readLocalTombstones() {
  try {
    const parsed = JSON.parse(await fsp.readFile(LOCAL_TOMBSTONES_FILE, 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (_) { return new Set(); }
}

async function addTombstone(id) {
  if (!IS_VERCEL) {
    const set = await readLocalTombstones(); set.add(id);
    await fsp.mkdir(LOCAL_DATA_DIR,{recursive:true});
    await fsp.writeFile(LOCAL_TOMBSTONES_FILE, JSON.stringify([...set], null, 2)+'\n','utf8');
    return;
  }
  const { put } = await getBlobSdk();
  await put(`${TOMBSTONE_PREFIX}${id}.json`, JSON.stringify({id,deletedAt:new Date().toISOString()}), {access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:true});
}

async function ensureSeedResponses() {
  const seeds = await readSeedResponses();
  if (!seeds.length) return 0;
  if (!IS_VERCEL) {
    const current = await readLocalResponses();
    const ids = new Set(current.map(r => r.id));
    const deleted = await readLocalTombstones();
    const missing = seeds.filter(r => !ids.has(r.id) && !deleted.has(r.id));
    if (missing.length) await writeLocalResponses([...current, ...missing]);
    return missing.length;
  }
  const [blobs, tombstones] = await Promise.all([listBlobObjects(RESPONSE_PREFIX), listBlobObjects(TOMBSTONE_PREFIX)]);
  const existingIds = new Set(blobs.map(b => { const m = b.pathname.match(/_([^_\/]+)\.json$/); return m ? m[1] : ''; }));
  const deletedIds = new Set(tombstones.map(b => path.basename(b.pathname,'.json')));
  let added = 0;
  const { put } = await getBlobSdk();
  for (const record of seeds) {
    if (existingIds.has(record.id) || deletedIds.has(record.id)) continue;
    const safeTime = String(record.createdAt || new Date().toISOString()).replace(/[:.]/g, '-');
    const pathname = `${RESPONSE_PREFIX}${safeTime}_${record.id}.json`;
    await put(pathname, JSON.stringify(record, null, 2), { access: 'private', contentType: 'application/json', addRandomSuffix: false });
    added++;
  }
  if (added) {
    const legacyBackup = { version:1, createdAt:new Date().toISOString(), reason:'hersteld-uit-67school-resultaten.csv', count:seeds.length, responses:seeds };
    await put(`${BACKUP_PREFIX}legacy-import.json`, JSON.stringify(legacyBackup, null, 2), { access:'private', contentType:'application/json', addRandomSuffix:false, allowOverwrite:true });
  }
  return added;
}

async function readResponses() {
  if (!IS_VERCEL) { await ensureSeedResponses(); return readLocalResponses(); }
  await ensureSeedResponses();
  try {
    return await readBlobResponses();
  } catch (error) {
    console.error('Vercel Blob lezen mislukt:', error);
    throw new Error('Permanente opslag is niet beschikbaar. Controleer Vercel Blob.');
  }
}

async function saveResponse(record) {
  if (!IS_VERCEL) {
    const rows = await readLocalResponses();
    rows.push(record);
    await writeLocalResponses(rows);
    return;
  }
  try {
    const { put } = await getBlobSdk();
    const safeTime = record.createdAt.replace(/[:.]/g, '-');
    const pathname = `${RESPONSE_PREFIX}${safeTime}_${record.id}.json`;
    await put(pathname, JSON.stringify(record, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false
    });
  } catch (error) {
    console.error('Vercel Blob opslaan mislukt:', error);
    throw new Error('Opslaan is mislukt. Je antwoord is NIET bewaard; probeer opnieuw of meld dit bij de organisatie.');
  }
}

async function deleteResponseById(id) {
  if (!IS_VERCEL) {
    const rows = await readLocalResponses();
    const next = rows.filter(r => r.id !== id);
    if (next.length === rows.length) return false;
    await writeLocalResponses(next);
    await addTombstone(id);
    return true;
  }
  const { del } = await getBlobSdk();
  const blobs = await listBlobObjects(RESPONSE_PREFIX);
  const target = blobs.find(b => b.pathname.endsWith(`_${id}.json`));
  if (!target) return false;
  await del(target.url || target.pathname);
  await addTombstone(id);
  return true;
}

async function listBackups() {
  if (!IS_VERCEL) {
    try {
      const names = (await fsp.readdir(LOCAL_BACKUP_DIR)).filter(n => n.endsWith('.json') && n !== 'latest.json').sort().reverse();
      return Promise.all(names.map(async name => {
        const st = await fsp.stat(path.join(LOCAL_BACKUP_DIR, name));
        return { id: name, pathname: `data/backups/${name}`, createdAt: st.mtime.toISOString(), size: st.size };
      }));
    } catch { return []; }
  }
  const blobs = await listBlobObjects(BACKUP_PREFIX);
  return blobs.filter(b => b.pathname !== `${BACKUP_PREFIX}latest.json`).sort((a,b)=>new Date(b.uploadedAt||0)-new Date(a.uploadedAt||0)).map(b=>({
    id: Buffer.from(b.pathname).toString('base64url'), pathname:b.pathname, createdAt:b.uploadedAt, size:b.size
  }));
}

async function readBackupById(id) {
  if (!IS_VERCEL) {
    const safe = path.basename(String(id));
    return JSON.parse(await fsp.readFile(path.join(LOCAL_BACKUP_DIR, safe), 'utf8'));
  }
  const pathname = Buffer.from(String(id), 'base64url').toString('utf8');
  if (!pathname.startsWith(BACKUP_PREFIX)) throw new Error('Ongeldige backup.');
  return readBlobJson(pathname);
}

async function responseIdExists(id) {
  const rows = await readResponses();
  return rows.some(row => row.id === id);
}

async function createBackup(reason = 'manual') {
  const rows = await readResponses();
  const createdAt = new Date().toISOString();
  const snapshot = { version: 1, createdAt, reason, count: rows.length, responses: rows };

  if (!IS_VERCEL) {
    await fsp.mkdir(LOCAL_BACKUP_DIR, { recursive: true });
    const filename = `${createdAt.replace(/[:.]/g, '-')}.json`;
    await fsp.writeFile(path.join(LOCAL_BACKUP_DIR, filename), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    await fsp.writeFile(path.join(LOCAL_BACKUP_DIR, 'latest.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    return { createdAt, count: rows.length, pathname: path.join('data', 'backups', filename) };
  }

  const { put } = await getBlobSdk();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const pathname = `${BACKUP_PREFIX}${stamp}.json`;
  const body = JSON.stringify(snapshot, null, 2);
  await put(pathname, body, { access: 'private', contentType: 'application/json', addRandomSuffix: false });
  await put(`${BACKUP_PREFIX}latest.json`, body, { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  return { createdAt, count: rows.length, pathname };
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
  const today = new Date().toDateString();
  return {
    total: rows.length,
    classes: countValues(rows, 'className'),
    activities: countValues(rows, 'activities'),
    foods: countValues(rows, 'foods'),
    music: countValues(rows, 'music'),
    extras: countValues(rows, 'extras'),
    submittedToday: rows.filter(r => new Date(r.createdAt).toDateString() === today).length
  };
}

function maskedIp(req) {
  const raw = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (!raw) return '';
  if (raw.includes(':')) {
    const parts = raw.split(':').filter(Boolean);
    return parts.slice(0, 4).join(':') + ':…';
  }
  const parts = raw.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : '';
}

function collectServerDeviceInfo(req) {
  return {
    requestUserAgent: sanitizeText(req.headers['user-agent'], 500),
    acceptLanguage: sanitizeText(req.headers['accept-language'], 200),
    secChUa: sanitizeText(req.headers['sec-ch-ua'], 300),
    secChUaMobile: sanitizeText(req.headers['sec-ch-ua-mobile'], 50),
    secChUaPlatform: sanitizeText(req.headers['sec-ch-ua-platform'], 100),
    maskedIp: maskedIp(req)
  };
}

function sanitizeDevice(value, req) {
  const d = value && typeof value === 'object' ? value : {};
  return {
    clientId: sanitizeText(d.clientId, 100),
    deviceType: sanitizeText(d.deviceType, 60),
    os: sanitizeText(d.os, 100),
    browser: sanitizeText(d.browser, 120),
    browserBrands: sanitizeText(d.browserBrands, 300),
    platform: sanitizeText(d.platform, 100),
    screen: sanitizeText(d.screen, 60),
    viewport: sanitizeText(d.viewport, 60),
    pixelRatio: sanitizeText(d.pixelRatio, 30),
    colorDepth: sanitizeText(d.colorDepth, 30),
    language: sanitizeText(d.language, 60),
    languages: sanitizeText(d.languages, 200),
    timezone: sanitizeText(d.timezone, 100),
    hardwareConcurrency: sanitizeText(d.hardwareConcurrency, 30),
    deviceMemory: sanitizeText(d.deviceMemory, 30),
    maxTouchPoints: sanitizeText(d.maxTouchPoints, 30),
    cookieEnabled: sanitizeText(d.cookieEnabled, 20),
    doNotTrack: sanitizeText(d.doNotTrack, 30),
    connection: sanitizeText(d.connection, 200),
    userAgent: sanitizeText(d.userAgent, 500),
    ...collectServerDeviceInfo(req)
  };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.post('/api/submit', async (req, res) => {
  try {
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
      device: sanitizeDevice(body.device, req),
      createdAt: new Date().toISOString()
    };

    await saveResponse(record);
    // De inzending zelf is al permanent opgeslagen als los, immutable Blob-object.
    // Daarnaast maken we direct een volledige JSON-snapshot. Een mislukte snapshot
    // maakt de reeds opgeslagen inzending niet ongedaan.
    try { await createBackup('after-submit'); } catch (backupError) { console.error('Snapshot na inzending mislukt:', backupError); }
    res.status(201).json({ ok: true, id: record.id, storage: IS_VERCEL ? 'vercel-blob-private' : 'local-json' });
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: error.message || 'Opslaan mislukt.' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const password = getAdminPassword();
  if (!password) return res.status(503).json({ error: 'ADMIN_PASSWORD is niet ingesteld in Vercel.' });
  const candidate = String(req.body?.password || '');
  if (!safeEqual(candidate, password)) return res.status(401).json({ error: 'Onjuist wachtwoord.' });
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
  res.json({
    authenticated: isAdmin(req),
    adminPasswordConfigured: Boolean(getAdminPassword()),
    storageMode: IS_VERCEL ? 'Vercel Private Blob' : 'Lokale JSON'
  });
});

app.get('/api/admin/results', requireAdmin, async (req, res) => {
  try {
    const rows = await readResponses();
    const q = sanitizeText(req.query.q, 100).toLowerCase();
    const classFilter = sanitizeText(req.query.className, 40).toLowerCase();
    const filtered = rows.filter(row => {
      const deviceSearch = Object.values(row.device || {}).join(' ').toLowerCase();
      const searchable = [row.name, row.className, row.idea, row.dietary, ...(row.activities || []), ...(row.foods || []), ...(row.music || []), ...(row.extras || [])].join(' ').toLowerCase();
      return (!q || searchable.includes(q) || deviceSearch.includes(q)) && (!classFilter || String(row.className).toLowerCase() === classFilter);
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ rows: filtered, stats: buildStats(rows), totalFiltered: filtered.length, storageMode: IS_VERCEL ? 'Vercel Private Blob' : 'Lokale JSON' });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Resultaten konden niet worden geladen.' });
  }
});

app.get('/api/admin/storage-status', requireAdmin, async (_req, res) => {
  let responseCount = null;
  let backupCount = null;
  let ok = true;
  let error = '';
  try {
    if (IS_VERCEL) {
      responseCount = (await listBlobObjects(RESPONSE_PREFIX)).length;
      backupCount = (await listBlobObjects(BACKUP_PREFIX)).filter(b => b.pathname !== `${BACKUP_PREFIX}latest.json`).length;
    } else {
      responseCount = (await readLocalResponses()).length;
      try { backupCount = (await fsp.readdir(LOCAL_BACKUP_DIR)).filter(x => x.endsWith('.json') && x !== 'latest.json').length; }
      catch { backupCount = 0; }
    }
  } catch (e) { ok = false; error = e.message; }
  res.json({ ok, storageMode: IS_VERCEL ? 'Vercel Private Blob' : 'Lokale JSON', responseCount, backupCount, cronConfigured: Boolean(getCronSecret()), adminPasswordConfigured: Boolean(getAdminPassword()), error });
});

app.post('/api/admin/backup-now', requireAdmin, async (_req, res) => {
  try { res.json({ ok: true, backup: await createBackup('manual-admin') }); }
  catch (error) { res.status(503).json({ error: error.message || 'Backup mislukt.' }); }
});

app.get('/api/cron/backup', async (req, res) => {
  const secret = getCronSecret();
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET ontbreekt.' });
  const auth = String(req.headers.authorization || '');
  if (!safeEqual(auth, `Bearer ${secret}`)) return res.status(401).json({ error: 'Niet toegestaan.' });
  try { res.json({ ok: true, backup: await createBackup('vercel-cron-15m') }); }
  catch (error) { res.status(503).json({ error: error.message || 'Backup mislukt.' }); }
});

app.delete('/api/admin/results/:id', requireAdmin, async (req, res) => {
  try {
    const id = sanitizeText(req.params.id, 120);
    await createBackup('before-delete');
    const deleted = await deleteResponseById(id);
    if (!deleted) return res.status(404).json({ error: 'Reactie niet gevonden.' });
    res.json({ ok: true });
  } catch (error) { res.status(503).json({ error: error.message || 'Verwijderen mislukt.' }); }
});

app.get('/api/admin/backups', requireAdmin, async (_req, res) => {
  try { res.json({ backups: await listBackups() }); }
  catch (error) { res.status(503).json({ error: error.message || 'Back-ups laden mislukt.' }); }
});

app.get('/api/admin/backups/:id/download', requireAdmin, async (req, res) => {
  try {
    const data = await readBackupById(req.params.id);
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="67school-backup-${Date.now()}.json"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (error) { res.status(404).json({ error: error.message || 'Back-up niet gevonden.' }); }
});

app.get('/api/admin/backups-download-all', requireAdmin, async (_req, res) => {
  try {
    const backups = await listBackups();
    const items = [];
    for (const b of backups) {
      try { items.push({ meta:b, data: await readBackupById(b.id) }); } catch (_) {}
    }
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="67school-alle-backups.json"');
    res.send(JSON.stringify({ exportedAt:new Date().toISOString(), count:items.length, backups:items }, null, 2));
  } catch (error) { res.status(503).json({ error: error.message || 'Back-ups exporteren mislukt.' }); }
});

app.get('/api/admin/export.csv', requireAdmin, async (_req, res) => {
  const rows = await readResponses();
  const headers = ['id','naam','klas','activiteiten','eten','muziek','extras','eigen_idee','dieet_allergie','device_type','os','browser','browser_brands','platform','screen','viewport','pixel_ratio','color_depth','language','languages','timezone','cpu_threads','device_memory','touch_points','cookies','do_not_track','connection','client_id','user_agent','request_user_agent','accept_language','sec_ch_ua','sec_ch_ua_mobile','sec_ch_ua_platform','masked_ip','ingediend_op'];
  const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const row of rows) {
    const d = row.device || {};
    lines.push([
      row.id,row.name,row.className,(row.activities||[]).join(' | '),(row.foods||[]).join(' | '),(row.music||[]).join(' | '),(row.extras||[]).join(' | '),row.idea,row.dietary,
      d.deviceType,d.os,d.browser,d.browserBrands,d.platform,d.screen,d.viewport,d.pixelRatio,d.colorDepth,d.language,d.languages,d.timezone,d.hardwareConcurrency,d.deviceMemory,d.maxTouchPoints,d.cookieEnabled,d.doNotTrack,d.connection,d.clientId,d.userAgent,d.requestUserAgent,d.acceptLanguage,d.secChUa,d.secChUaMobile,d.secChUaPlatform,d.maskedIp,row.createdAt
    ].map(escape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="67school-resultaten.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});

app.get('/api/admin/export.json', requireAdmin, async (_req, res) => {
  const rows = await readResponses();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="67school-resultaten.json"');
  res.send(JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, responses: rows }, null, 2));
});

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

app.post('/api/admin/import.csv', requireAdmin, express.text({ type: ['text/csv','text/plain','application/csv','application/vnd.ms-excel'], limit: '5mb' }), async (req, res) => {
  try {
    const csv = String(req.body || '').replace(/^\ufeff/, '');
    if (!csv.trim()) return res.status(400).json({ error: 'Leeg CSV-bestand.' });
    const parsed = parseCsv(csv);
    if (parsed.length < 2) return res.status(400).json({ error: 'CSV bevat geen gegevens.' });
    const headers = parsed[0].map(h => String(h).trim().toLowerCase());
    const idx = key => headers.indexOf(key);
    const get = (r, key) => idx(key) >= 0 ? r[idx(key)] || '' : '';
    const splitList = v => String(v || '').split('|').map(x => sanitizeText(x.trim(), 80)).filter(Boolean);
    const existing = await readResponses();
    const knownIds = new Set(existing.map(r => r.id));
    let imported = 0;
    for (const r of parsed.slice(1)) {
      const name = sanitizeText(get(r, 'naam'), 80);
      const className = sanitizeText(get(r, 'klas'), 40);
      if (!name || !className) continue;
      const id = sanitizeText(get(r, 'id'), 100) || crypto.randomUUID();
      if (knownIds.has(id)) continue;
      knownIds.add(id);
      const record = {
        id,name,className,
        activities: splitList(get(r,'activiteiten')),foods: splitList(get(r,'eten')),music: splitList(get(r,'muziek')),extras: splitList(get(r,'extras')),
        idea:sanitizeText(get(r,'eigen_idee'),500),dietary:sanitizeText(get(r,'dieet_allergie'),300),
        device:{deviceType:sanitizeText(get(r,'device_type'),60),os:sanitizeText(get(r,'os'),100),browser:sanitizeText(get(r,'browser'),120),platform:sanitizeText(get(r,'platform'),100),screen:sanitizeText(get(r,'screen'),60),language:sanitizeText(get(r,'language'),60),timezone:sanitizeText(get(r,'timezone'),100),clientId:sanitizeText(get(r,'client_id'),100),userAgent:sanitizeText(get(r,'user_agent'),500)},
        createdAt:(()=>{const d=new Date(get(r,'ingediend_op'));return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString()})()
      };
      await saveResponse(record); imported++;
    }
    res.json({ ok: true, imported, skipped: parsed.length - 1 - imported });
  } catch (error) { res.status(503).json({ error: error.message || 'Import mislukt.' }); }
});

app.post('/api/admin/import.json', requireAdmin, express.text({ type: ['application/json','text/plain'], limit: '10mb' }), async (req, res) => {
  try {
    const parsed = JSON.parse(String(req.body || ''));
    const incoming = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.responses) ? parsed.responses : []);
    if (!incoming.length) return res.status(400).json({ error: 'JSON bevat geen inzendingen.' });
    const existing = await readResponses();
    const knownIds = new Set(existing.map(r => r.id));
    let imported = 0;
    for (const raw of incoming) {
      const name = sanitizeText(raw.name,80), className=sanitizeText(raw.className,40);
      if (!name || !className) continue;
      const id = sanitizeText(raw.id,100) || crypto.randomUUID();
      if (knownIds.has(id)) continue;
      knownIds.add(id);
      const record = {
        id,name,className,
        activities:sanitizeArray(raw.activities),foods:sanitizeArray(raw.foods),music:sanitizeArray(raw.music),extras:sanitizeArray(raw.extras),
        idea:sanitizeText(raw.idea,500),dietary:sanitizeText(raw.dietary,300),
        device: raw.device && typeof raw.device === 'object' ? Object.fromEntries(Object.entries(raw.device).map(([k,v])=>[sanitizeText(k,60),sanitizeText(v,500)])) : {},
        createdAt:(()=>{const d=new Date(raw.createdAt);return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString()})()
      };
      await saveResponse(record); imported++;
    }
    res.json({ ok:true, imported, skipped: incoming.length-imported });
  } catch (error) { res.status(400).json({ error: error.message || 'JSON import mislukt.' }); }
});

app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

if (require.main === module) {
  ensureLocalDataFile().then(() => {
    app.listen(PORT, () => {
      console.log(`67school draait op http://localhost:${PORT}`);
      console.log('Lokale opslag: data/responses.json');
      if (!getAdminPassword()) console.warn('WAARSCHUWING: ADMIN_PASSWORD ontbreekt in .env.');
    });
  });
}

module.exports = app;
