// lib/diffEngine.js - Regulatory Change Intelligence Engine
// Compares before/after content and extracts meaningful regulatory differences

// Split text into meaningful sentences/segments
function splitSegments(text) {
  if (!text) return [];
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 20);
}

// Simple word-level diff - returns {added, removed, common} word arrays
function wordDiff(oldText, newText) {
  const oldWords = (oldText || '').toLowerCase().split(/\s+/).filter(Boolean);
  const newWords = (newText || '').toLowerCase().split(/\s+/).filter(Boolean);
  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);
  const added   = newWords.filter(w => !oldSet.has(w));
  const removed = oldWords.filter(w => !newSet.has(w));
  return { added, removed };
}

// Find sentences that were added, removed, or changed
function segmentDiff(oldText, newText) {
  const oldSegs = splitSegments(oldText);
  const newSegs = splitSegments(newText);

  const oldSet = new Set(oldSegs.map(s => s.toLowerCase().trim()));
  const newSet = new Set(newSegs.map(s => s.toLowerCase().trim()));

  const added   = newSegs.filter(s => !oldSet.has(s.toLowerCase().trim()));
  const removed = oldSegs.filter(s => !newSet.has(s.toLowerCase().trim()));

  return { added, removed };
}

// Extract regulatory signals - dates, numbers, obligations
function extractSignals(text) {
  if (!text) return [];
  const signals = [];

  // Dates and deadlines
  const datePattern = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi;
  const dates = text.match(datePattern) || [];
  dates.forEach(d => signals.push({ type: 'date', value: d }));

  // Percentages
  const pctPattern = /\b(\d+(?:\.\d+)?)\s*%/g;
  const pcts = text.match(pctPattern) || [];
  pcts.forEach(p => signals.push({ type: 'percentage', value: p }));

  // Time periods
  const timePattern = /\b(\d+)\s+(days?|weeks?|months?|years?|hours?)\b/gi;
  const times = text.match(timePattern) || [];
  times.forEach(t => signals.push({ type: 'timeperiod', value: t }));

  // Currency amounts
  const currPattern = /\b(USD|GBP|EUR|KYD|BMD|JEP)\s*[\d,]+(?:\.\d+)?\b|\b[\d,]+(?:\.\d+)?\s*(USD|GBP|EUR)\b/gi;
  const currs = text.match(currPattern) || [];
  currs.forEach(c => signals.push({ type: 'currency', value: c }));

  // Obligation keywords
  const oblPattern = /\b(must|shall|required to|mandatory|prohibited|not permitted|must not|obliged to|failure to|penalty|fine)\b/gi;
  const obls = text.match(oblPattern) || [];
  if (obls.length > 0) signals.push({ type: 'obligation_language', count: obls.length, examples: obls.slice(0, 3) });

  return signals;
}

// Compare signals between old and new text
function compareSignals(oldText, newText) {
  const oldSignals = extractSignals(oldText);
  const newSignals = extractSignals(newText);
  const changes = [];

  // Check for changed dates
  const oldDates = oldSignals.filter(s => s.type === 'date').map(s => s.value);
  const newDates = newSignals.filter(s => s.type === 'date').map(s => s.value);
  if (oldDates.length !== newDates.length || oldDates.join() !== newDates.join()) {
    if (oldDates.length > 0 || newDates.length > 0) {
      changes.push({
        type: 'deadline_change',
        description: 'Regulatory dates or deadlines have changed',
        before: oldDates.slice(0, 3).join(', ') || 'none',
        after: newDates.slice(0, 3).join(', ') || 'none'
      });
    }
  }

  // Check for changed time periods
  const oldTimes = oldSignals.filter(s => s.type === 'timeperiod').map(s => s.value);
  const newTimes = newSignals.filter(s => s.type === 'timeperiod').map(s => s.value);
  if (oldTimes.join() !== newTimes.join() && (oldTimes.length > 0 || newTimes.length > 0)) {
    changes.push({
      type: 'timeperiod_change',
      description: 'Reporting or compliance time periods have changed',
      before: oldTimes.slice(0, 3).join(', ') || 'none',
      after: newTimes.slice(0, 3).join(', ') || 'none'
    });
  }

  // Check for obligation language changes
  const oldObls = oldSignals.find(s => s.type === 'obligation_language');
  const newObls = newSignals.find(s => s.type === 'obligation_language');
  if (newObls && (!oldObls || newObls.count > oldObls.count)) {
    changes.push({
      type: 'obligation_added',
      description: 'New mandatory requirements or obligations detected',
      examples: (newObls.examples || []).join(', ')
    });
  }

  return changes;
}

