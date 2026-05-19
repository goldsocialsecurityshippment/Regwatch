// lib/reportGenerator.js - RegWatch Regulatory Intelligence Report
// Enterprise-grade PDF with diff analysis, compliance impact, and AI narratives
const PDFDocument = require('pdfkit');
const { generateDiff, generateNarrative } = require('./diffEngine');

const P = {
  navy:   '#0a1628', blue:  '#1a3a6b', accent: '#2563eb',
  sky:    '#dbeafe', white: '#ffffff', off:    '#f8fafc',
  border: '#e2e8f0', dark:  '#1e293b', gray:   '#64748b', lgray: '#94a3b8',
  risk:   { critical:'#7f1d1d', high:'#c2410c', medium:'#b45309', low:'#166534' },
  riskBg: { critical:'#fee2e2', high:'#fff7ed', medium:'#fffbeb', low:'#f0fdf4' },
  riskBar:{ critical:'#dc2626', high:'#ea580c', medium:'#d97706', low:'#16a34a' },
  chg:    { new:'#166534', updated:'#1d4ed8', removed:'#991b1b' },
  chgBg:  { new:'#dcfce7', updated:'#dbeafe', removed:'#fee2e2' },
};

const HIGH_VALUE_AREAS = ['AML','KYC','CFT','FATF','Sanctions','Beneficial Ownership','Enforcement','Tax Transparency'];

