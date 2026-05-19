// lib/keywordEngine.js - SourceWatch Keyword Intelligence Engine
// Tier 1/2/3 matching with proximity detection and exclusion logic

// Score a piece of text against a source's keyword tiers
function scoreContent(text, source) {
  if (!text || !source) return { score: 0, importance: 'filtered', matches: [], tier: 0 };

  const lower = text.toLowerCase();
  const title = (source.page_title || '').toLowerCase();
  const heading = extractHeadings(text).toLowerCase();

  const tier1 = source.keywords_tier1 || [];
  const tier2 = source.keywords_tier2 || [];
  const tier3 = source.keywords_tier3 || [];
  const exclude = source.keywords_exclude || [];

  const matches = { tier1: [], tier2: [], tier3: [] };
  let score = 0;
  let highestTier = 0;

  // Check exclusions first
  for (const ex of exclude) {
    const exLower = ex.toLowerCase();
    if (lower.includes(exLower)) {
      // Only exclude if NO strong tier1 terms present
      const hasTier1 = tier1.some(k => lower.includes(k.toLowerCase()));
      if (!hasTier1) {
        return { score: 0, importance: 'filtered', matches: [], tier: 0, reason: 'exclusion: ' + ex };
      }
    }
  }

  // Tier 1 matching - check title/heading first (highest value)
  for (const kw of tier1) {
    const kwLower = kw.toLowerCase();
    if (title.includes(kwLower) || heading.includes(kwLower)) {
      matches.tier1.push({ keyword: kw, location: 'title/heading' });
      score += 100;
      highestTier = Math.max(highestTier, 1);
    } else {
      // Count occurrences in body
      const count = countOccurrences(lower, kwLower);
      if (count >= 2) {
        matches.tier1.push({ keyword: kw, location: 'body', count });
        score += 60;
        highestTier = Math.max(highestTier, 1);
      } else if (count === 1) {
        matches.tier1.push({ keyword: kw, location: 'body', count });
        score += 30;
        highestTier = Math.max(highestTier, 1);
      }
    }
  }

  // Tier 2 matching - extra points if near tier1
  for (const kw of tier2) {
    const kwLower = kw.toLowerCase();
    if (lower.includes(kwLower)) {
      // Check proximity to tier1 terms
      const nearTier1 = matches.tier1.length > 0 && isNearAny(lower, kwLower, tier1.map(k => k.toLowerCase()), 50);
      if (nearTier1) {
        matches.tier2.push({ keyword: kw, proximity: 'near_tier1' });
        score += 40;
      } else {
        matches.tier2.push({ keyword: kw, proximity: 'standalone' });
        score += 15;
      }
      highestTier = Math.max(highestTier, 2);
    }
  }

  // Tier 3 matching - only counts if combined with tier1/2
  if (matches.tier1.length > 0 || matches.tier2.length > 0) {
    for (const kw of tier3) {
      const kwLower = kw.toLowerCase();
      if (lower.includes(kwLower)) {
        matches.tier3.push({ keyword: kw });
        score += 5;
        highestTier = Math.max(highestTier, 3);
      }
    }
  }

  // Apply source authority multiplier
  const authority = source.source_authority || 5;
  score = Math.round(score * (authority / 10));

  // Determine importance level
  let importance = 'filtered';
  if (score === 0 && matches.tier1.length === 0) {
    importance = 'filtered';
  } else if (
    matches.tier1.some(m => m.location === 'title/heading') ||
    matches.tier1.filter(m => m.count >= 2 || m.location === 'title/heading').length >= 2 ||
    score >= 150
  ) {
    importance = 'critical';
  } else if (
    matches.tier1.length >= 1 ||
    (matches.tier2.filter(m => m.proximity === 'near_tier1').length >= 2) ||
    score >= 60
  ) {
    importance = 'important';
  } else if (
    matches.tier2.length >= 2 ||
    matches.tier3.length >= 3 ||
    score >= 20
  ) {
    importance = 'monitor';
  }

  const allMatches = [
    ...matches.tier1.map(m => ({ ...m, tier: 1 })),
    ...matches.tier2.map(m => ({ ...m, tier: 2 })),
    ...matches.tier3.map(m => ({ ...m, tier: 3 })),
  ];

  return {
    score,
    importance,
    tier: highestTier,
    matches: allMatches,
    topKeywords: allMatches.slice(0, 5).map(m => m.keyword),
  };
}

// Check if a keyword appears within N characters of any term in a list
function isNearAny(text, keyword, terms, windowSize) {
  const kwIdx = text.indexOf(keyword);
  if (kwIdx === -1) return false;
  return terms.some(term => {
    const tIdx = text.indexOf(term);
    if (tIdx === -1) return false;
    return Math.abs(kwIdx - tIdx) <= windowSize;
  });
}

// Count non-overlapping occurrences of a substring
function countOccurrences(text, substring) {
  if (!substring) return 0;
  let count = 0, pos = 0;
  while ((pos = text.indexOf(substring, pos)) !== -1) {
    count++;
    pos += substring.length;
  }
  return count;
}

// Extract headings from text (h1-h4 equivalent patterns)
function extractHeadings(text) {
  if (!text) return '';
  // Get first 500 chars (likely title/headings area)
  return text.substring(0, 500);
}

// Score a change detection result
function scoreChange(change, source) {
  const textToScore = [
    change.page_title || '',
    change.ai_summary || '',
    change.content_after || '',
    change.content_before || '',
  ].join(' ');

  const result = scoreContent(textToScore, source);

  // Boost for certain change types
  if (change.change_type === 'new' && result.importance !== 'filtered') {
    // New documents are always at least important
    if (result.importance === 'monitor') result.importance = 'important';
  }

  return result;
}

// Get importance label for display
function getImportanceLabel(importance) {
  const labels = {
    critical:  { label: 'CRITICAL',  color: '#dc2626', bg: '#fee2e2', emoji: '🔴' },
    important: { label: 'IMPORTANT', color: '#ea580c', bg: '#fff7ed', emoji: '🟠' },
    monitor:   { label: 'MONITOR',   color: '#d97706', bg: '#fffbeb', emoji: '🟡' },
    filtered:  { label: 'FILTERED',  color: '#94a3b8', bg: '#f8fafc', emoji: '⚪' },
  };
  return labels[importance] || labels.monitor;
}

module.exports = { scoreContent, scoreChange, getImportanceLabel, countOccurrences };
