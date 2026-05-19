// api/export/csv.js
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    const jurisdiction = req.query?.jurisdiction || null;
    const sources = await db.getAllSources(jurisdiction !== 'all' ? jurisdiction : null);
    const headers = ['ID','Institution','Jurisdiction','URL','Title','Type','Keywords','Priority','Status','Last Checked'];
    const rows = sources.map(s => [
      s.id, s.institution_name, s.jurisdiction_name, s.exact_url, s.page_title,
      s.document_type, (s.keywords||[]).join(';'), s.priority, s.status,
      s.last_checked || ''
    ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="regwatch-export-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
