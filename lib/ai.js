// lib/ai.js — AI Intelligence Engine
// Auto-summary, compliance tagging, risk scoring, semantic relevance, obligations analysis

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4-turbo-preview';
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

// ── Core AI call ──────────────────────────────────────────────
async function callAI(prompt, maxTokens = 800) {
  if (!OPENAI_KEY) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model:       OPENAI_MODEL,
        max_tokens:  maxTokens,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

// ── Parse JSON safely ─────────────────────────────────────────
function parseJSON(text) {
  if (!text) return null;
  try {
    const clean = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    return JSON.parse(clean);
  } catch { return null; }
}

// ── COMPLIANCE AREAS ──────────────────────────────────────────
const COMPLIANCE_AREAS = [
  'AML', 'KYC', 'CFT', 'FATF', 'Beneficial Ownership', 'Data Protection',
  'Sanctions', 'Corporate Governance', 'Licensing', 'Enforcement',
  'Tax Transparency', 'OECD', 'Reporting', 'Disclosure', 'Registration'
];

// ── AI Auto-Analysis for detected document ────────────────────
async function analyseDocument(doc) {
  const {
    title = '', text = '', url = '',
    changeType = 'new', institution = '', jurisdiction = ''
  } = doc;

  const contentSnippet = (text || '').substring(0, 3000);
  if (!contentSnippet && !title) return null;

  const prompt = `You are a compliance intelligence analyst specialising in AML, KYC, FATF, beneficial ownership, sanctions, and regulatory frameworks for offshore jurisdictions (Cayman, BVI, Jersey, Bermuda, Guernsey, Gibraltar, UK, EU, International).

A ${changeType} regulatory document has been detected:
Institution: ${institution}
Jurisdiction: ${jurisdiction}
Title: ${title}
URL: ${url}
Content: ${contentSnippet}

Analyse this document and respond ONLY with valid JSON in this exact format:
{
  "summary": "2-3 sentence plain English summary of what this document is about",
  "compliance_impact": "1-2 sentences on the compliance significance and what organisations must do",
  "recommended_action": "Specific action compliance teams should take",
  "compliance_areas": ["array", "of", "applicable", "areas", "from", "AML/KYC/CFT/FATF/Beneficial Ownership/Data Protection/Sanctions/Corporate Governance/Licensing/Enforcement/Tax Transparency/Reporting/Disclosure"],
  "risk_level": "low|medium|high|critical",
  "risk_reasoning": "Brief explanation of risk level",
  "obligations": ["list", "of", "specific", "obligations", "identified"],
  "doc_type": "legislation|guidance|circular|notice|report|enforcement|consultation|register|policy|amendment",
  "relevance_score": 0-100,
  "key_themes": ["theme1", "theme2"]
}`;

  const response = await callAI(prompt, 1000);
  return parseJSON(response);
}

// ── Semantic relevance check ──────────────────────────────────
async function checkSemanticRelevance(text, keywords, institution, jurisdiction) {
  if (!text || text.length < 50) return { relevant: true, score: 50 };

  // First do fast keyword check
  if (keywords && keywords.length > 0) {
    const lower = text.toLowerCase();
    const directMatch = keywords.some(k => k && lower.includes(k.toLowerCase().trim()));
    if (directMatch) return { relevant: true, score: 90, method: 'keyword' };
  }

  // If no direct match, use AI for semantic check
  const snippet = text.substring(0, 1500);
  const keywordList = keywords?.join(', ') || 'AML, KYC, beneficial ownership, regulatory compliance';

  const prompt = `You are a compliance relevance classifier.

Document from: ${institution} (${jurisdiction})
Keywords of interest: ${keywordList}
Document excerpt: ${snippet}

Is this document relevant to the compliance areas indicated by the keywords?
Consider semantic similarity — a document about "shareholder transparency" is relevant to "beneficial ownership".

Respond ONLY with JSON:
{"relevant": true|false, "score": 0-100, "reason": "brief explanation"}`;

  const response = await callAI(prompt, 200);
  const result = parseJSON(response);
  return result || { relevant: true, score: 50, method: 'fallback' };
}

// ── Risk scoring ──────────────────────────────────────────────
function calculateRiskScore(analysis) {
  if (!analysis) return { level: 'medium', score: 50 };

  const levelMap = { critical: 95, high: 75, medium: 50, low: 25 };
  const score = levelMap[analysis.risk_level] || 50;

  // Boost score based on compliance areas
  let boost = 0;
  const highRiskAreas = ['Enforcement', 'Sanctions', 'AML', 'FATF'];
  if (analysis.compliance_areas) {
    boost = analysis.compliance_areas.filter(a => highRiskAreas.includes(a)).length * 5;
  }

  return {
    level: analysis.risk_level || 'medium',
    score: Math.min(100, score + boost),
    areas: analysis.compliance_areas || [],
    obligations: analysis.obligations || []
  };
}

// ── Compliance tags ───────────────────────────────────────────
function extractComplianceTags(analysis) {
  if (!analysis?.compliance_areas) return [];
  return analysis.compliance_areas
    .filter(a => COMPLIANCE_AREAS.includes(a))
    .slice(0, 8);
}

// ── Full document intelligence ────────────────────────────────
async function generateDocumentIntelligence(change, sourceInfo) {
  try {
    const doc = {
      title:       change.page_title || '',
      text:        change.content_after || change.ai_summary || '',
      url:         change.exact_url || '',
      changeType:  change.change_type,
      institution: sourceInfo?.institution_name || '',
      jurisdiction: sourceInfo?.jurisdiction_name || ''
    };

    const analysis = await analyseDocument(doc);
    if (!analysis) return null;

    const risk = calculateRiskScore(analysis);
    const tags = extractComplianceTags(analysis);

    return {
      summary:          analysis.summary || '',
      compliance_impact: analysis.compliance_impact || '',
      recommended_action: analysis.recommended_action || '',
      compliance_areas:  tags,
      risk_level:        risk.level,
      risk_score:        risk.score,
      risk_reasoning:    analysis.risk_reasoning || '',
      obligations:       analysis.obligations || [],
      doc_type:          analysis.doc_type || 'document',
      relevance_score:   analysis.relevance_score || 75,
      key_themes:        analysis.key_themes || []
    };
  } catch (err) {
    console.error('[ai] Intelligence error:', err.message);
    return null;
  }
}

module.exports = {
  analyseDocument,
  checkSemanticRelevance,
  calculateRiskScore,
  extractComplianceTags,
  generateDocumentIntelligence
};
