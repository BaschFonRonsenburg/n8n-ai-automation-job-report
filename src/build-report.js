/**
 * build-report.js — body of the n8n Code node "Build Report".
 * Mode: "Run Once for All Items".
 *
 * Turns the summarized+scored job rows (from "Apply Summaries") into the whole
 * deliverable, in ONE place so all presentation logic is testable together:
 *   - json.chart_url : a QuickChart image URL (top companies by Trust score).
 *   - json.html      : the full HTML email body (chart + per-role cards).
 *   - json.subject   : the email subject line.
 *   - json.count     : role count (for the Data Table / logging).
 *   - binary.data    : a styled, Excel-compatible .xls (opens in Excel/Sheets with
 *                      colored headers, a colored Trust column, and clickable links).
 *
 * The .xls is an HTML table saved with an .xls extension — the only way to ship a
 * *styled* spreadsheet from n8n Cloud, which blocks external Code-node libraries
 * (exceljs) and whose "Convert to File" node can't format cells. Excel/Google Sheets
 * open it with the formatting intact.
 */

// ---------- pure helpers (kept side-effect free for offline testing) ----------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BAND_COLOR = { High: '#16a34a', Good: '#d97706', Basic: '#6b7280' };
const BAND_BG = { High: '#dcfce7', Good: '#fef3c7', Basic: '#f3f4f6' };

