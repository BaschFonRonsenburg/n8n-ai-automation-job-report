/**
 * test-report.js — offline end-to-end check of the NEW presentation nodes
 * ("Prep Summaries" -> [Gemini mocked] -> "Apply Summaries" -> "Build Report").
 *
 * Fetches live Remotive/Jobicy, runs the real transform, then executes each Code
 * node body the same way n8n would (mocking $, $input, this.helpers). Writes the
 * generated email HTML and the styled .xls so they can be opened/previewed.
 *
 *   node scripts/test-report.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const { fromRemotive, fromJobicy, buildRows } = require('../src/normalize-core');

const OUT = process.argv[2] || path.join(__dirname, '..', '.tmp');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function loadBody(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
}
function makeItems(rows) { return rows.map((json) => ({ json })); }

const gj = async (u) => {
  try { const r = await fetch(u, { headers: { 'User-Agent': 'wf-test' } }); return r.ok ? await r.json() : {}; }
  catch (e) { return {}; }
};

(async () => {
  const [rem, job] = await Promise.all([
    gj('https://remotive.com/api/remote-jobs?search=automation&limit=50'),
    gj('https://jobicy.com/api/v2/remote-jobs?count=50&tag=automation'),
  ]);
  const rows = buildRows({ remotive: fromRemotive(rem.jobs || []), jobicy: fromJobicy(job.jobs || []) });
  console.log(`Transform produced ${rows.length} rows.`);
  if (!rows.length) { console.log('No rows — nothing to render.'); return; }

  // 1) Prep Summaries ($input = the job rows)
  const prepFn = new AsyncFunction('$input', loadBody('prep-summaries.js'));
  const prepOut = await prepFn({ all: () => makeItems(rows) });
  const prepItem = prepOut[0].json;
  console.log(`Prep Summaries -> 1 item, geminiBody bytes: ${JSON.stringify(prepItem.geminiBody).length}`);

  // 2) Mock Gemini: a plausible one-liner per job, as the real JSON-array response shape.
  const fakeArr = rows.map((r, i) => ({ i, summary: `${r.company} is hiring a ${r.job_type.replace('_', '-')} ${r.title} focused on automation/AI workflows.` }));
  const geminiResp = { candidates: [{ content: { parts: [{ text: JSON.stringify(fakeArr) }] } }] };

  // 3) Apply Summaries ($ returns Prep + Gemini)
  const $ = (name) => ({
    first: () => ({ json: name === 'Prep Summaries' ? prepItem : name === 'Gemini' ? geminiResp : {} }),
    all: () => [],
  });
  const applyFn = new AsyncFunction('$', loadBody('apply-summaries.js'));
  const applied = await applyFn($);
  console.log(`Apply Summaries -> ${applied.length} items; sample summary: "${applied[0].json.summary}"`);

  // 4) Build Report ($input = applied items, this.helpers mocked)
  const mockThis = {
    helpers: {
      prepareBinaryData: async (buf, fileName, mimeType) => ({
        data: buf.toString('base64'), mimeType, fileName,
      }),
      httpRequest: async ({ url }) => {
        const r = await fetch(url.replace(/&amp;/g, '&'), { headers: { 'User-Agent': 'wf-test' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return Buffer.from(await r.arrayBuffer());
      },
    },
  };
  const buildFn = new AsyncFunction('$input', loadBody('build-report.js'));
  const [report] = await buildFn.call(mockThis, { all: () => applied });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'email-preview.html'), report.json.html);
  fs.writeFileSync(path.join(OUT, 'report.xls'), Buffer.from(report.binary.data.data, 'base64'));
  fs.writeFileSync(path.join(OUT, 'company-trust-chart.png'), Buffer.from(report.binary.chart.data, 'base64'));
  fs.writeFileSync(path.join(OUT, 'chart-url.txt'), report.json.chart_url);
  console.log(`  attachments: data(${report.binary.data.fileName}) + chart(${report.binary.chart.fileName}, ${Buffer.from(report.binary.chart.data, 'base64').length} bytes)`);

  console.log('\nBuild Report ->');
  console.log(`  subject : ${report.json.subject}`);
  console.log(`  email   : ${path.join(OUT, 'email-preview.html')} (${report.json.html.length} bytes)`);
  console.log(`  xls     : ${path.join(OUT, 'report.xls')}`);
  console.log(`  chart   : ${report.json.chart_url.slice(0, 80)}...`);
  console.log(`  chart URL length: ${report.json.chart_url.length}`);
})();
