// api/sources/index.js
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  // GET /api/sources?jurisdiction=GB
  if (req.method === 'GET') {
    try {
      const jurisdiction = req.query?.jurisdiction || 'all';
      const rows = await db.getAllSources(jurisdiction !== 'all' ? jurisdiction : null);
      const data = rows.map(s => ({
        id:               s.id,
        institution:      s.institution_name,
        instShort:        s.institution_short,
        jurisdictionCode: s.jurisdiction_code,
        jurisdictionName: s.jurisdiction_name,
        flagEmoji:        s.flag_emoji,
        mainUrl:          s.main_url,
        url:              s.exact_url,
        title:            s.page_title,
        type:             s.document_type,
        fileType:         s.document_type,
        keywords:         s.keywords || [],
        notes:            s.monitoring_notes,
        priority:         s.priority,
        status:           s.status,
        healthStatus:     s.health_status,
        lastChecked:      s.last_checked,
        nextScan:         s.next_scan,
        risk:             priorityToRisk(s.priority),
        published:        s.created_at?.toISOString?.()?.split('T')[0] || '',
        updated:          s.updated_at?.toISOString?.()?.split('T')[0] || '',
        evidence:         s.monitoring_notes || '',
        country:          s.jurisdiction_name,
        searchPath:       s.main_url || s.exact_url,
        relatedLinks:     ''
      }));
      return res.json({ ok: true, data, total: data.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // POST /api/sources — add new source
  if (req.method === 'POST') {
    try {
      const b = req.body || {};
      if (!b.exact_url && !b.url) return res.status(400).json({ ok: false, error: 'URL is required' });
      if (!b.institution_name) return res.status(400).json({ ok: false, error: 'Institution name is required' });

      // Parse keywords
      let keywords = b.keywords || [];
      if (typeof keywords === 'string') {
        keywords = keywords.split(',').map(k => k.trim()).filter(Boolean);
      }

      const source = await db.insertSource({
        ...b,
        exact_url: b.exact_url || b.url,
        keywords
      });

      await db.logAudit({
        userId: user.id, userEmail: user.email,
        action: 'source.created', resource: 'source', resourceId: source.id,
        details: { url: source.exact_url, institution: source.institution_name },
        ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
      });

      return res.json({ ok: true, data: formatSource(source) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
};

function priorityToRisk(p) {
  return p === 'high' ? 75 + Math.floor(Math.random() * 20)
       : p === 'medium' ? 45 + Math.floor(Math.random() * 25)
       : 20 + Math.floor(Math.random() * 25);
}

function formatSource(s) {
  return {
    id: s.id, institution: s.institution_name, instShort: s.institution_short,
    jurisdictionCode: s.jurisdiction_code, url: s.exact_url,
    title: s.page_title, type: s.document_type,
    keywords: s.keywords || [], priority: s.priority, status: s.status,
    notes: s.monitoring_notes, risk: priorityToRisk(s.priority),
    published: s.created_at?.toISOString?.()?.split('T')[0] || '',
    updated:   s.updated_at?.toISOString?.()?.split('T')[0] || ''
  };
}