/** QuickChart horizontal bar of the top companies by (max) Trust score. */
function buildChartUrl(jobs) {
  const byCompany = {};
  for (const j of jobs) {
    const c = j.company || 'Unknown';
    const band = j.trust_band || 'Basic';
    if (!byCompany[c] || j.trust_score > byCompany[c].score) {
      byCompany[c] = { score: j.trust_score || 0, band };
    }
  }
  const top = Object.keys(byCompany)
    .map((c) => ({ company: c, score: byCompany[c].score, band: byCompany[c].band }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const config = {
    type: 'horizontalBar',
    data: {
      labels: top.map((t) => (t.company.length > 26 ? t.company.slice(0, 25) + '…' : t.company)),
      datasets: [{
        label: 'Trust score',
        data: top.map((t) => t.score),
        backgroundColor: top.map((t) => BAND_COLOR[t.band] || BAND_COLOR.Basic),
        borderWidth: 0,
      }],
    },
    options: {
      legend: { display: false },
      title: { display: true, text: 'Company Trust Score (0–100)', fontSize: 16 },
      scales: { xAxes: [{ ticks: { beginAtZero: true, max: 100, stepSize: 20 } }] },
    },
  };
  return 'https://quickchart.io/chart?w=600&h=320&bkg=white&c=' +
    encodeURIComponent(JSON.stringify(config));
}

// Palette for the initial-avatar background, picked deterministically from the name.
const AVATAR_BG = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];

/** A small round avatar with the company's initial. We deliberately DON'T hotlink the
 *  employer logo — several boards (e.g. Remotive) 403 hotlinked logos, which renders as
 *  a broken image in the email. A colored initial is always reliable. */
function avatar(job) {
  const name = (job.company || '?').trim();
  const initial = esc(name.charAt(0).toUpperCase() || '?');
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const bg = AVATAR_BG[h % AVATAR_BG.length];
  return '<div style="width:40px;height:40px;border-radius:8px;background:' + bg + ';color:#fff;' +
    'font:600 18px sans-serif;text-align:center;line-height:40px">' + initial + '</div>';
}

function trustBadge(job) {
  const band = job.trust_band || 'Basic';
  return '<span style="display:inline-block;padding:2px 10px;border-radius:999px;font:600 12px sans-serif;' +
    'color:' + (BAND_COLOR[band] || BAND_COLOR.Basic) + ';background:' + (BAND_BG[band] || BAND_BG.Basic) +
    '">Trust ' + esc(job.trust_score) + ' · ' + esc(band) + '</span>';
}

function jobCard(job) {
  const meta = [job.job_type, job.location, job.posted_date, job.salary]
    .filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  return '' +
    '<tr><td style="padding:16px 0;border-bottom:1px solid #eee">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="52" valign="top">' + avatar(job) + '</td>' +
    '<td valign="top">' +
    '<div style="font:600 16px sans-serif;color:#111">' +
    '<a href="' + esc(job.url) + '" style="color:#4f46e5;text-decoration:none">' + esc(job.title) + '</a></div>' +
    '<div style="font:400 14px sans-serif;color:#374151;margin:2px 0 6px">' + esc(job.company) +
    ' &nbsp; ' + trustBadge(job) + '</div>' +
    '<div style="font:400 13px sans-serif;color:#6b7280;margin-bottom:6px">' + meta + '</div>' +
    '<div style="font:400 14px sans-serif;color:#111;line-height:1.45">' + esc(job.summary || job.description) + '</div>' +
    (job.trust_reasons ? '<div style="font:400 12px sans-serif;color:#9ca3af;margin-top:6px">✓ ' +
      esc(job.trust_reasons) + '</div>' : '') +
    '<div style="margin-top:10px"><a href="' + esc(job.url) + '" ' +
    'style="display:inline-block;padding:7px 14px;background:#4f46e5;color:#fff;border-radius:6px;' +
    'font:600 13px sans-serif;text-decoration:none">Apply →</a></div>' +
    '</td></tr></table></td></tr>';
}

function buildEmailHtml(jobs, reportDate, chartUrl) {
  const count = jobs.length;
  const avg = count ? Math.round(jobs.reduce((s, j) => s + (j.trust_score || 0), 0) / count) : 0;
  const high = jobs.filter((j) => (j.trust_band || '') === 'High').length;
  const CARD_LIMIT = 12;
  const shown = jobs.slice(0, CARD_LIMIT);
  const cards = shown.map(jobCard).join('');
  const more = count > CARD_LIMIT
    ? '<p style="font:400 14px sans-serif;color:#6b7280;text-align:center;margin:16px 0">' +
      '…and ' + (count - CARD_LIMIT) + ' more in the attached Excel file.</p>'
    : '';

  function stat(label, value) {
    return '<td align="center" style="padding:10px">' +
      '<div style="font:700 22px sans-serif;color:#111">' + value + '</div>' +
      '<div style="font:400 12px sans-serif;color:#6b7280">' + label + '</div></td>';
  }

  return '' +
    '<div style="background:#f3f4f6;padding:24px 0;font-family:sans-serif">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.08)">' +

    // header
    '<div style="background:#4f46e5;padding:24px 28px">' +
    '<div style="font:700 20px sans-serif;color:#fff">Weekly AI-Automation Jobs</div>' +
    '<div style="font:400 14px sans-serif;color:#c7d2fe;margin-top:4px">' +
    'Part-time · contract · freelance &nbsp;|&nbsp; ' + esc(reportDate) + '</div></div>' +

    // stat row
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #eee">' +
    '<tr>' + stat('roles', count) + stat('avg trust', avg + '/100') + stat('high trust', high) + '</tr></table>' +

    // chart
    '<div style="padding:20px 28px 4px;text-align:center">' +
    '<div style="font:600 14px sans-serif;color:#374151;margin-bottom:8px;text-align:left">' +
    'Which employers look most legitimate?</div>' +
    '<img src="' + esc(chartUrl) + '" width="600" style="max-width:100%;border:1px solid #eee;border-radius:8px" alt="Company Trust Score chart">' +
    '<div style="font:400 11px sans-serif;color:#9ca3af;margin:6px 0 0;text-align:left">' +
    'Trust score is a transparency signal (salary shown, cross-posting, verified site, recency, reputable board) — not an official employer rating.</div>' +
    '</div>' +

    // cards
    '<div style="padding:8px 28px 20px"><table width="100%" cellpadding="0" cellspacing="0">' +
    cards + '</table>' + more + '</div>' +

    // footer
    '<div style="padding:16px 28px;background:#fafafa;border-top:1px solid #eee;' +
    'font:400 12px sans-serif;color:#9ca3af">Sources: Remotive, Jobicy, JSearch ' +
    '(Indeed / LinkedIn / Glassdoor / ZipRecruiter via Google for Jobs). ' +
    'Summaries by Google Gemini. Generated automatically by n8n.</div>' +

    '</div></div>';
}

/** Styled Excel-compatible .xls (HTML table). Opens in Excel/Sheets with formatting. */
function buildXlsHtml(jobs, reportDate) {
  const count = jobs.length;
  const avg = count ? Math.round(jobs.reduce((s, j) => s + (j.trust_score || 0), 0) / count) : 0;
  const high = jobs.filter((j) => (j.trust_band || '') === 'High').length;
  const good = jobs.filter((j) => (j.trust_band || '') === 'Good').length;
  const basic = count - high - good;

  const cols = [
    { k: 'trust_score', h: 'Trust', w: 60 },
    { k: 'trust_band', h: 'Band', w: 60 },
    { k: 'title', h: 'Title', w: 260 },
    { k: 'company', h: 'Company', w: 180 },
    { k: 'job_type', h: 'Type', w: 90 },
    { k: 'location', h: 'Location', w: 150 },
    { k: 'salary', h: 'Salary', w: 130 },
    { k: 'posted_date', h: 'Posted', w: 90 },
    { k: 'summary', h: 'Summary', w: 360 },
    { k: 'source', h: 'Source', w: 120 },
  ];
  const thStyle = 'background:#4f46e5;color:#fff;font:600 12px sans-serif;padding:8px;' +
    'border:1px solid #4338ca;text-align:left';
  const head = '<tr>' + cols.map((c) =>
    '<th style="' + thStyle + ';width:' + c.w + 'px">' + esc(c.h) + '</th>').join('') +
    '<th style="' + thStyle + '">Link</th></tr>';

  const rows = jobs.map((j, idx) => {
    const zebra = idx % 2 ? '#f8fafc' : '#ffffff';
    const cells = cols.map((c) => {
      let v = j[c.k];
      let style = 'padding:6px 8px;border:1px solid #e5e7eb;font:400 12px sans-serif;' +
        'background:' + zebra + ';vertical-align:top';
      if (c.k === 'trust_band' || c.k === 'trust_score') {
        style += ';font-weight:600;color:' + (BAND_COLOR[j.trust_band] || BAND_COLOR.Basic) +
          ';background:' + (BAND_BG[j.trust_band] || BAND_BG.Basic) + ';text-align:center';
      }
      if (c.k === 'title') {
        return '<td style="' + style + '"><a href="' + esc(j.url) + '">' + esc(v) + '</a></td>';
      }
      return '<td style="' + style + '">' + esc(v) + '</td>';
    }).join('');
    const link = '<td style="padding:6px 8px;border:1px solid #e5e7eb;font:400 12px sans-serif;' +
      'background:' + zebra + '"><a href="' + esc(j.url) + '">open</a></td>';
    return '<tr>' + cells + link + '</tr>';
  }).join('');

  const span = cols.length + 1; // +1 for the Link column
  const banner = '<tr><td colspan="' + span + '" style="background:#312e81;color:#fff;' +
    'font:700 18px sans-serif;padding:14px 10px;border:1px solid #312e81">' +
    'Weekly AI-Automation Jobs &nbsp;·&nbsp; Part-time / Contract / Freelance &nbsp;·&nbsp; ' + esc(reportDate) +
    '</td></tr>';
  const summary = '<tr><td colspan="' + span + '" style="background:#eef2ff;color:#3730a3;' +
    'font:600 13px sans-serif;padding:8px 10px;border:1px solid #c7d2fe">' +
    count + ' roles &nbsp;·&nbsp; avg trust ' + avg + '/100 &nbsp;·&nbsp; ' +
    high + ' High · ' + good + ' Good · ' + basic + ' Basic &nbsp;·&nbsp; ' +
    'Sources: Remotive, Jobicy, JSearch</td></tr>';
  const legend = '<tr><td colspan="' + span + '" style="background:#ffffff;color:#6b7280;' +
    'font:400 11px sans-serif;padding:6px 10px;border:1px solid #e5e7eb">' +
    'Trust bands: High ≥ 80 &nbsp; Good 60–79 &nbsp; Basic &lt; 60 &nbsp; — a transparency signal ' +
    '(salary shown, cross-posting, verified site, recency, reputable board), not an official rating.</td></tr>';
  const spacer = '<tr><td colspan="' + span + '" style="height:8px"></td></tr>';

  return '<html><head><meta charset="utf-8"></head><body>' +
    '<table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse">' +
    banner + summary + legend + spacer + head + rows + '</table></body></html>';
}

// ---------- n8n glue ----------

const jobs = $input.all().map((i) => i.json);
const reportDate = new Date().toISOString().slice(0, 10);

const chartUrl = buildChartUrl(jobs);
const html = buildEmailHtml(jobs, reportDate, chartUrl);
const subject = 'Weekly AI Automation Jobs — ' + reportDate + ' (' + jobs.length + ' roles)';
const xlsHtml = buildXlsHtml(jobs, reportDate);

// Styled spreadsheet (binary property `data`).
const xlsBinary = await this.helpers.prepareBinaryData(
  Buffer.from(xlsHtml, 'utf8'),
  'ai-automation-jobs.xls',
  'application/vnd.ms-excel',
);

// The Trust chart as its own PNG file (binary property `chart`), so it's a standalone
// attachment in addition to being embedded in the email body. On any fetch failure we fall
// back to a 1x1 PNG so the email's chart attachment can never error the send.
let chartBinary;
try {
  const png = await this.helpers.httpRequest({ url: chartUrl, encoding: 'arraybuffer' });
  chartBinary = await this.helpers.prepareBinaryData(Buffer.from(png), 'company-trust-chart.png', 'image/png');
} catch (e) {
  const px = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  chartBinary = await this.helpers.prepareBinaryData(px, 'company-trust-chart.png', 'image/png');
}

return [{
  json: { subject, html, chart_url: chartUrl, count: jobs.length, report_date: reportDate },
  binary: { data: xlsBinary, chart: chartBinary },
}];
