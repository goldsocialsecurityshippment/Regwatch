// api/reports/generate.js — AI Regulatory Intelligence Report Generator
// Works with OR without OpenAI — graceful degradation
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const { generateReport } = require('../../lib/reportGenerator');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { jurisdiction = 'all', limit = 50, title } = req.body || {};

    const changes = await db.getChanges(Math.min(limit, 100), { jurisdiction });
    if (!changes.length) return res.json({ ok: false, error: 'No changes found.' });

    const relevant = changes.filter(c => c.change_type !== 'unreachable');
    const highRisk  = relevant.filter(c => ['high','critical'].includes(c.priority));
    const updated   = relevant.filter(c => c.change_type === 'updated');
    const removed   = relevant.filter(c => c.change_type === 'removed');
    const newDocs   = relevant.filter(c => c.change_type === 'new');
    const jurs      = [...new Set(relevant.map(c => c.jurisdiction_name || c.jurisdiction_code).filter(Boolean))];
    const topInst   = [...new Set(highRisk.map(c => c.institution_name).filter(Boolean))].slice(0, 3).join(', ');
    const dateStr   = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    // Smart rule-based executive summary (works without AI)
    const ruleBasedSummary = [
      `This regulatory intelligence report covers ${relevant.length} change${relevant.length !== 1 ? 's' : ''} detected across ${jurs.join(', ')} during the monitoring period.`,
      updated.length ? `${updated.length} regulatory source${updated.length !== 1 ? 's have' : ' has'} updated their published content.` : '',
      removed.length ? `${removed.length} document${removed.length !== 1 ? 's have' : ' has'} been removed from regulatory websites.` : '',
      newDocs.length ? `${newDocs.length} new document${newDocs.length !== 1 ? 's have' : ' has'} been published.` : '',
      highRisk.length
        ? `\n${highRisk.length} change${highRisk.length !== 1 ? 's have' : ' has'} been rated High or Critical risk${topInst ? ', including updates from ' + topInst : ''}. These require immediate review by compliance and legal teams to assess impact on current policies, client obligations, and reporting requirements.\n\nCompliance teams should work through the high-risk items in Section 3 as a priority, followed by a systematic review of all other detected changes within standard compliance timelines.`
        : '\n\nCompliance teams should review all detected changes and assess whether any updates to internal policies or client communications are required.',
    ].filter(Boolean).join(' ');

    // Try AI — fall back gracefully if unavailable or key missing
    let executiveSummary = ruleBasedSummary;
    let aiUsed = false;

    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-')) {
      try {
        const { OpenAI } = require('openai');
        const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const summary = relevant.slice(0, 12).map(c =>
          `- [${c.jurisdiction_name || c.jurisdiction_code}] ${c.institution_name}: ${c.change_type} — ${c.page_title}`
        ).join('\n');

        const aiRes = await Promise.race([
          oai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            max_tokens: 450,
            messages: [{
              role: 'user',
              content: `You are a senior regulatory compliance officer writing an executive summary for a compliance intelligence brief presented to a Board or Risk Committee.\n\nWrite 3 professional paragraphs covering:\n1. Overall regulatory landscape and key themes this period\n2. Most significant changes and their compliance implications\n3. Forward-looking statement and recommended priorities\n\nWrite in flowing prose. Be specific about which regulators and jurisdictions are most active. Do not use bullet points.\n\nDetected changes:\n${summary}\n\nScope: ${jurisdiction === 'all' ? 'All Jurisdictions' : jurisdiction} | Date: ${dateStr}`
            }]
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 25000))
        ]);

        if (aiRes.choices[0].message.content) {
          executiveSummary = aiRes.choices[0].message.content;
          aiUsed = true;
        }
      } catch(e) {
        console.log('[report] AI unavailable, using rule-based summary:', e.message);
        // executiveSummary stays as ruleBasedSummary
      }
    }

    const pdfBuffer = await generateReport({
      changes,
      executiveSummary,
      jurisdiction,
      generatedBy: user.full_name || user.email,
      title: title || `Regulatory Intelligence Report — ${jurisdiction === 'all' ? 'All Jurisdictions' : jurisdiction}`,
      dateGenerated: new Date(),
      aiUsed,
    });

    const filename = `RegWatch_Report_${jurisdiction}_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);

  } catch (err) {
    console.error('[report] Error:', err.message, err.stack?.split('\n')[1]);
    res.status(500).json({ ok: false, error: err.message });
  }
};
