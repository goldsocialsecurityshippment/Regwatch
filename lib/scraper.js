// lib/scraper.js ? Full document intelligence scraper
// Supports: HTML, PDF (basic text extraction), DOCX, legal notices, regulatory publications
const axios   = require('axios');
const cheerio = require('cheerio');
const crypto  = require('crypto');
const { URL } = require('url');

const TIMEOUT    = 30000;
const USER_AGENT = 'RegWatch-Compliance-Monitor/5.0 (+https://regwatch.io/bot)';

const DOC_EXTENSIONS = [
  '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
  '.odt','.ods','.odp','.rtf','.zip','.epub','.txt'
];

function hash(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

function isDocLink(href) {
  if (!href) return false;
  const lower = href.toLowerCase().split('?')[0];
  return DOC_EXTENSIONS.some(e => lower.endsWith(e));
}

function isPdfLink(href) {
  return (href || '').toLowerCase().split('?')[0].endsWith('.pdf');
}

function isDocxLink(href) {
  const lower = (href || '').toLowerCase().split('?')[0];
  return lower.endsWith('.docx') || lower.endsWith('.doc');
}

function normalizeUrl(href, base) {
  try {
    if (!href) return null;
    if (/^(mailto:|tel:|javascript:|#)/.test(href)) return null;
    return new URL(href, base).href;
  } catch { return null; }
}

function titleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const last  = parts[parts.length - 1] || '';
    return last.replace(/[-_]/g,' ').replace(/\.[^.]+$/,'')
               .replace(/\b\w/g, c => c.toUpperCase()).trim() || url;
  } catch { return url; }
}

function keywordMatch(text, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some(k => k && lower.includes(k.toLowerCase().trim()));
}

// ?? Publication date extraction ???????????????????????????????
function extractPublicationDate(text, $) {
  if ($) {
    const metaDate = $('meta[name="date"], meta[property="article:published_time"], meta[name="DC.date"]').attr('content');
    if (metaDate) return metaDate.substring(0, 10);
    const timeEl = $('time[datetime]').first().attr('datetime');
    if (timeEl) return timeEl.substring(0, 10);
  }
  const patterns = [
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
    /(\d{4})-(\d{2})-(\d{2})/,
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      try {
        const d = new Date(m[0]);
        if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
      } catch {}
    }
  }
  return null;
}

// ?? Basic PDF text extraction (no native modules) ?????????????
async function extractPdfText(buffer) {
  try {
    // Extract readable strings from PDF binary
    const raw = buffer.toString('binary');
    // Find text between parentheses (PDF string objects)
    const strings = [];
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === '(') {
        let j = i + 1, depth = 1, str = '';
        while (j < raw.length && depth > 0) {
          if (raw[j] === '\\') { j += 2; continue; }
          if (raw[j] === '(') depth++;
          if (raw[j] === ')') { depth--; if (depth === 0) break; }
          str += raw[j];
          j++;
        }
        // Only keep strings that look like real text
        if (str.length >= 3 && /[a-zA-Z]{2,}/.test(str)) {
          strings.push(str.replace(/\\n/g,' ').replace(/\\r/g,' ').trim());
        }
        i = j + 1;
      } else {
        i++;
      }
    }
    const text = strings.join(' ').replace(/\s+/g,' ').trim().substring(0, 80000);
    return { text, pages: 0, info: {} };
  } catch (err) {
    return { text: '', pages: 0, info: {}, error: err.message };
  }
}

// ?? DOCX text extraction ??????????????????????????????????????
async function extractDocxText(buffer) {
  try {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ buffer });
    return {
      text: (result.value || '').replace(/\s+/g,' ').trim().substring(0, 80000),
      messages: result.messages || []
    };
  } catch (err) {
    return { text: '', error: err.message };
  }
}

// ?? HTML helpers ??????????????????????????????????????????????
function extractTitle($, fallbackUrl) {
  return ($('title').first().text().trim() ||
          $('h1').first().text().trim() ||
          titleFromUrl(fallbackUrl)).substring(0, 300);
}

function cleanText($) {
  $('script,style,nav,footer,header,noscript,.cookie,.banner,.ad,.sidebar,.navigation').remove();
  return $('body').text().replace(/\s+/g,' ').trim().substring(0, 80000);
}

