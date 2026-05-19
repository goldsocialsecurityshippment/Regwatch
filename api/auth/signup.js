// api/auth/signup.js - SourceWatch User Registration
const db = require('../../lib/db');
const { hash, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { email, password, full_name, firm_name, job_title } = req.body || {};

  if (!email || !password || !full_name || !firm_name) {
    return res.status(400).json({ ok: false, error: 'Email, password, full name and firm name are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email address' });
  }

  try {
    // Check if email already exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: 'An account with this email already exists' });
    }

    // Hash password
    const passwordHash = await hash(password);

    // Create user with pending status
    const result = await db.query(
      `INSERT INTO users (email, password_hash, full_name, firm_name, job_title, role, approved, status, approval_requested_at)
       VALUES ($1, $2, $3, $4, $5, 'compliance_officer', FALSE, 'pending', NOW())
       RETURNING id, email, full_name, firm_name, status`,
      [email.toLowerCase().trim(), passwordHash, full_name.trim(), firm_name.trim(), (job_title || '').trim()]
    );

    const user = result.rows[0];

    // Notify admin (log for now)
    console.log(`[signup] New registration pending approval: ${user.email} - ${user.firm_name}`);

    return res.status(201).json({
      ok: true,
      message: 'Account created successfully. Your account is pending admin approval. You will be able to log in once approved.',
      user: { email: user.email, full_name: user.full_name, status: 'pending' }
    });

  } catch (err) {
    console.error('[signup] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to create account. Please try again.' });
  }
};
