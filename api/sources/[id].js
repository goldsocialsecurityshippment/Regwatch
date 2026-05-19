// api/sources/[id].js
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = parseInt(req.url?.split('/').pop()) || parseInt(req.query?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'Source ID required' });

  if (req.method === 'GET') {
    try {
      const source = await db.getSourceById(id);
      if (!source) return res.status(404).json({ ok: false, error: 'Source not found' });
      const documents = await db.getDocumentsBySource(id);
      return res.json({ ok: true, data: { ...source, documents } });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  if (req.method === 'PUT') {
    try {
      const b = req.body || {};
      const updates = [], params = [id]; let p = 2;

      if (b.keywords !== undefined) {
        let kws = b.keywords;
        if (typeof kws === 'string') kws = kws.split(',').map(k => k.trim()).filter(Boolean);
        updates.push(`keywords=$${p++}`); params.push(kws);
      }
      if (b.priority)          { updates.push(`priority=$${p++}`);          params.push(b.priority); }
      if (b.monitoring_notes)  { updates.push(`monitoring_notes=$${p++}`);  params.push(b.monitoring_notes); }
      if (b.page_title)        { updates.push(`page_title=$${p++}`);        params.push(b.page_title); }
      if (b.monitoring_mode)   { updates.push(`monitoring_mode=$${p++}`);   params.push(b.monitoring_mode); }
      if (b.status !== undefined) { updates.push(`status=$${p++}`);         params.push(b.status); }
      if (b.is_enabled !== undefined) {
        const newStatus = b.is_enabled ? 'live' : 'disabled';
        updates.push(`status=$${p++}`); params.push(newStatus);
      }

      if (updates.length === 0) return res.status(400).json({ ok: false, error: 'Nothing to update' });
      updates.push('updated_at=NOW()');
      await db.query(`UPDATE sources SET ${updates.join(',')} WHERE id=$1`, params);

      await db.logAudit({
        userId: user.id, userEmail: user.email,
        action: 'source.updated', resource: 'source', resourceId: id, details: b,
        ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
      });

      const updated = await db.getSourceById(id);
      return res.json({ ok: true, data: updated });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  if (req.method === 'DELETE') {
    try {
      if (user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin only' });
      await db.query('DELETE FROM sources WHERE id=$1', [id]);
      await db.logAudit({ userId: user.id, userEmail: user.email, action: 'source.deleted', resource: 'source', resourceId: id });
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
};
