// api/setup.js
const db   = require('../lib/db');
const { hash, cors } = require('../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const key = req.body?.setup_key || req.query?.setup_key;
  if (key !== process.env.SETUP_KEY) return res.status(403).json({ ok: false, error: 'Invalid setup key' });

  try {
    await db.createSchema();
    await db.seedJurisdictions();
    await db.migrateSchema();
    await db.migrateV2();

    let adminCreated = false;
    const existing = await db.getUserByEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@regwatch.io');
    if (!existing) {
      const ph = await hash(process.env.BOOTSTRAP_ADMIN_PASSWORD || 'RegWatch2026!');
      await db.createUser({
        email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@regwatch.io',
        password_hash: ph,
        full_name: process.env.BOOTSTRAP_ADMIN_NAME || 'System Administrator',
        role: 'admin'
      });
      adminCreated = true;
    }

    let sourcesSeeded = 0;
    try {
      const SOURCES = require('../lib/sources');
      const existing = await db.getAllSources();
      if (existing.length === 0 && SOURCES.length > 0) {
        for (const s of SOURCES) { await db.insertSource(s).catch(() => {}); sourcesSeeded++; }
      }
    } catch {}

    res.json({ ok: true, message: 'RegWatch database initialized and migrated successfully', adminCreated, sourcesSeeded, timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
