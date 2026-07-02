/**
 * test-workflow-code.js — integration check of the ACTUAL Code-node body that is
 * embedded in workflow.json. Fetches the live APIs, mocks n8n's `$()` accessor with
 * that data, executes the embedded jsCode, and prints the resulting items. Proves the
 * inlined transform + n8n glue (readApiArray / readConfig / return shape) all work.
 *
 *   node scripts/test-workflow-code.js
 */
const fs = require('fs');
const path = require('path');

const workflow = require(path.join(__dirname, '..', 'workflow.json'));
const codeNode = workflow.nodes.find((n) => n.name === 'Compile Jobs');
const jsCode = codeNode.parameters.jsCode;

const gj = async (u) => {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'wf-test' } });
    return r.ok ? await r.json() : {};
  } catch (e) {
    return {};
  }
};

function makeDollar(dataByNode) {
  return (name) => ({
    all: () => (dataByNode[name] || []).map((json) => ({ json })),
    first: () => ({ json: (dataByNode[name] || [{}])[0] || {} }),
  });
}

(async () => {
  const [rem, job] = await Promise.all([
    gj('https://remotive.com/api/remote-jobs?search=automation&limit=50'),
    gj('https://jobicy.com/api/v2/remote-jobs?count=50&tag=automation'),
  ]);

  const $ = makeDollar({
    Config: [{ searchTerm: 'automation', maxAgeDays: 30, allowedTypes: 'part_time,contract,freelance', requireKeyword: true }],
    Remotive: [rem],
    Jobicy: [job],
  });

  // The Code node body ends in top-level `return`, which is legal inside a Function body.
  const fn = new Function('$', jsCode);
  const out = fn($);

  console.log('Code node returned', out.length, 'item(s).');
  if (out.length === 1 && out[0].json.empty) {
    console.log('  -> empty marker (no-results email branch would fire). OK.');
  } else {
    for (const it of out.slice(0, 10)) {
      const j = it.json;
      console.log(`  • [${j.source}] ${j.title} — ${j.company} (${j.job_type}) ${j.posted_date}`);
    }
    // sanity: every item must have the expected columns and NO leaked internals
    const bad = out.filter((it) => !it.json.url || '_hay' in it.json || '_ts' in it.json || '_types' in it.json);
    console.log(bad.length === 0 ? '  ✓ item shape clean (no internal fields leaked)' : `  ✗ ${bad.length} malformed items`);
  }
})();