// Main diff function - produces structured diff report
function generateDiff(oldText, newText) {
  if (!oldText || !newText) {
    return {
      hasDiff: false,
      reason: 'Content snapshots not available for this change',
      added: [], removed: [], signals: [], summary: null
    };
  }

  const { added, removed } = segmentDiff(oldText, newText);
  const { added: addedWords, removed: removedWords } = wordDiff(oldText, newText);
  const signals = compareSignals(oldText, newText);

  const changeSize = added.length + removed.length;
  const wordChanges = addedWords.length + removedWords.length;

  // Build human-readable summary
  const parts = [];
  if (removed.length > 0) parts.push(removed.length + ' section' + (removed.length > 1 ? 's' : '') + ' removed');
  if (added.length > 0) parts.push(added.length + ' section' + (added.length > 1 ? 's' : '') + ' added');
  if (signals.length > 0) parts.push(signals.map(s => s.description).join('; '));

  return {
    hasDiff: changeSize > 0 || wordChanges > 5,
    added:   added.slice(0, 8),
    removed: removed.slice(0, 8),
    addedWords: addedWords.slice(0, 20),
    removedWords: removedWords.slice(0, 20),
    signals,
    changeSize,
    wordChanges,
    summary: parts.length > 0 ? parts.join('. ') : 'Minor content changes detected',
    oldSnippet: (oldText || '').substring(0, 600),
    newSnippet: (newText || '').substring(0, 600)
  };
}

// Generate rule-based narrative explanation (no AI needed)
function generateNarrative(diff, change) {
  if (!diff.hasDiff) {
    return {
      what_changed: 'Content changes were detected on this regulatory page, but detailed comparison data is not yet available. This typically occurs for changes detected before the snapshot system was activated.',
      compliance_impact: 'Review the source directly to assess impact.',
      recommended_action: 'Visit the regulatory source and compare with your current compliance documentation.'
    };
  }

  const institution = change.institution_name || 'The regulatory body';
  const page = change.page_title || 'regulatory publication';
  const parts = [];

  if (diff.signals.length > 0) {
    diff.signals.forEach(sig => {
      if (sig.type === 'deadline_change') {
        parts.push('Regulatory dates changed from [' + sig.before + '] to [' + sig.after + '].');
      } else if (sig.type === 'timeperiod_change') {
        parts.push('Compliance timeframes changed from [' + sig.before + '] to [' + sig.after + '].');
      } else if (sig.type === 'obligation_added') {
        parts.push('New mandatory requirements detected including: ' + sig.examples + '.');
      }
    });
  }

  if (diff.removed.length > 0) {
    parts.push(diff.removed.length + ' section' + (diff.removed.length > 1 ? 's were' : ' was') + ' removed from the published content.');
  }
  if (diff.added.length > 0) {
    parts.push(diff.added.length + ' new section' + (diff.added.length > 1 ? 's were' : ' was') + ' added to the published content.');
  }
  if (diff.wordChanges > 0 && parts.length === 0) {
    parts.push('Approximately ' + diff.wordChanges + ' words changed in the regulatory text.');
  }

  const whatChanged = institution + ' updated "' + page + '". ' + (parts.join(' ') || diff.summary);

  // Compliance impact based on signals
  let impact = 'Compliance teams should review the updated content to determine whether current policies, procedures, or client communications require updating.';
  if (diff.signals.some(s => s.type === 'deadline_change' || s.type === 'timeperiod_change')) {
    impact = 'This change includes modified timelines or deadlines which may directly affect compliance schedules and reporting obligations.';
  } else if (diff.signals.some(s => s.type === 'obligation_added')) {
    impact = 'New mandatory language has been introduced which may create additional compliance obligations for regulated entities.';
  }

  // Recommended action
  let action = 'Review the updated regulatory page and assess impact on current compliance framework.';
  if (diff.signals.some(s => s.type === 'deadline_change')) {
    action = 'Immediately review updated deadlines and update internal compliance calendars and client notification schedules accordingly.';
  } else if (diff.signals.some(s => s.type === 'obligation_added')) {
    action = 'Legal and compliance teams should assess the new mandatory requirements and determine whether policy updates or client communications are required.';
  }

  return { what_changed: whatChanged, compliance_impact: impact, recommended_action: action };
}

module.exports = { generateDiff, generateNarrative, extractSignals, segmentDiff, wordDiff };