function extractLinks($, baseUrl, keywords) {
  const links = [], seen = new Set();
  $('a[href]').each((_, el) => {
    const $el  = $(el);
    const href = $el.attr('href');
    const url  = normalizeUrl(href, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const text    = ($el.text().trim() || $el.attr('title') || '').substring(0, 300);
    const context = $el.closest('li,tr,div,p,td').text().trim().substring(0, 300);
    const isDoc   = isDocLink(url);
    const matched = keywordMatch(text + ' ' + context + ' ' + url, keywords);
    links.push({ url, text, isDocument: isDoc, keywordMatch: matched, context });
  });
  return links;
}

// ?? Main scrape function ??????????????????????????????????????
async function scrapeSource(source, options = {}) {
  const { exact_url, keywords = [] } = source;
  const result = {
    url: exact_url, ok: false, statusCode: null,
    contentHash: null, textContent: '', title: '',
    documentLinks: [], allLinks: [],
    pubDate: null, docType: 'webpage',
    error: null, scrapedAt: new Date().toISOString()
  };

  try {
    const res = await axios.get(exact_url, {
      timeout: TIMEOUT,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/pdf,*/*' },
      maxRedirects: 5,
      validateStatus: s => s < 600,
      responseType: 'arraybuffer'
    });

    result.statusCode = res.status;
    if (res.status === 404) { result.error = 'Page not found (404)'; return result; }
    if (res.status === 403) { result.error = 'Access forbidden (403)'; return result; }
    if (res.status >= 400) { result.error = `HTTP ${res.status}`;      return result; }

    const ct     = (res.headers['content-type'] || '').toLowerCase();
    const buffer = Buffer.from(res.data);

    // ?? PDF ??????????????????????????????????????????????????
    if (ct.includes('pdf') || isPdfLink(exact_url)) {
      result.ok      = true;
      result.docType = 'pdf';
      result.title   = titleFromUrl(exact_url);
      const pdfData  = await extractPdfText(buffer);
      result.textContent = pdfData.text;
      result.contentHash = hash(pdfData.text || String(buffer.length));
      result.pubDate     = extractPublicationDate(pdfData.text, null);
      result.documentLinks = [{
        url: exact_url, text: result.title,
        isDocument: true, keywordMatch: true, context: '',
        docType: 'pdf', textContent: result.textContent,
        contentHash: result.contentHash, pubDate: result.pubDate
      }];
      return result;
    }

    // ?? DOCX / DOC ????????????????????????????????????????????
    if (isDocxLink(exact_url)) {
      result.ok      = true;
      result.docType = 'docx';
      result.title   = titleFromUrl(exact_url);
      const docxData = await extractDocxText(buffer);
      result.textContent = docxData.text;
      result.contentHash = hash(docxData.text || String(buffer.length));
      result.pubDate     = extractPublicationDate(docxData.text, null);
      result.documentLinks = [{
        url: exact_url, text: result.title,
        isDocument: true, keywordMatch: true, context: '',
        docType: 'docx', textContent: result.textContent,
        contentHash: result.contentHash, pubDate: result.pubDate
      }];
      return result;
    }

    // ?? HTML page ?????????????????????????????????????????????
    const html = buffer.toString('utf-8');
    const $    = cheerio.load(html);
    result.title       = extractTitle($, exact_url);
    result.textContent = cleanText($);
    result.contentHash = hash(result.textContent);
    result.pubDate     = extractPublicationDate(result.textContent, $);
    result.docType     = 'webpage';
    result.allLinks    = extractLinks($, exact_url, keywords);
    result.documentLinks = result.allLinks.filter(l => l.isDocument);
    result.ok = true;

  } catch (err) {
    if (err.code === 'ECONNREFUSED')             result.error = 'Connection refused';
    else if (/TIMEDOUT|ABORTED/.test(err.code)) result.error = 'Request timed out';
    else if (err.code === 'ENOTFOUND')           result.error = 'Domain not found';
    else if (err.response)                       result.error = `HTTP ${err.response.status}`;
    else                                         result.error = (err.message || 'Unknown error').substring(0, 100);
    result.statusCode = err.response?.status || null;
  }
  return result;
}

// ?? Change detection ??????????????????????????????????????????
function detectChanges(previous, current, source) {
  const changes = [];
  const now     = new Date().toISOString();
  const kws     = source.keywords || [];

  if (!previous) {
    for (const link of (current.documentLinks || [])) {
      if (!link.keywordMatch) continue;
      changes.push({
        change_type: 'new', page_title: link.text || titleFromUrl(link.url),
        exact_url: link.url, parent_url: source.exact_url, source_id: source.id,
        ai_summary: `New document discovered: "${link.text || titleFromUrl(link.url)}"${link.pubDate ? ` (${link.pubDate})` : ''}`,
        detected_at: now, is_document: true, keyword_matched: true,
        pub_date: link.pubDate || null, doc_type: link.docType || 'document',
        content_hash: link.contentHash || null
      });
    }
    return changes;
  }

  const prevDocs = new Map((previous.documentLinks || []).map(l => [l.url, l]));
  const currDocs = new Map((current.documentLinks  || []).map(l => [l.url, l]));

  // New documents
  for (const [url, link] of currDocs) {
    if (!prevDocs.has(url) && link.keywordMatch) {
      changes.push({
        change_type: 'new', page_title: link.text || titleFromUrl(url),
        exact_url: url, parent_url: source.exact_url, source_id: source.id,
        ai_summary: `New document published: "${link.text || titleFromUrl(url)}"${link.pubDate ? ` (${link.pubDate})` : ''}`,
        detected_at: now, is_document: true, keyword_matched: true,
        pub_date: link.pubDate || null, doc_type: link.docType || 'document'
      });
    }
  }

  // Removed documents ? filter out navigation/language links
  for (const [url, link] of prevDocs) {
    if (!currDocs.has(url)) {
      const text = (link.text || '').trim();
      const urlLower = url.toLowerCase();
      // Skip: very short texts (nav links), language names, country names used as nav
      const NAV_WORDS = ['en','fr','es','de','pt','ar','zh','francais','espanol','english','deutsch','arabic','download','more','view','read','click','here','back','next','prev','home','read more','learn more','find out more','see more','show more','more info','load more','view all','see all','show all','details','close','open','expand','collapse','share','print','email','subscribe','follow','contact','about','help'];
      const MONTH_WORDS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const tLow = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      const isMonthYear = MONTH_WORDS.some(function(m){ return tLow.indexOf(m) === 0; }) && text.length < 25;
      const isNavLink = text.length < 4 ||
        NAV_WORDS.indexOf(tLow) !== -1 ||
        isMonthYear ||
        NAV_WORDS.some(function(n){ return tLow === n || tLow.startsWith(n + ' ') || tLow.endsWith(' ' + n); }) ||
        (!urlLower.includes('.pdf') && !urlLower.includes('.doc') && !urlLower.includes('.xls') &&
         text.length < 20 && text.indexOf('20') === -1 && text.indexOf('19') === -1 && !/[A-Z]{2}/.test(text));
      if (isNavLink) continue;
      changes.push({
        change_type: 'removed', page_title: text || titleFromUrl(url),
        exact_url: url, parent_url: source.exact_url, source_id: source.id,
        ai_summary: `Document removed: "${text || titleFromUrl(url)}"`,
        detected_at: now, is_document: true, keyword_matched: true
      });
    }
  }

  // Updated documents (content hash changed)
  for (const [url, currLink] of currDocs) {
    const prevLink = prevDocs.get(url);
    if (prevLink && currLink.contentHash && prevLink.contentHash &&
        currLink.contentHash !== prevLink.contentHash && currLink.keywordMatch) {
      changes.push({
        change_type: 'updated', page_title: currLink.text || titleFromUrl(url),
        exact_url: url, parent_url: source.exact_url, source_id: source.id,
        ai_summary: `Document content updated: "${currLink.text || titleFromUrl(url)}"`,
        detected_at: now, is_document: true, keyword_matched: true,
        content_before: (prevLink.textContent || '').substring(0, 3000),
        content_after:  (currLink.textContent  || '').substring(0, 3000)
      });
    }
  }

  // Page content change
  if (previous.contentHash && current.contentHash &&
      previous.contentHash !== current.contentHash && current.docType === 'webpage') {
    const matched = keywordMatch(current.textContent || '', kws);
    if (matched) {
      changes.push({
        change_type: 'updated', page_title: current.title || source.page_title,
        exact_url: source.exact_url, parent_url: source.exact_url, source_id: source.id,
        ai_summary: `Page content updated: "${current.title || source.page_title}"`,
        detected_at: now, is_document: false, keyword_matched: matched,
        content_before: (previous.textContent || '').substring(0, 5000),
        content_after:  (current.textContent  || '').substring(0, 5000)
      });
    }
  }

  return changes;
}

module.exports = {
  scrapeSource, detectChanges, hash, titleFromUrl,
  extractPdfText, extractDocxText, extractPublicationDate, keywordMatch
};
