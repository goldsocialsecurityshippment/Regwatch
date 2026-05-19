require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('X-Content-Type-Options',       'nosniff');
  res.setHeader('X-Frame-Options',              'DENY');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.use((req, res, next) => {
  const url = require('url');
  const parsed = url.parse(req.url, true);
  req.query = parsed.query;
  req.url   = parsed.pathname;
  next();
});

app.use('/api/health',                 require('./api/health'));
app.use('/api/auth/login',             require('./api/auth/login'));
app.use('/api/auth/signup',            require('./api/auth/signup'));
app.use('/api/users/approve',          require('./api/users/approve'));
app.use('/api/changes/actions',        require('./api/changes/actions'));
app.use('/api/auth/me',                require('./api/auth/me'));
app.use('/api/auth/change-password',   require('./api/auth/change-password'));
app.use('/api/sources',                require('./api/sources/index'));
app.use('/api/scans',                  require('./api/scans/index'));
app.use('/api/changes',                require('./api/changes/index'));
app.use('/api/review-queue',           require('./api/review-queue/index'));
app.use('/api/audit',                  require('./api/audit/index'));
app.use('/api/users',                  require('./api/users/index'));
app.use('/api/stats',                  require('./api/stats'));
app.use('/api/activity',               require('./api/activity'));
app.use('/api/jurisdictions',          require('./api/jurisdictions'));
app.use('/api/setup',                  require('./api/setup'));
app.use('/api/export/csv',             require('./api/export/csv'));
app.use('/api/notifications/settings', require('./api/notifications/settings'));
app.use('/health',                     require('./api/health'));

app.use('/api/sources/:id', (req, res, next) => {
  req.query = req.query || {};
  req.query.id = req.params.id;
  require('./api/sources/[id]')(req, res, next);
});

app.use('/api/review-queue/:id', (req, res, next) => {
  req.query = req.query || {};
  req.query.id = req.params.id;
  require('./api/review-queue/[id]')(req, res, next);
});

app.use('/api/users/:id', (req, res, next) => {
  req.query = req.query || {};
  req.query.id = req.params.id;
  require('./api/users/[id]')(req, res, next);
});

app.post('/api/changes/:id/review', (req, res, next) => {
  req.url = `/api/changes/${req.params.id}/review`;
  require('./api/changes/index')(req, res, next);
});

app.post('/api/reports/generate', require('./api/reports/generate'));

app.get('/api/test-scrape', async (req, res) => {
  const axios = require('axios');
  const url = req.query.url || 'https://www.google.com';
  try {
    const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'RegWatch/5.0' } });
    res.json({ ok: true, status: r.status, length: r.data.length, url });
  } catch (err) {
    res.json({ ok: false, error: err.message, code: err.code, url });
  }
});

app.get('/api/debug-scan', async (req, res) => {
  try {
    const db = require('./lib/db');
    const { scrapeSource, detectChanges } = require('./lib/scraper');
    const sources = await db.getAllSources('BM');
    if (!sources.length) return res.json({ error: 'No BM sources' });
    const source = sources[0];
    const exact_url = source.exact_url || source.url;
    const institution_name = source.institution_name || source.institution;
    const scrapeInput = { ...source, exact_url, institution_name, page_title: source.page_title || source.title, keywords: source.keywords || [] };
    let scrapeResult;
    try { scrapeResult = await scrapeSource(scrapeInput); }
    catch(e) { return res.json({ stage: 'SCRAPE', error: e.message, stack: e.stack?.split('\n').slice(0,4) }); }
    let previous;
    try { previous = await db.getSourceSnapshot(source.id); }
    catch(e) { return res.json({ stage: 'GET_SNAPSHOT', error: e.message }); }
    let changes = [];
    try { changes = detectChanges(previous ? { documentLinks: previous.documentLinks||[], contentHash: previous.contentHash } : null, scrapeResult, scrapeInput) || []; }
    catch(e) { return res.json({ stage: 'DETECT_CHANGES', error: e.message, stack: e.stack?.split('\n').slice(0,4) }); }
    try { await db.updateSourceSnapshot(source.id, scrapeResult); }
    catch(e) { return res.json({ stage: 'SAVE_SNAPSHOT', error: e.message }); }
    res.json({ ok: true, source: institution_name, url: exact_url, scrape: { ok: scrapeResult.ok, docs: scrapeResult.documentLinks?.length, hash: scrapeResult.contentHash?.substring(0,8), error: scrapeResult.error }, changes: changes.length, changeTypes: changes.map(c=>c.change_type) });
  } catch(e) {
    res.json({ stage: 'UNKNOWN', error: e.message, stack: e.stack?.split('\n').slice(0,5) });
  }
});

app.use(express.static(path.join(__dirname)));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// ── Auto Scan Scheduler ──────────────────────────────────────
// Runs a full scan automatically every 24 hours at 6:00 AM UTC
function scheduleAutoScan() {
  const SCAN_HOUR = 6;
  const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const scanState = require('./api/scans/index').getScanState;
  const db = require('./lib/db');
  const { scrapeSource, detectChanges } = require('./lib/scraper');

  function getNextScanDelay() {
    const now = new Date();
    const next = new Date();
    next.setUTCHours(SCAN_HOUR, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  }

  async function runAutoScan() {
    const state = scanState();
    if (state.scanRunning) {
      console.log('[scheduler] Scan already running, skipping auto scan');
      setTimeout(runAutoScan, SCAN_INTERVAL_MS);
      return;
    }
    console.log('[scheduler] Starting automatic daily scan for all jurisdictions...');
    try {
      // Simulate internal POST request to trigger scan
      const http = require('http');
      const postData = JSON.stringify({ jurisdiction: 'all' });
      // Get admin token from DB
      const adminUser = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1").catch(() => null);
      if (!adminUser || !adminUser.rows[0]) {
        console.log('[scheduler] No admin user found, skipping');
        setTimeout(runAutoScan, SCAN_INTERVAL_MS);
        return;
      }
      const { sign } = require('./lib/auth');
      const token = sign({ id: adminUser.rows[0].id, role: 'admin' });
      const options = {
        hostname: 'localhost',
        port: process.env.PORT || 3000,
        path: '/api/scans',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      const req = http.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            console.log('[scheduler] Auto scan triggered:', result.message || result.error);
          } catch(e) {}
        });
      });
      req.on('error', e => console.error('[scheduler] Auto scan request error:', e.message));
      req.write(postData);
      req.end();
    } catch(err) {
      console.error('[scheduler] Auto scan error:', err.message);
    }
    setTimeout(runAutoScan, SCAN_INTERVAL_MS);
  }

  const delay = getNextScanDelay();
  const nextTime = new Date(Date.now() + delay);
  console.log('[scheduler] Next auto scan at: ' + nextTime.toUTCString());
  setTimeout(runAutoScan, delay);
}

scheduleAutoScan();

app.listen(PORT, () => {
  console.log(`✅ RegWatch running on port ${PORT}`);
  console.log(`🌐 Open: http://localhost:${PORT}`);
});