// Filter and score changes for quality
function prepareChanges(changes) {
  const seen = new Set();
  return changes
    .filter(c => {
      if (c.change_type === 'unreachable') return false;
      if (!c.institution_name || c.institution_name === 'Unknown Institution') return false;
      if (!c.page_title || c.page_title === 'Untitled' || c.page_title.length < 4) return false;
      const key = c.institution_name + '|' + c.change_type + '|' + (c.page_title || '').substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(c => {
      const diff = generateDiff(c.content_before, c.content_after);
      const narrative = generateNarrative(diff, c);
      const isHighValue = HIGH_VALUE_AREAS.some(area => {
        const text = [c.institution_name, c.page_title, c.ai_summary, ...(c.compliance_areas||[])].join(' ').toLowerCase();
        return text.includes(area.toLowerCase());
      });
      return { ...c, _diff: diff, _narrative: narrative, _highValue: isHighValue };
    })
    .sort((a, b) => {
      const riskOrder = { critical:0, high:1, medium:2, low:3 };
      const ra = riskOrder[a.priority] ?? 2;
      const rb = riskOrder[b.priority] ?? 2;
      if (ra !== rb) return ra - rb;
      if (a._highValue !== b._highValue) return a._highValue ? -1 : 1;
      if (a._diff.hasDiff !== b._diff.hasDiff) return a._diff.hasDiff ? -1 : 1;
      return 0;
    });
}

async function generateReport({ changes, executiveSummary, jurisdiction, generatedBy, title, dateGenerated, aiUsed }) {
  const relevant = prepareChanges(changes);
  const dateStr  = dateGenerated.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const jurs     = [...new Set(relevant.map(c => c.jurisdiction_name || c.jurisdiction_code).filter(Boolean))];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size:'A4', bufferPages:true, margins:{top:0,bottom:0,left:0,right:0} });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width, PH = doc.page.height;
    const ML = 48, MR = 48, CW = PW - ML - MR;

    //  Helpers 
    const need = h => { if (doc.y + h > PH - 55) newPage(); };

    const newPage = () => {
      doc.addPage({ size:'A4', margins:{top:0,bottom:0,left:0,right:0} });
      pageHeader();
    };

    const pageHeader = () => {
      doc.rect(0,0,PW,8).fill(P.accent);
      doc.rect(0,8,PW,34).fill(P.navy);
      doc.fontSize(8).fillColor('#93c5fd').font('Helvetica-Bold')
         .text('RegWatch  Regulatory Intelligence Report', ML, 19, {width: CW/2});
      doc.fontSize(8).fillColor(P.lgray).font('Helvetica')
         .text(dateStr, ML, 19, {width: CW, align:'right'});
      doc.y = 58;
    };

    const sectionHeader = (num, text, color) => {
      need(46);
      const y = doc.y;
      doc.rect(0, y, PW, 38).fill(color || P.navy);
      doc.rect(0, y, 4, 38).fill(P.accent);
      doc.fontSize(13).fillColor(P.white).font('Helvetica-Bold')
         .text(num + '.  ' + text, ML + 8, y + 12, {width: CW - 20, lineBreak: false});
      doc.y = y + 50;
    };

    const subHeader = text => {
      need(30);
      doc.y += 2;
      doc.rect(ML, doc.y, CW, 24).fill(P.sky);
      doc.rect(ML, doc.y, 3, 24).fill(P.accent);
      doc.fontSize(10).fillColor(P.blue).font('Helvetica-Bold')
         .text(text, ML + 10, doc.y + 6, {width: CW - 14});
      doc.y += 30;
    };

    const rule = (color, thick) => {
      doc.rect(ML, doc.y, CW, thick || 0.5).fill(color || P.border);
      doc.y += 6;
    };

    const badge = (label, bg, x, y, w) => {
      const bw = w || (label.length * 5.5 + 10);
      doc.rect(x, y, bw, 13).fill(bg);
      doc.fontSize(7).fillColor('#fff').font('Helvetica-Bold')
         .text(label, x, y + 3, {width: bw, align:'center'});
      return bw;
    };

    //  COVER PAGE 
    doc.rect(0, 0, PW, PH * 0.50).fill(P.navy);
    doc.rect(0, PH * 0.50, PW, PH * 0.50).fill(P.off);
    doc.rect(0, PH * 0.50 - 5, PW, 5).fill(P.accent);

    doc.fontSize(11).fillColor('#93c5fd').font('Helvetica-Bold')
       .text('RegWatch', ML, 52, {characterSpacing: 2});
    doc.fontSize(9).fillColor(P.lgray).font('Helvetica')
       .text('Regulatory Intelligence Platform', ML, 72);

    doc.fontSize(30).fillColor(P.white).font('Helvetica-Bold')
       .text('Regulatory\nIntelligence\nReport', ML, 120, {lineGap: 4});
    doc.fontSize(11).fillColor('#93c5fd').font('Helvetica')
       .text('AI-Powered Compliance Intelligence Brief', ML, 246);

    // Metadata strip on dark half
    doc.rect(ML, 278, CW, 0.5).fill('#334d70');
    const metaY = 294;
    [
      ['JURISDICTION', jurisdiction === 'all' ? 'All Jurisdictions' : jurisdiction, ML],
      ['GENERATED',    dateStr, ML + 155],
      ['PREPARED BY',  generatedBy, ML + 310],
    ].forEach(([label, val, x]) => {
      doc.fontSize(8).fillColor(P.lgray).font('Helvetica-Bold').text(label, x, metaY);
      doc.fontSize(9).fillColor(P.white).font('Helvetica').text(val, x, metaY + 13, {width: 145, ellipsis: true});
    });

    // Stat boxes on light half
    const stats = [
      { label:'Total Changes',      val: relevant.length,                                                  color: P.accent },
      { label:'High / Critical',    val: relevant.filter(c=>['high','critical'].includes(c.priority)).length, color: P.riskBar.high },
      { label:'With Diff Analysis', val: relevant.filter(c=>c._diff.hasDiff).length,                      color: '#7c3aed' },
      { label:'New Documents',      val: relevant.filter(c=>c.change_type==='new').length,                 color: P.riskBar.low },
    ];
    const bw = Math.floor(CW / 4) - 6, sY = PH * 0.50 + 24;
    stats.forEach((s, i) => {
      const bx = ML + i * (bw + 8);
      doc.rect(bx, sY, bw, 78).fill(P.white);
      doc.rect(bx, sY, bw, 3).fill(s.color);
      doc.fontSize(26).fillColor(P.navy).font('Helvetica-Bold')
         .text(s.val.toString(), bx, sY + 16, {width: bw, align:'center'});
      doc.fontSize(8).fillColor(P.gray).font('Helvetica')
         .text(s.label, bx, sY + 52, {width: bw, align:'center'});
    });

    if (jurs.length) {
      const jurY = sY + 96;
      doc.fontSize(8).fillColor(P.gray).font('Helvetica-Bold')
         .text('JURISDICTIONS COVERED', ML, jurY, {characterSpacing: 0.5});
      jurs.forEach((j, i) => {
        doc.rect(ML + i * 88, jurY + 14, 80, 18).fill(P.sky);
        doc.fontSize(8).fillColor(P.blue).font('Helvetica-Bold')
           .text(j, ML + i * 88, jurY + 19, {width: 80, align:'center'});
      });
    }

    doc.rect(0, PH - 34, PW, 34).fill(P.navy);
    doc.fontSize(8).fillColor(P.lgray).font('Helvetica')
       .text('CONFIDENTIAL -- For Internal Compliance Use Only', ML, PH - 19, {width: CW, align:'center'});

    //  PAGE 2: EXECUTIVE SUMMARY 
    doc.addPage({size:'A4', margins:{top:0,bottom:0,left:0,right:0}});
    pageHeader();
    sectionHeader('1', 'Executive Summary');

    doc.rect(ML, doc.y, CW, 6).fill(P.sky);
    doc.y += 6;
    doc.rect(ML, doc.y, CW, 3).fill(P.accent);
    doc.y += 10;
    doc.fontSize(10.5).fillColor(P.dark).font('Helvetica').lineGap(4)
       .text(executiveSummary, ML, doc.y, {width: CW, align:'justify'});
    doc.y += 6;
    doc.rect(ML, doc.y, CW, 3).fill(P.border);
    doc.y += 18;

    // Quick stats
    const qs = [
      {label:'Monitoring Period', val: relevant.length > 0 ? new Date(relevant[relevant.length-1].detected_at).toLocaleDateString('en-GB') + ' -- ' + new Date(relevant[0].detected_at).toLocaleDateString('en-GB') : 'N/A'},
      {label:'Jurisdictions',     val: jurs.length.toString()},
      {label:'Changes Detected',  val: relevant.length.toString()},
      {label:'Require Action',    val: relevant.filter(c=>['high','critical'].includes(c.priority)).length.toString()},
    ];
    const qw = Math.floor(CW / qs.length) - 4;
    qs.forEach((q, i) => {
      const qx = ML + i * (qw + 6);
      doc.rect(qx, doc.y, qw, 44).fill(i%2===0 ? P.off : P.sky);
      doc.fontSize(7.5).fillColor(P.gray).font('Helvetica-Bold')
         .text(q.label.toUpperCase(), qx+6, doc.y+6, {width: qw-12, characterSpacing:0.3});
      doc.fontSize(14).fillColor(P.navy).font('Helvetica-Bold')
         .text(q.val, qx+6, doc.y+18, {width: qw-12});
    });
    doc.y += 56;

    //  SECTION 2: KEY REGULATORY DEVELOPMENTS 
    newPage();
    sectionHeader('2', 'Key Regulatory Developments');

    const byJur = {};
    relevant.forEach(c => {
      const k = c.jurisdiction_name || c.jurisdiction_code || 'Unknown';
      (byJur[k] = byJur[k] || []).push(c);
    });

    for (const [jur, jurChanges] of Object.entries(byJur)) {
      subHeader(jur);

      for (const ch of jurChanges) {
        const narrative = ch._narrative;
        const diff      = ch._diff;
        const rC        = P.riskBar[ch.priority] || P.riskBar.medium;
        const chLabel   = ch.change_type === 'new' ? 'NEW DOC' : ch.change_type === 'removed' ? 'REMOVED' : 'UPDATED';
        const chBg      = P.chg[ch.change_type] || P.gray;

        // Estimate card height
        const textLen = (narrative.what_changed || '').length;
        const impLen  = (narrative.compliance_impact || '').length;
        const actLen  = (narrative.recommended_action || '').length;
        const hasDiff = diff.hasDiff;
        const diffH   = hasDiff ? Math.max(60, Math.ceil(Math.max((diff.removed[0]||'').length, (diff.added[0]||'').length) / 55) * 12 + 44) : 0;
        const cardH   = 18 + Math.ceil(textLen/72)*13 + Math.ceil(impLen/72)*12 + Math.ceil(actLen/72)*12 + 28 + diffH;

        need(Math.min(cardH, 200));

        const cardY = doc.y;
        const cx = ML + 14, cw = CW - 18;

        // Card background + risk stripe
        doc.rect(ML, cardY, CW, cardH).fill(P.white);
        doc.rect(ML, cardY, CW, 0.5).fill(P.border);
        doc.rect(ML, cardY + cardH - 0.5, CW, 0.5).fill(P.border);
        doc.rect(ML, cardY, 4, cardH).fill(rC);

        doc.y = cardY + 10;

        // Institution + badges
        doc.fontSize(11).fillColor(P.navy).font('Helvetica-Bold')
           .text(ch.institution_name || 'Unknown', cx, doc.y, {width: cw - 140, lineBreak: false});
        badge(chLabel, chBg, ML + CW - 72, cardY + 10);
        badge((ch.priority || 'MED').toUpperCase(), rC, ML + CW - 136, cardY + 10);

        // Page title
        if (ch.page_title && ch.page_title !== 'Untitled') {
          doc.fontSize(9.5).fillColor(P.accent).font('Helvetica')
             .text(ch.page_title, cx, doc.y + 2, {width: cw - 10, ellipsis: true});
        }

        // What changed
        doc.fontSize(10).fillColor(P.dark).font('Helvetica').lineGap(2)
           .text(narrative.what_changed, cx, doc.y + 5, {width: cw - 10});

        // Compliance impact
        if (narrative.compliance_impact) {
          doc.fontSize(9).fillColor(P.gray).font('Helvetica-Bold')
             .text('IMPACT  ', cx, doc.y + 4, {continued: true, width: cw});
          doc.font('Helvetica').fillColor(P.dark).text(narrative.compliance_impact);
        }

        // Action
        if (narrative.recommended_action) {
          doc.fontSize(9).fillColor(P.blue).font('Helvetica-Bold')
             .text('ACTION  ', cx, doc.y + 3, {continued: true, width: cw});
          doc.font('Helvetica').fillColor(P.blue).text(narrative.recommended_action);
        }

        // Current content snapshot - show what the page says NOW
        const currentContent = (ch.content_after || ch.content_before || '').trim();
        if (currentContent && currentContent.length > 50) {
          need(80);
          const snipY = doc.y + 5;
          doc.rect(ML, snipY, CW, 18).fill(P.navy);
          doc.rect(ML, snipY, 4, 18).fill('#7c3aed');
          doc.fontSize(8).fillColor(P.white).font('Helvetica-Bold')
             .text('CURRENT REGULATORY TEXT', ML + 10, snipY + 5, {width: CW - 20});
          const snippet = currentContent.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
          const snH = Math.ceil(snippet.length / 80) * 11 + 16;
          doc.rect(ML, snipY + 18, CW, snH).fill('#f5f3ff');
          doc.fontSize(8.5).fillColor('#4c1d95').font('Helvetica')
             .text(snippet, ML + 8, snipY + 24, {width: CW - 16});
          doc.y = snipY + 18 + snH + 6;
        }

        // Diff table if available
        if (hasDiff && (diff.removed.length > 0 || diff.added.length > 0)) {
          const diffY = doc.y + 6;
          need(diffH);
          const hw = (CW - 4) / 2;
          doc.rect(ML, diffY, hw, 18).fill('#fee2e2');
          doc.rect(ML + hw + 4, diffY, hw, 18).fill('#dcfce7');
          doc.fontSize(8).fillColor('#991b1b').font('Helvetica-Bold')
             .text('PREVIOUS VERSION', ML + 6, diffY + 5, {width: hw - 8});
          doc.fontSize(8).fillColor('#166534').font('Helvetica-Bold')
             .text('CURRENT VERSION', ML + hw + 10, diffY + 5, {width: hw - 8});

          const bText = diff.removed.slice(0,3).join(' ... ') || diff.oldSnippet.substring(0,300);
          const aText = diff.added.slice(0,3).join(' ... ')   || diff.newSnippet.substring(0,300);
          const cH    = Math.max(40, Math.max(Math.ceil(bText.length/52), Math.ceil(aText.length/52)) * 12 + 12);

          doc.rect(ML, diffY + 18, hw, cH).fill('#fef2f2');
          doc.rect(ML + hw + 4, diffY + 18, hw, cH).fill('#f0fdf4');
          doc.fontSize(8.5).fillColor('#7f1d1d').font('Helvetica')
             .text(bText, ML + 6, diffY + 24, {width: hw - 10});
          doc.fontSize(8.5).fillColor('#14532d').font('Helvetica')
             .text(aText, ML + hw + 10, diffY + 24, {width: hw - 10});
          doc.y = diffY + 18 + cH + 6;
        }

        // Signal badges
        if (diff.signals && diff.signals.length > 0) {
          need(20);
          let sx = cx;
          diff.signals.forEach(sig => {
            const labels = { deadline_change:'Deadline Changed', timeperiod_change:'Timeframe Changed', obligation_added:'New Obligation' };
            const colors = { deadline_change:'#7c3aed', timeperiod_change:'#c2410c', obligation_added:'#991b1b' };
            const lbl = labels[sig.type] || sig.type;
            const bww = lbl.length * 5.5 + 10;
            if (sx + bww < ML + CW - 10) {
              doc.rect(sx, doc.y + 2, bww, 13).fill(colors[sig.type] || P.gray);
              doc.fontSize(7).fillColor('#fff').font('Helvetica-Bold')
                 .text(lbl, sx, doc.y + 5, {width: bww, align:'center'});
              sx += bww + 6;
            }
          });
          doc.y += 18;
        }

        // Meta row
        const metY = doc.y + 4;
        const dStr = ch.detected_at ? new Date(ch.detected_at).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) : '';
        doc.fontSize(7.5).fillColor(P.lgray).font('Helvetica')
           .text('Detected ' + dStr, cx, metY, {width: 100});
        if (ch.exact_url && ch.change_type !== 'removed') {
          doc.fontSize(7.5).fillColor(P.accent)
             .text(ch.exact_url, cx + 105, metY, {width: cw - 105, ellipsis: true});
        }

        doc.y = cardY + cardH + 8;
      }
      doc.y += 4;
    }

    //  SECTION 3: DETAILED CHANGE ANALYSIS 
    const withDiff = relevant.filter(c => c._diff.hasDiff && c._diff.signals.length > 0);
    if (withDiff.length > 0) {
      newPage();
      sectionHeader('3', 'Detailed Change Analysis', '#4c1d95');

      doc.fontSize(10).fillColor(P.dark).font('Helvetica')
         .text('The following changes include specific regulatory signal analysis -- detected changes to deadlines, timeframes, and obligations.', ML, doc.y, {width: CW});
      doc.y += 14;

      withDiff.forEach((ch, idx) => {
        need(80);
        const diff = ch._diff;
        doc.rect(ML, doc.y, CW, 26).fill(idx%2===0 ? P.off : P.sky);
        doc.rect(ML, doc.y, 4, 26).fill(P.riskBar[ch.priority] || P.riskBar.medium);
        doc.fontSize(10).fillColor(P.navy).font('Helvetica-Bold')
           .text((idx+1) + '.  ' + ch.institution_name, ML + 10, doc.y + 7, {width: CW/2});
        doc.fontSize(9).fillColor(P.gray).font('Helvetica')
           .text(ch.page_title || '', ML + CW/2, doc.y + 7, {width: CW/2 - 10, ellipsis: true, align:'right'});
        doc.y += 30;

        diff.signals.forEach(sig => {
          need(30);
          const labels = { deadline_change:'Deadline Change', timeperiod_change:'Timeframe Change', obligation_added:'New Obligation' };
          const colors = { deadline_change:'#7c3aed', timeperiod_change:'#c2410c', obligation_added:'#991b1b' };
          doc.rect(ML + 10, doc.y, CW - 10, 22).fill('#f8fafc');
          doc.fontSize(8).fillColor(colors[sig.type] || P.gray).font('Helvetica-Bold')
             .text((labels[sig.type] || sig.type).toUpperCase() + '  ', ML + 16, doc.y + 6, {continued: true});
          doc.fillColor(P.dark).font('Helvetica')
             .text(sig.description + (sig.before ? '  [' + sig.before + '] -> [' + sig.after + ']' : ''), {width: CW - 30});
          doc.y += 4;
        });
        doc.y += 6;
      });
    }

    //  SECTION 4: HIGH RISK ITEMS 
    const highRisk = relevant.filter(c => ['high','critical'].includes(c.priority));
    if (highRisk.length) {
      newPage();
      sectionHeader('4', 'High Risk Items -- Priority Review Required', '#7f1d1d');

      doc.rect(ML, doc.y, CW, 28).fill('#fef3c7');
      doc.rect(ML, doc.y, 4, 28).fill(P.riskBar.high);
      doc.fontSize(9).fillColor('#92400e').font('Helvetica-Bold')
         .text('! ' + highRisk.length + ' change' + (highRisk.length>1?'s':'') + ' rated High or Critical risk require immediate compliance team attention.', ML+12, doc.y+8, {width:CW-16});
      doc.y += 36;

      highRisk.forEach((ch, idx) => {
        const narrative = ch._narrative;
        const diff      = ch._diff;
        const rC        = P.riskBar[ch.priority];
        const rBg       = P.riskBg[ch.priority];
        const textLen   = (narrative.what_changed||'').length + (narrative.compliance_impact||'').length + (narrative.recommended_action||'').length;
        const estH      = 32 + Math.ceil(textLen/70)*13 + 24;
        need(estH);

        const cardY = doc.y;
        const cx = ML + 16, cw = CW - 18;

        doc.rect(ML, cardY, CW, estH).fill(rBg);
        doc.rect(ML, cardY, CW, 0.5).fill(rC);
        doc.rect(ML, cardY, 5, estH).fill(rC);
        doc.rect(ML, cardY + estH - 0.5, CW, 0.5).fill(rC);

        doc.y = cardY + 10;
        doc.fontSize(11).fillColor(P.risk[ch.priority]||P.risk.high).font('Helvetica-Bold')
           .text((idx+1) + '.  ' + ch.institution_name, cx, doc.y, {width: cw - 80});
        badge((ch.priority||'HIGH').toUpperCase(), rC, ML + CW - 72, cardY + 10);

        if (ch.page_title && ch.page_title !== 'Untitled') {
          doc.fontSize(9.5).fillColor(P.navy).font('Helvetica-Bold')
             .text(ch.page_title, cx, doc.y + 3, {width: cw});
        }

        doc.fontSize(10).fillColor(P.dark).font('Helvetica').lineGap(2)
           .text(narrative.what_changed, cx, doc.y + 5, {width: cw});

        if (narrative.compliance_impact) {
          doc.fontSize(9).fillColor(P.dark).font('Helvetica-Bold')
             .text('Impact: ', cx, doc.y + 4, {continued:true});
          doc.font('Helvetica').text(narrative.compliance_impact);
        }

        // Action box
        const action = narrative.recommended_action || 'Review this change and assess impact on current compliance framework.';
        const actH = Math.ceil(action.length / 72) * 12 + 12;
        need(actH + 10);
        doc.rect(cx, doc.y + 5, cw, actH).fill(P.white);
        doc.fontSize(8.5).fillColor(P.blue).font('Helvetica-Bold')
           .text('REQUIRED ACTION  ', cx + 6, doc.y + 9, {continued:true});
        doc.font('Helvetica').fillColor(P.dark).text(action, {width: cw - 12});

        // Show current regulatory text in high risk section
        const hrContent = (ch.content_after || ch.content_before || '').trim();
        if (hrContent && hrContent.length > 50) {
          need(70);
          const hrY = doc.y + 5;
          doc.rect(cx, hrY, cw, 16).fill(P.navy);
          doc.fontSize(8).fillColor(P.white).font('Helvetica-Bold')
             .text('CURRENT REGULATORY TEXT', cx + 6, hrY + 4, {width: cw - 12});
          const hrSnip = hrContent.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600);
          const hrH = Math.ceil(hrSnip.length / 75) * 11 + 14;
          doc.rect(cx, hrY + 16, cw, hrH).fill('#f5f3ff');
          doc.fontSize(8.5).fillColor('#4c1d95').font('Helvetica')
             .text(hrSnip, cx + 6, hrY + 22, {width: cw - 12});
          doc.y = hrY + 16 + hrH + 6;
        }

        if (diff.hasDiff && diff.signals.length > 0) {
          doc.y += 4;
          diff.signals.forEach(sig => {
            const colors = { deadline_change:'#7c3aed', timeperiod_change:'#c2410c', obligation_added:'#991b1b' };
            doc.fontSize(8).fillColor(colors[sig.type]||P.gray).font('Helvetica-Bold')
               .text(sig.description + (sig.before ? ' ['+sig.before+'] -> ['+sig.after+']' : ''), cx + 6, doc.y, {width: cw - 12});
            doc.y += 12;
          });
        }

        if (ch.exact_url && ch.change_type !== 'removed') {
          doc.fontSize(7.5).fillColor(P.accent)
             .text('Source: ' + ch.exact_url, cx, doc.y + 4, {width: cw, ellipsis: true});
        }

        doc.y = Math.max(doc.y + 6, cardY + estH + 10);
      });
    }

    //  SECTION 5: COMPLIANCE AREA BREAKDOWN 
    need(160);
    sectionHeader('5', 'Compliance Impact Analysis');

    const areaMap = {};
    relevant.forEach(c => {
      const text = [c.ai_summary, c.page_title, c.institution_name, ...(c.compliance_areas||[])].join(' ');
      const kws = {
        'Sanctions':/sanction|ofsi|otsi/i, 'AML':/anti.money.launder|aml/i,
        'KYC/CDD':/kyc|know.your.customer|due.diligence/i,
        'Beneficial Ownership':/beneficial.owner/i, 'FATF':/fatf/i,
        'Tax Transparency':/tax.transparen|crs|fatca|tax.justice/i,
        'Enforcement':/enforcement|penalty|fine|action/i,
        'Corporate Governance':/governance|corporate/i,
      };
      Object.entries(kws).forEach(([k,rx]) => { if(rx.test(text)) areaMap[k]=(areaMap[k]||0)+1; });
      (c.compliance_areas||[]).forEach(a => { if(a) areaMap[a]=(areaMap[a]||0)+1; });
    });

    const areas = [...new Map(Object.entries(areaMap))].sort((a,b)=>b[1]-a[1]).slice(0,8);
    const maxA  = areas[0]?.[1] || 1;

    if (areas.length) {
      doc.fontSize(10).fillColor(P.dark).font('Helvetica')
         .text('Regulatory activity by compliance domain:', ML, doc.y, {width: CW});
      doc.y += 12;
      areas.forEach(([area, count], i) => {
        need(24);
        doc.rect(ML, doc.y, CW, 22).fill(i%2===0 ? P.off : P.white);
        doc.fontSize(9.5).fillColor(P.navy).font('Helvetica-Bold')
           .text(area, ML+6, doc.y+5, {width: 160});
        const isHV = HIGH_VALUE_AREAS.some(h => area.toLowerCase().includes(h.toLowerCase()));
        if (isHV) { badge('HIGH VALUE', P.riskBar.high, ML+170, doc.y+5); }
        const barW = Math.max(20, Math.round((count/maxA)*(CW-260)));
        doc.rect(ML+230, doc.y+5, barW, 12).fill(isHV ? P.riskBar.high : P.accent);
        doc.fontSize(8.5).fillColor('#fff').font('Helvetica-Bold')
           .text(count.toString(), ML+230+barW-20, doc.y+6, {width:18, align:'right'});
        doc.y += 24;
      });
    }
    doc.y += 10;

    //  SECTION 6: ACTION TRACKER 
    need(100);
    sectionHeader('6', 'Recommended Action Tracker');

    const actions = relevant.filter(c => ['high','critical'].includes(c.priority) || c._diff.hasDiff);

    if (actions.length) {
      doc.rect(ML, doc.y, CW, 22).fill(P.navy);
      const cols = [[ML,18],[ML+20,155],[ML+177,52],[ML+231,CW-183]];
      const hdrs = ['#','Institution','Risk','Recommended Action'];
      hdrs.forEach((h,i) => {
        doc.fontSize(8.5).fillColor(P.white).font('Helvetica-Bold')
           .text(h, cols[i][0]+4, doc.y-15, {width:cols[i][1]});
      });
      doc.y += 6;

      actions.slice(0,18).forEach((c, i) => {
        const action = c._narrative.recommended_action || 'Review this change and assess compliance impact.';
        const rH = Math.max(20, Math.ceil(action.length/55)*11+10);
        need(rH);
        doc.rect(ML, doc.y, CW, rH).fill(i%2===0 ? P.off : P.white);
        doc.rect(ML, doc.y, CW, 0.5).fill(P.border);
        const rC2 = P.riskBar[c.priority] || P.riskBar.medium;
        doc.fontSize(8.5).fillColor(P.gray).font('Helvetica')
           .text((i+1).toString(), cols[0][0]+4, doc.y-rH+6, {width:cols[0][1]});
        doc.fillColor(P.navy).font('Helvetica-Bold')
           .text(c.institution_name||'', cols[1][0]+4, doc.y-rH+6, {width:cols[1][1]-4, ellipsis:true});
        doc.rect(cols[2][0]+4, doc.y-rH+5, 44, 12).fill(rC2);
        doc.fontSize(7).fillColor('#fff').font('Helvetica-Bold')
           .text((c.priority||'MED').toUpperCase(), cols[2][0]+4, doc.y-rH+8, {width:44,align:'center'});
        doc.fontSize(8.5).fillColor(P.dark).font('Helvetica')
           .text(action, cols[3][0]+4, doc.y-rH+6, {width:cols[3][1]-8});
        doc.y += 2;
      });
      doc.rect(ML, doc.y, CW, 1).fill(P.border);
      doc.y += 14;
    }

    //  SECTION 7: APPENDIX 
    need(120);
    sectionHeader('7', 'Report Metadata');

    const meta = [
      ['Report Generated', dateGenerated.toLocaleString('en-GB',{dateStyle:'full',timeStyle:'short'})],
      ['Prepared By', generatedBy],
      ['Jurisdiction Scope', jurisdiction==='all'?'All Jurisdictions':jurisdiction],
      ['Total Changes', relevant.length + ' (' + (changes.length - relevant.length) + ' filtered out as low-value)'],
      ['Changes With Diff Analysis', relevant.filter(c=>c._diff.hasDiff).length.toString()],
      ['High / Critical Risk', relevant.filter(c=>['high','critical'].includes(c.priority)).length.toString()],
      ['Monitoring Period', relevant.length > 0 ? new Date(relevant[relevant.length-1].detected_at).toLocaleDateString('en-GB') + ' -- ' + new Date(relevant[0].detected_at).toLocaleDateString('en-GB') : 'N/A'],
      ['Jurisdictions', jurs.join(', ')],
      ['AI Analysis', aiUsed ? 'OpenAI GPT-4 Turbo (active)' : 'Rule-based intelligence engine (OpenAI not configured)'],
      ['Diff Engine', 'RegWatch Change Analysis Engine v2.0'],
      ['Platform', 'RegWatch Enterprise v5.1.0'],
    ];

    meta.forEach(([k,v],i) => {
      need(20);
      doc.rect(ML, doc.y, CW, 20).fill(i%2===0?P.off:P.white);
      doc.fontSize(8.5).fillColor(P.gray).font('Helvetica-Bold').text(k, ML+6, doc.y+5, {width:170});
      doc.fontSize(8.5).fillColor(P.navy).font('Helvetica').text(v, ML+180, doc.y+5, {width:CW-186});
      doc.y += 22;
    });

    //  FOOTERS 
    const range = doc.bufferedPageRange();
    const total = range.count - 1;
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      if (i > 0) {
        doc.rect(0, PH-30, PW, 30).fill(P.off);
        doc.rect(0, PH-30, PW, 1).fill(P.border);
        doc.fontSize(7.5).fillColor(P.lgray).font('Helvetica')
           .text('RegWatch Regulatory Intelligence  --  Confidential -- For Internal Use Only', ML, PH-18, {width:CW/2});
        doc.fontSize(7.5).fillColor(P.lgray)
           .text('Page ' + i + ' of ' + total, ML, PH-18, {width:CW, align:'right'});
      }
    }

    doc.end();
  });
}

module.exports = { generateReport };
