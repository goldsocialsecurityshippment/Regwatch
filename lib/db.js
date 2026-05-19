// lib/db.js — PostgreSQL with document-level tracking
const { Pool } = require('pg');

let _pool;
function pool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    _pool.on('error', (err) => console.error('[db] Pool error:', err.message));
  }
  return _pool;
}

async function query(sql, params = []) {
  const client = await pool().connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function createSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS jurisdictions (
      id            SERIAL PRIMARY KEY,
      code          VARCHAR(10) UNIQUE NOT NULL,
      name          VARCHAR(100) NOT NULL,
      flag_emoji    VARCHAR(10),
      region        VARCHAR(50),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sources (
      id                    SERIAL PRIMARY KEY,
      jurisdiction_code     VARCHAR(10) REFERENCES jurisdictions(code),
      institution_name      VARCHAR(200) NOT NULL,
      institution_short     VARCHAR(20),
      main_url              TEXT,
      exact_url             TEXT NOT NULL,
      page_title            VARCHAR(500),
      document_type         VARCHAR(50) DEFAULT 'webpage',
      keywords              TEXT[] DEFAULT '{}',
      monitoring_notes      TEXT,
      priority              VARCHAR(10) DEFAULT 'medium',
      status                VARCHAR(20) DEFAULT 'live',
      health_status         VARCHAR(20) DEFAULT 'unknown',
      consecutive_failures  INTEGER DEFAULT 0,
      last_checked          TIMESTAMPTZ,
      next_scan             TIMESTAMPTZ,
      scan_interval_days    INTEGER DEFAULT 1,
      content_hash          TEXT,
      snapshot              JSONB,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS documents (
      id            SERIAL PRIMARY KEY,
      source_id     INTEGER REFERENCES sources(id) ON DELETE CASCADE,
      url           TEXT NOT NULL,
      title         TEXT,
      first_seen    TIMESTAMPTZ DEFAULT NOW(),
      last_seen     TIMESTAMPTZ DEFAULT NOW(),
      is_active     BOOLEAN DEFAULT TRUE,
      file_type     VARCHAR(20),
      UNIQUE(source_id, url)
    );
    CREATE TABLE IF NOT EXISTS changes (
      id              SERIAL PRIMARY KEY,
      source_id       INTEGER REFERENCES sources(id) ON DELETE CASCADE,
      change_type     VARCHAR(20) NOT NULL,
      page_title      TEXT,
      exact_url       TEXT,
      parent_url      TEXT,
      is_document     BOOLEAN DEFAULT FALSE,
      keyword_matched BOOLEAN DEFAULT TRUE,
      ai_summary      TEXT,
      content_before  TEXT,
      content_after   TEXT,
      priority        VARCHAR(10) DEFAULT 'medium',
      reviewed        BOOLEAN DEFAULT FALSE,
      reviewed_by     INTEGER,
      reviewed_at     TIMESTAMPTZ,
      detected_at     TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS scan_runs (
      id              SERIAL PRIMARY KEY,
      jurisdiction    VARCHAR(10),
      triggered_by    INTEGER,
      status          VARCHAR(20) DEFAULT 'running',
      sources_scanned INTEGER DEFAULT 0,
      changes_found   INTEGER DEFAULT 0,
      errors          INTEGER DEFAULT 0,
      started_at      TIMESTAMPTZ DEFAULT NOW(),
      completed_at    TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      email           VARCHAR(255) UNIQUE NOT NULL,
      password_hash   TEXT NOT NULL,
      full_name       VARCHAR(200),
      role            VARCHAR(20) DEFAULT 'analyst',
      is_active       BOOLEAN DEFAULT TRUE,
      last_login      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      user_email  VARCHAR(255),
      action      VARCHAR(100) NOT NULL,
      resource    VARCHAR(100),
      resource_id INTEGER,
      details     JSONB,
      ip_address  VARCHAR(50),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS review_queue (
      id              SERIAL PRIMARY KEY,
      source_id       INTEGER REFERENCES sources(id) ON DELETE CASCADE,
      change_id       INTEGER REFERENCES changes(id) ON DELETE CASCADE,
      status          VARCHAR(20) DEFAULT 'new',
      ai_confidence   NUMERIC(5,2),
      ai_reasoning    TEXT,
      reviewed_by     INTEGER REFERENCES users(id),
      decision        VARCHAR(20),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sources_jurisdiction ON sources(jurisdiction_code);
    CREATE INDEX IF NOT EXISTS idx_sources_status       ON sources(status);
    CREATE INDEX IF NOT EXISTS idx_changes_source       ON changes(source_id);
    CREATE INDEX IF NOT EXISTS idx_changes_reviewed     ON changes(reviewed);
    CREATE INDEX IF NOT EXISTS idx_documents_source     ON documents(source_id);
  `);
  console.log('[db] Schema ready');
}

async function migrateSchema() {
  const migrations = [
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS page_title TEXT`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS exact_url TEXT`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS parent_url TEXT`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS is_document BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS keyword_matched BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS ai_summary TEXT`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS content_before TEXT`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS content_after TEXT`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'medium'`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS reviewed BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS reviewed_by INTEGER`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ DEFAULT NOW()`,
    `UPDATE changes SET page_title = title WHERE page_title IS NULL AND title IS NOT NULL`,
    `UPDATE changes SET exact_url = url WHERE exact_url IS NULL AND url IS NOT NULL`,
    `UPDATE changes SET detected_at = created_at WHERE detected_at IS NULL AND created_at IS NOT NULL`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS jurisdiction_code VARCHAR(10)`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS institution_name VARCHAR(200)`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS institution_short VARCHAR(20)`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS main_url TEXT`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS exact_url TEXT`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}'`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS health_status VARCHAR(20) DEFAULT 'unknown'`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS scan_interval_days INTEGER DEFAULT 1`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS snapshot JSONB`,
    `UPDATE sources SET institution_name = institution WHERE institution_name IS NULL AND institution IS NOT NULL`,
    `UPDATE sources SET exact_url = url WHERE exact_url IS NULL AND url IS NOT NULL`,
    `UPDATE sources SET jurisdiction_code = jurisdiction WHERE jurisdiction_code IS NULL AND jurisdiction IS NOT NULL`,
  ];
  for (const sql of migrations) {
    await query(sql).catch(e => {
      if (!e.message.includes('does not exist') && !e.message.includes('already exists')) {
        console.warn('[migrate]', e.message);
      }
    });
  }
  console.log('[db] Migration complete');
}

async function seedJurisdictions() {
  const jurisdictions = [
    { code: 'GB',  name: 'United Kingdom',        flag: '🇬🇧', region: 'Europe' },
    { code: 'KY',  name: 'Cayman Islands',         flag: '🇰🇾', region: 'Caribbean' },
    { code: 'VG',  name: 'British Virgin Islands', flag: '🇻🇬', region: 'Caribbean' },
    { code: 'JE',  name: 'Jersey',                 flag: '🇯🇪', region: 'Europe' },
    { code: 'BM',  name: 'Bermuda',                flag: '🇧🇲', region: 'Atlantic' },
    { code: 'GG',  name: 'Guernsey',               flag: '🇬🇬', region: 'Europe' },
    { code: 'GI',  name: 'Gibraltar',              flag: '🇬🇮', region: 'Europe' },
    { code: 'INT', name: 'International',          flag: '🌐',  region: 'Global' },
    { code: 'EU',  name: 'European Union',         flag: '🇪🇺', region: 'Europe' },
  ];
  for (const j of jurisdictions) {
    await query(
      `INSERT INTO jurisdictions(code,name,flag_emoji,region)
       VALUES($1,$2,$3,$4) ON CONFLICT(code) DO UPDATE SET name=$2,flag_emoji=$3`,
      [j.code, j.name, j.flag, j.region]
    );
  }
}

async function getAllSources(jurisdictionCode = null) {
  const where = jurisdictionCode && jurisdictionCode !== 'all'
    ? `WHERE s.jurisdiction_code = '${jurisdictionCode}'` : '';
  const { rows } = await query(`
    SELECT s.*, j.name as jurisdiction_name, j.flag_emoji, j.code as jur_code
    FROM sources s
    LEFT JOIN jurisdictions j ON j.code = s.jurisdiction_code
    ${where}
    ORDER BY j.name, s.institution_name, s.page_title
  `);
  return rows;
}

async function getSourceById(id) {
  const { rows } = await query(
    `SELECT s.*, j.name as jurisdiction_name, j.flag_emoji
     FROM sources s LEFT JOIN jurisdictions j ON j.code = s.jurisdiction_code
     WHERE s.id = $1`, [id]
  );
  return rows[0] || null;
}

async function insertSource(data) {
  const { rows } = await query(`
    INSERT INTO sources(
      jurisdiction_code, institution_name, institution_short,
      main_url, exact_url, page_title, document_type,
      keywords, monitoring_notes, priority, scan_interval_days
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *`,
    [
      data.jurisdiction_code || data.jurisdictionCode || 'INT',
      data.institution_name  || data.institution,
      data.institution_short || (data.institution_name || '').substring(0, 8).toUpperCase(),
      data.main_url          || data.mainUrl || data.exact_url || data.url,
      data.exact_url         || data.url,
      data.page_title        || data.title,
      data.document_type     || data.type || 'webpage',
      data.keywords          || [],
      data.monitoring_notes  || data.notes || '',
      data.priority          || 'medium',
      data.scan_interval_days || 1
    ]
  );
  return rows[0];
}

async function updateSourceSnapshot(id, scrapeResult) {
  await query(`
    UPDATE sources SET
      content_hash  = $2,
      snapshot      = $3,
      last_checked  = NOW(),
      health_status = $4,
      consecutive_failures = CASE WHEN $5 THEN 0 ELSE consecutive_failures + 1 END,
      status = CASE WHEN $5 THEN
                 CASE WHEN status = 'removed' THEN 'live' ELSE status END
               ELSE
                 CASE WHEN consecutive_failures >= 3 THEN 'removed' ELSE status END
               END,
      updated_at = NOW()
    WHERE id = $1`,
    [
      id,
      scrapeResult.contentHash,
      JSON.stringify({
        documentLinks: scrapeResult.documentLinks || [],
        allLinksCount: (scrapeResult.allLinks || []).length,
        title: scrapeResult.title,
        textContent: (scrapeResult.textContent || '').substring(0, 8000),
        scrapedAt: scrapeResult.scrapedAt
      }),
      scrapeResult.ok ? 'healthy' : 'error',
      scrapeResult.ok
    ]
  );
}

async function getSourceSnapshot(id) {
  const { rows } = await query('SELECT snapshot, content_hash FROM sources WHERE id = $1', [id]);
  if (!rows[0]) return null;
  return {
    documentLinks: rows[0].snapshot?.documentLinks || [],
    contentHash:   rows[0].content_hash,
    textContent:   rows[0].snapshot?.textContent || ''
  };
}

async function updateSourceKeywords(id, keywords) {
  await query('UPDATE sources SET keywords=$2, updated_at=NOW() WHERE id=$1', [id, keywords]);
}

async function upsertDocument(sourceId, url, title, fileType) {
  await query(`
    INSERT INTO documents(source_id, url, title, file_type, first_seen, last_seen, is_active)
    VALUES($1,$2,$3,$4,NOW(),NOW(),TRUE)
    ON CONFLICT(source_id, url) DO UPDATE SET
      last_seen = NOW(), is_active = TRUE,
      title = COALESCE(EXCLUDED.title, documents.title)`,
    [sourceId, url, title, fileType]
  );
}

async function markDocumentRemoved(sourceId, url) {
  await query('UPDATE documents SET is_active=FALSE WHERE source_id=$1 AND url=$2', [sourceId, url]);
}

async function getDocumentsBySource(sourceId) {
  const { rows } = await query('SELECT * FROM documents WHERE source_id=$1 ORDER BY first_seen DESC', [sourceId]);
  return rows;
}

async function insertChange(change) {
  const { rows } = await query(`
    INSERT INTO changes(
      source_id, change_type, page_title, exact_url, parent_url,
      is_document, keyword_matched, ai_summary, content_before, content_after,
      priority, detected_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING id`,
    [
      change.source_id,
      change.change_type,
      (change.page_title || '').substring(0, 500),
      change.exact_url,
      change.parent_url,
      change.is_document     || false,
      change.keyword_matched !== false,
      change.ai_summary,
      change.content_before,
      change.content_after,
      change.priority        || 'medium',
      change.detected_at     || new Date().toISOString()
    ]
  );
  return rows[0];
}

async function getChanges(limit = 50, filters = {}) {
  const conditions = ['1=1'];
  const params     = [];
  let   p          = 1;

  if (filters.jurisdiction && filters.jurisdiction !== 'all') {
    conditions.push(`s.jurisdiction_code = $${p++}`);
    params.push(filters.jurisdiction);
  }
  if (filters.sourceId) {
    conditions.push(`c.source_id = $${p++}`);
    params.push(filters.sourceId);
  }
  if (filters.changeType) {
    conditions.push(`c.change_type = $${p++}`);
    params.push(filters.changeType);
  }

  params.push(Math.min(limit, 200));
  const { rows } = await query(`
    SELECT c.id, c.source_id, c.change_type,
           COALESCE(c.page_title, '')         as page_title,
           COALESCE(c.exact_url, '')          as exact_url,
           COALESCE(c.parent_url, '')         as parent_url,
           COALESCE(c.is_document,    FALSE)            as is_document,
           COALESCE(c.keyword_matched,TRUE)             as keyword_matched,
           COALESCE(c.ai_summary, '')         as ai_summary,
           COALESCE(c.reviewed,   FALSE)               as reviewed,
           COALESCE(c.priority,   'medium')            as priority,
           c.detected_at                      as detected_at,
           s.institution_name, s.institution_short,
           j.name as jurisdiction_name, j.flag_emoji, j.code as jurisdiction_code
    FROM changes c
    LEFT JOIN sources s       ON s.id = c.source_id
    LEFT JOIN jurisdictions j ON j.code = s.jurisdiction_code
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.detected_at DESC
    LIMIT $${p}`,
    params
  );
  return rows;
}

async function markChangeReviewed(id, userId) {
  await query('UPDATE changes SET reviewed=TRUE, reviewed_by=$2, reviewed_at=NOW() WHERE id=$1', [id, userId]);
}

async function markAllChangesReviewed(userId, jurisdictionCode = null) {
  if (jurisdictionCode && jurisdictionCode !== 'all') {
    await query(`
      UPDATE changes SET reviewed=TRUE, reviewed_by=$2, reviewed_at=NOW()
      WHERE reviewed=FALSE AND source_id IN (
        SELECT id FROM sources WHERE jurisdiction_code=$1
      )`, [jurisdictionCode, userId]
    );
  } else {
    await query('UPDATE changes SET reviewed=TRUE, reviewed_by=$1, reviewed_at=NOW() WHERE reviewed=FALSE', [userId]);
  }
}

async function createScanRun(jurisdictionCode, userId) {
  const { rows } = await query(
    'INSERT INTO scan_runs(jurisdiction,triggered_by) VALUES($1,$2) RETURNING id',
    [jurisdictionCode || 'all', userId]
  );
  return rows[0].id;
}

async function updateScanRun(id, data) {
  await query(`
    UPDATE scan_runs SET
      status          = COALESCE($2, status),
      sources_scanned = COALESCE($3, sources_scanned),
      changes_found   = COALESCE($4, changes_found),
      errors          = COALESCE($5, errors),
      completed_at    = CASE WHEN $2 IN ('completed','failed') THEN NOW() ELSE completed_at END
    WHERE id = $1`,
    [id, data.status, data.sourcesScanned, data.changesFound, data.errors]
  );
}

async function getActiveScan() {
  const { rows } = await query(`SELECT * FROM scan_runs WHERE status='running' ORDER BY started_at DESC LIMIT 1`);
  return rows[0] || null;
}

async function getStats(jurisdictionCode = null) {
  const jFilter = jurisdictionCode && jurisdictionCode !== 'all'
    ? `WHERE s.jurisdiction_code = '${jurisdictionCode}'` : '';

  const [total, byStatus, byPriority, byJur, recentChanges, pendingReview] = await Promise.all([
    query(`SELECT COUNT(*) FROM sources s ${jFilter}`),
    query(`SELECT status, COUNT(*) FROM sources s ${jFilter} GROUP BY status`),
    query(`SELECT priority, COUNT(*) FROM sources s ${jFilter} GROUP BY priority`),
    query(`
      SELECT j.code, j.name, j.flag_emoji,
             COUNT(s.id) as sources,
             COUNT(c.id) FILTER (WHERE c.detected_at > NOW()-INTERVAL '7 days') as updates
      FROM jurisdictions j
      LEFT JOIN sources s  ON s.jurisdiction_code = j.code
      LEFT JOIN changes c  ON c.source_id = s.id
      GROUP BY j.code, j.name, j.flag_emoji
      ORDER BY j.name
    `),
    query(`
      SELECT COUNT(*) FROM changes c
      LEFT JOIN sources s ON s.id = c.source_id
      WHERE c.detected_at > NOW()-INTERVAL '7 days'
      ${jurisdictionCode && jurisdictionCode !== 'all' ? `AND s.jurisdiction_code='${jurisdictionCode}'` : ''}
    `),
    query(`SELECT COUNT(*) FROM review_queue WHERE status='new'`),
  ]);

  const statusMap   = {};
  const priorityMap = {};
  byStatus.rows.forEach(  r => { statusMap[r.status]     = parseInt(r.count); });
  byPriority.rows.forEach(r => { priorityMap[r.priority] = parseInt(r.count); });

  return {
    total:          parseInt(total.rows[0].count),
    byStatus:       statusMap,
    byPriority:     priorityMap,
    byJurisdiction: byJur.rows,
    recentChanges:  parseInt(recentChanges.rows[0].count),
    reviewPending:  parseInt(pendingReview.rows[0].count),
  };
}

async function getActivity(limit = 20) {
  try {
    const { rows } = await query(`
      SELECT c.id, c.change_type,
             COALESCE(c.page_title, '') as page_title,
             COALESCE(c.exact_url, '')  as exact_url,
             c.detected_at              as ts,
             COALESCE(c.is_document, FALSE)         as is_document,
             'change' as type,
             s.institution_name, j.flag_emoji, j.name as jurisdiction_name
      FROM changes c
      LEFT JOIN sources s       ON s.id = c.source_id
      LEFT JOIN jurisdictions j ON j.code = s.jurisdiction_code
      ORDER BY c.detected_at DESC
      LIMIT $1`, [limit]
    );
    return rows;
  } catch (e) {
    console.error('[db] getActivity error:', e.message);
    return [];
  }
}

async function getUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);
  return rows[0] || null;
}
async function getUserById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id=$1 AND is_active=TRUE', [id]);
  return rows[0] || null;
}
async function getAllUsers() {
  const { rows } = await query('SELECT id,email,full_name,role,is_active,last_login,created_at FROM users ORDER BY created_at');
  return rows;
}
async function createUser(data) {
  const { rows } = await query(
    'INSERT INTO users(email,password_hash,full_name,role) VALUES($1,$2,$3,$4) RETURNING *',
    [data.email, data.password_hash, data.full_name, data.role || 'analyst']
  );
  return rows[0];
}
async function updateUserLogin(id) {
  await query('UPDATE users SET last_login=NOW() WHERE id=$1', [id]);
}

async function logAudit(data) {
  await query(
    'INSERT INTO audit_log(user_id,user_email,action,resource,resource_id,details,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [data.userId, data.userEmail, data.action, data.resource, data.resourceId,
     data.details ? JSON.stringify(data.details) : null, data.ipAddress]
  ).catch(e => console.error('[audit] log error:', e.message));
}
async function getAuditLog(limit = 100) {
  const { rows } = await query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

async function addToReviewQueue(data) {
  await query(
    'INSERT INTO review_queue(source_id,change_id,ai_confidence,ai_reasoning) VALUES($1,$2,$3,$4)',
    [data.sourceId, data.changeId, data.aiConfidence, data.aiReasoning]
  ).catch(() => {});
}
async function getReviewQueue(status = null) {
  const where = status ? `WHERE rq.status='${status}'` : '';
  const { rows } = await query(`
    SELECT rq.*, s.institution_name, s.exact_url,
           j.flag_emoji, j.name as jurisdiction_name,
           c.change_type,
           COALESCE(c.page_title, '') as page_title,
           COALESCE(c.exact_url, '')  as change_url
    FROM review_queue rq
    LEFT JOIN sources s       ON s.id = rq.source_id
    LEFT JOIN jurisdictions j ON j.code = s.jurisdiction_code
    LEFT JOIN changes c       ON c.id = rq.change_id
    ${where}
    ORDER BY rq.created_at DESC
  `);
  return rows;
}
async function updateReviewDecision(id, status, userId, decision) {
  await query(
    'UPDATE review_queue SET status=$2,reviewed_by=$3,decision=$4,updated_at=NOW() WHERE id=$1',
    [id, status, userId, decision]
  );
}

async function getJurisdictions() {
  const { rows } = await query('SELECT * FROM jurisdictions ORDER BY name');
  return rows;
}

module.exports = {
  query, createSchema, seedJurisdictions, migrateSchema,
  getAllSources, getSourceById, insertSource,
  updateSourceSnapshot, getSourceSnapshot, updateSourceKeywords,
  upsertDocument, markDocumentRemoved, getDocumentsBySource,
  insertChange, getChanges, markChangeReviewed, markAllChangesReviewed,
  createScanRun, updateScanRun, getActiveScan,
  getStats, getActivity,
  getUserByEmail, getUserById, getAllUsers, createUser, updateUserLogin,
  logAudit, getAuditLog,
  addToReviewQueue, getReviewQueue, updateReviewDecision,
  getJurisdictions,
};

// ── Compliance Tags ───────────────────────────────────────────
async function saveComplianceTags(changeId, tags) {
  if (!tags || !tags.length) return;
  for (const tag of tags) {
    await query(
      `INSERT INTO compliance_tags(change_id, tag) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [changeId, tag]
    ).catch(() => {});
  }
}

async function getComplianceTags(changeId) {
  try {
    const { rows } = await query('SELECT tag FROM compliance_tags WHERE change_id=$1', [changeId]);
    return rows.map(r => r.tag);
  } catch { return []; }
}

// ── AI Summaries ──────────────────────────────────────────────
async function saveAISummary(changeId, data) {
  await query(
    `INSERT INTO ai_summaries(change_id, summary, compliance_impact, recommended_action, risk_level, risk_score, obligations, doc_type, relevance_score, key_themes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(change_id) DO UPDATE SET
       summary=$2, compliance_impact=$3, recommended_action=$4,
       risk_level=$5, risk_score=$6, obligations=$7, doc_type=$8,
       relevance_score=$9, key_themes=$10`,
    [changeId, data.summary, data.compliance_impact, data.recommended_action,
     data.risk_level, data.risk_score,
     JSON.stringify(data.obligations || []),
     data.doc_type,
     data.relevance_score,
     JSON.stringify(data.key_themes || [])]
  ).catch(e => console.warn('[db] saveAISummary:', e.message));
}

async function getAISummary(changeId) {
  try {
    const { rows } = await query('SELECT * FROM ai_summaries WHERE change_id=$1', [changeId]);
    return rows[0] || null;
  } catch { return null; }
}

// ── Source enable/disable ─────────────────────────────────────
async function toggleSourceStatus(id, enabled) {
  await query(
    'UPDATE sources SET status=$2, updated_at=NOW() WHERE id=$1',
    [id, enabled ? 'live' : 'disabled']
  );
}

// ── Extended migration for new fields ─────────────────────────
async function migrateV2() {
  const migrations = [
    // New columns on changes table
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS compliance_impact TEXT`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS recommended_action TEXT`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'medium'`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 50`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS compliance_areas TEXT[]`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS obligations JSONB`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS doc_type VARCHAR(50)`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS relevance_score INTEGER`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS key_themes JSONB`,
    // Date fields
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS published_at DATE`,
    `ALTER TABLE changes ADD COLUMN IF NOT EXISTS effective_date DATE`,
    // New columns on sources
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS monitoring_mode VARCHAR(20) DEFAULT 'full'`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE`,
    // New tables
    `CREATE TABLE IF NOT EXISTS compliance_tags (
      id        SERIAL PRIMARY KEY,
      change_id INTEGER REFERENCES changes(id) ON DELETE CASCADE,
      tag       VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(change_id, tag)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_summaries (
      id                 SERIAL PRIMARY KEY,
      change_id          INTEGER UNIQUE REFERENCES changes(id) ON DELETE CASCADE,
      summary            TEXT,
      compliance_impact  TEXT,
      recommended_action TEXT,
      risk_level         VARCHAR(20),
      risk_score         INTEGER,
      obligations        JSONB,
      doc_type           VARCHAR(50),
      relevance_score    INTEGER,
      key_themes         JSONB,
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS document_versions (
      id          SERIAL PRIMARY KEY,
      source_id   INTEGER REFERENCES sources(id) ON DELETE CASCADE,
      url         TEXT NOT NULL,
      version_num INTEGER DEFAULT 1,
      content     TEXT,
      content_hash TEXT,
      detected_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_tags_change ON compliance_tags(change_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_summaries_change ON ai_summaries(change_id)`,
    `CREATE INDEX IF NOT EXISTS idx_doc_versions_source ON document_versions(source_id)`,
  ];
  for (const sql of migrations) {
    await query(sql).catch(e => {
      if (!e.message.includes('already exists') && !e.message.includes('does not exist')) {
        console.warn('[migrateV2]', e.message);
      }
    });
  }
  console.log('[db] V2 migration complete');
}

module.exports.saveComplianceTags  = saveComplianceTags;
module.exports.getComplianceTags   = getComplianceTags;
module.exports.saveAISummary       = saveAISummary;
module.exports.getAISummary        = getAISummary;
module.exports.toggleSourceStatus  = toggleSourceStatus;
module.exports.migrateV2           = migrateV2;
