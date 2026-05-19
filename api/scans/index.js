// api/scans/index.js - SourceWatch Intelligent Scan Engine
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const { scrapeSource, detectChanges } = require('../../lib/scraper');
const { scoreChange, getImportanceLabel } = require('../../lib/keywordEngine');
const { generateDocumentIntelligence } = require('../../lib/ai');

let scanRunning = false;
let scanJurisdiction = null;
let scanProgress = { total: 0, done: 0, current: '', errors: 0, changes: 0, aiProcessed: 0 };
let scanRunId = null;

const getScanState = () => ({ scanRunning, scanJurisdiction, scanProgress });

async function safe(fn, label) {
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 30000))
    ]);
  } catch (e) {
    console.error(`[scan] ${label} failed:`, e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    return res.json({
      ok: true,
      scanning: scanRunning,
      jurisdiction: scanJurisdiction,
      progress: scanProgress,
      runId: scanRunId,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (scanRunning) {
    return res.status(409).json({
      ok: false,
      error: 'Scan already running',
      progress: scanProgress,
    });
  }

  const { jurisdiction = 'all' } = req.body || {};

  // Start scan run record
  try {
    const runResult = await db.query(
      `INSERT INTO scan_runs (jurisdiction, triggered_by, started_at, status)
       VALUES ($1, $2, NOW(), 'running') RETURNING id`,
      [jurisdiction, user.email || 'manual']
    );
    scanRunId = runResult.rows[0]?.id;
  } catch(e) {
    console.error('[scan] Failed to create scan run:', e.message);
  }

  // Get sources
  const sourcesResult = await db.query(
    jurisdiction === 'all'
      ? `SELECT s.*, j.name as jurisdiction_name,
               s.keywords_tier1, s.keywords_tier2, s.keywords_tier3, s.keywords_exclude,
               s.source_authority
         FROM sources s
         LEFT JOIN jurisdictions j ON j.code = s.jurisdiction_code
         WHERE s.status != 'paused'
         ORDER BY s.source_authority DESC NULLS LAST, s.id`
      : `SELECT s.*, j.name as jurisdiction_name,
               s.keywords_tier1, s.keywords_tier2, s.keywords_tier3, s.keywords_exclude,
               s.source_authority
         FROM sources s
         LEFT JOIN jurisdictions j ON j.code = s.jurisdiction_code
         WHERE s.jurisdiction_code = $1 AND s.status != 'paused'
         ORDER BY s.source_authority DESC NULLS LAST, s.id`,
    jurisdiction === 'all' ? [] : [jurisdiction]
  );

  const sources = sourcesResult.rows;
  scanRunning = true;
  scanJurisdiction = jurisdiction;
  scanProgress = { total: sources.length, done: 0, current: '', errors: 0, changes: 0, aiProcessed: 0 };

  res.json({
    ok: true,
    message: `Scan started for ${jurisdiction === 'all' ? 'all jurisdictions' : jurisdiction}`,
    runId: scanRunId,
    jurisdiction,
    sourcesCount: sources.length,
  });

  // Run scan asynchronously
  (async () => {
    let totalChanges = 0, totalErrors = 0;

    for (const source of sources) {
      const exact_url = source.exact_url || source.url;
      const institution_name = source.institution_name || source.institution;
      scanProgress.current = institution_name;

      const scrapeInput = {
        ...source,
        exact_url,
        institution_name,
        page_title: source.page_title || source.title,
        keywords: [
          ...(source.keywords_tier1 || []),
          ...(source.keywords_tier2 || []),
        ],
      };

      // Scrape
      const current = await safe(() => scrapeSource(scrapeInput), `SCRAPE(${institution_name})`);
      if (!current || !current.ok) {
        totalErrors++;
        scanProgress.errors++;
        // Track consecutive failures
        await safe(() => db.query(
          `UPDATE sources SET consecutive_failures = consecutive_failures + 1,
           last_failure_reason = $1, last_scanned_at = NOW()
           WHERE id = $2`,
          [(current?.error || 'Unknown error').substring(0, 200), source.id]
        ), `UPDATE_FAILURE(${source.id})`);
        scanProgress.done++;
        continue;
      }

      // Reset failure count on success
      await safe(() => db.query(
        `UPDATE sources SET consecutive_failures = 0, last_scanned_at = NOW() WHERE id = $1`,
        [source.id]
      ), `RESET_FAILURES(${source.id})`);

      // Get previous snapshot
      const previous = await safe(() => db.getSourceSnapshot(source.id), `SNAPSHOT(${source.id})`);

      // Detect changes
      const prevData = previous ? {
        documentLinks: previous.documentLinks || [],
        contentHash: previous.contentHash,
        textContent: previous.textContent || '',
      } : null;

      const rawChanges = await safe(
        () => Promise.resolve(detectChanges(prevData, current, scrapeInput)),
        `DETECT(${institution_name})`
      ) || [];

      // Score and filter each change using keyword engine
      for (const change of rawChanges) {
        const scoreResult = scoreChange(change, source);

        // Skip filtered changes
        if (scoreResult.importance === 'filtered') {
          console.log(`[scan] FILTERED: ${institution_name} - ${change.page_title}`);
          continue;
        }

        // Build enriched change object
        const enrichedChange = {
          ...change,
          importance: scoreResult.importance,
          tier_matched: scoreResult.tier,
          keyword_matches: JSON.stringify(scoreResult.topKeywords || []),
          jurisdiction_name: source.jurisdiction_name,
          institution_name,
          source_authority: source.source_authority,
        };

        // Run AI analysis if content available
        const hasContent = enrichedChange.content_after && enrichedChange.content_after.length > 100;
        if (hasContent && ['critical', 'important'].includes(scoreResult.importance)) {
          const aiContent = enrichedChange.content_after.substring(0, 4000);
          const aiResult = await safe(
            () => generateDocumentIntelligence({
              ...enrichedChange,
              content_after: aiContent,
            }, scrapeInput),
            `AI(${institution_name})`
          );
          if (aiResult) {
            enrichedChange.ai_summary = aiResult.summary || enrichedChange.ai_summary;
            enrichedChange.compliance_impact = aiResult.compliance_impact;
            enrichedChange.recommended_action = aiResult.recommended_action;
            enrichedChange.priority = aiResult.risk_level || enrichedChange.priority;
            enrichedChange.compliance_areas = aiResult.compliance_areas;
            scanProgress.aiProcessed++;
          }
        }

        // Save change to database
        await safe(() => db.insertChange(enrichedChange), `INSERT(${institution_name})`);
        totalChanges++;
        scanProgress.changes++;
        console.log(`[scan] CHANGE: ${scoreResult.importance.toUpperCase()} - ${institution_name} - ${change.change_type} - ${change.page_title}`);
      }

      // Save updated snapshot
      await safe(() => db.updateSourceSnapshot(source.id, current), `SAVE_SNAPSHOT(${source.id})`);
      scanProgress.done++;
    }

    // Update scan run record
    if (scanRunId) {
      await safe(() => db.query(
        `UPDATE scan_runs SET completed_at = NOW(), status = 'completed',
         sources_total = $1, sources_scanned = $2, sources_failed = $3, changes_detected = $4
         WHERE id = $5`,
        [sources.length, sources.length - totalErrors, totalErrors, totalChanges, scanRunId]
      ), 'UPDATE_SCAN_RUN');
    }

    console.log(`[scan] Complete: ${sources.length} sources, ${totalChanges} changes, ${totalErrors} errors`);
    scanRunning = false;
    scanJurisdiction = null;
  })();
};

module.exports.getScanState = getScanState;
