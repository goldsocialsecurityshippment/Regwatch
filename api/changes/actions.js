// api/changes/actions.js - Alert review, notes, assignments, audit trail
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  const { action, change_id, note, assigned_to } = req.body || {};

  if (!change_id || !action) {
    return res.status(400).json({ ok: false, error: 'change_id and action required' });
  }

  try {
    switch (action) {
      case 'mark_reviewed':
        await db.query(
          `UPDATE changes SET action_status = 'reviewed', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
          [user.id, change_id]
        );
        await logAudit(db, change_id, user.id, 'reviewed', 'Marked as reviewed');
        return res.json({ ok: true, message: 'Marked as reviewed' });

      case 'mark_action_taken':
        await db.query(
          `UPDATE changes SET action_status = 'action_taken', action_taken_at = NOW() WHERE id = $1`,
          [change_id]
        );
        await logAudit(db, change_id, user.id, 'action_taken', 'Action marked as taken');
        return res.json({ ok: true, message: 'Action marked as taken' });

      case 'escalate':
        await db.query(
          `UPDATE changes SET escalated = TRUE, escalated_at = NOW(), action_status = 'escalated' WHERE id = $1`,
          [change_id]
        );
        await logAudit(db, change_id, user.id, 'escalated', 'Alert escalated for urgent review');
        return res.json({ ok: true, message: 'Alert escalated' });

      case 'add_note':
        if (!note || !note.trim()) {
          return res.status(400).json({ ok: false, error: 'Note text required' });
        }
        await db.query(
          `INSERT INTO alert_notes (change_id, user_id, note) VALUES ($1, $2, $3)`,
          [change_id, user.id, note.trim()]
        );
        await logAudit(db, change_id, user.id, 'note_added', note.trim().substring(0, 200));
        return res.json({ ok: true, message: 'Note added' });

      case 'assign':
        if (!assigned_to) return res.status(400).json({ ok: false, error: 'assigned_to required' });
        await db.query(
          `INSERT INTO alert_assignments (change_id, assigned_to, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (change_id) DO UPDATE SET assigned_to = $2, assigned_by = $3, assigned_at = NOW()`,
          [change_id, assigned_to, user.id]
        ).catch(() =>
          db.query(
            `INSERT INTO alert_assignments (change_id, assigned_to, assigned_by) VALUES ($1, $2, $3)`,
            [change_id, assigned_to, user.id]
          )
        );
        await db.query(`UPDATE changes SET action_status = 'assigned' WHERE id = $1`, [change_id]);
        const assignee = await db.query('SELECT full_name FROM users WHERE id = $1', [assigned_to]);
        await logAudit(db, change_id, user.id, 'assigned', `Assigned to ${assignee.rows[0]?.full_name || assigned_to}`);
        return res.json({ ok: true, message: 'Alert assigned' });

      case 'get_notes':
        const notes = await db.query(
          `SELECT n.*, u.full_name, u.email FROM alert_notes n
           JOIN users u ON u.id = n.user_id
           WHERE n.change_id = $1 ORDER BY n.created_at ASC`,
          [change_id]
        );
        return res.json({ ok: true, data: notes.rows });

      case 'get_audit':
        const audit = await db.query(
          `SELECT a.*, u.full_name, u.email FROM audit_trail a
           LEFT JOIN users u ON u.id = a.user_id
           WHERE a.change_id = $1 ORDER BY a.created_at ASC`,
          [change_id]
        );
        return res.json({ ok: true, data: audit.rows });

      default:
        return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('[actions] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

async function logAudit(db, changeId, userId, action, detail) {
  try {
    await db.query(
      `INSERT INTO audit_trail (change_id, user_id, action, detail) VALUES ($1, $2, $3, $4)`,
      [changeId, userId, action, detail]
    );
  } catch(e) {
    console.error('[audit] Failed to log:', e.message);
  }
}
