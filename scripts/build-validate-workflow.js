/**
 * build-validate-workflow.js — produces workflow.validate.json: the real workflow with
 * the two Gmail nodes removed, so it can be executed end-to-end on a local n8n WITHOUT a
 * Gmail credential. Everything through the Excel (To XLSX) node still runs, which is what
 * we want to validate. Not for production — the real file is workflow.json.
 *
 *   node scripts/build-validate-workflow.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflow.json'), 'utf8'));
const drop = new Set(['Email Report', 'Email No Results']);

wf.name = 'Weekly AI Automation Job Report (VALIDATE - no Gmail)';
wf.nodes = wf.nodes.filter((n) => !drop.has(n.name));

// Rebuild connections without any edge pointing at a dropped node.
const conns = {};
for (const [src, val] of Object.entries(wf.connections)) {
  if (drop.has(src)) continue;
  const main = (val.main || []).map((outputs) =>
    (outputs || []).filter((c) => !drop.has(c.node))
  );
  conns[src] = { main };
}
wf.connections = conns;

fs.writeFileSync(path.join(ROOT, 'workflow.validate.json'), JSON.stringify(wf, null, 2) + '\n');
console.log('Wrote workflow.validate.json with', wf.nodes.length, 'nodes (Gmail removed).');
