/**
 * validate-node-schemas.js — validates workflow.json against the REAL node schemas
 * from an installed n8n-nodes-base, without needing the (broken on this box) n8n server.
 *
 * For every node in workflow.json it loads the node class from n8n-nodes-base, collects
 * the typeVersions that class actually supports, and asserts the workflow's typeVersion is
 * one of them. Also spot-checks a couple of parameter names for the versions we use.
 *
 * Usage: node scripts/validate-node-schemas.js "<path to n8n-nodes-base>"
 */
const path = require('path');
const fs = require('fs');

const NB = process.argv[2];
if (!NB) { console.error('Pass the path to node_modules/n8n-nodes-base'); process.exit(2); }

const known = require(path.join(NB, 'dist', 'known', 'nodes.json'));
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflow.json'), 'utf8'));

/** Supported typeVersions for a node class (handles versioned + plain nodes). */
function supportedVersions(instance) {
  // VersionedNodeType exposes nodeVersions {1: inst, 2: inst, ...}
  if (instance.nodeVersions && typeof instance.nodeVersions === 'object') {
    return Object.keys(instance.nodeVersions).map(Number).sort((a, b) => a - b);
  }
  const v = instance.description && instance.description.version;
  if (Array.isArray(v)) return v.slice().sort((a, b) => a - b);
  if (typeof v === 'number') return [v];
  return [];
}

/** Get the description object for a specific typeVersion. */
function descFor(instance, version) {
  if (instance.nodeVersions && instance.nodeVersions[version]) {
    return instance.nodeVersions[version].description;
  }
  return instance.description;
}

function paramNames(desc) {
  return (desc && Array.isArray(desc.properties) ? desc.properties : []).map((p) => p.name);
}

let failures = 0;
for (const node of wf.nodes) {
  const shortType = node.type.replace('n8n-nodes-base.', '');
  const entry = known[shortType];
  if (!entry) { console.log(`✗ ${node.name}: unknown node type ${node.type}`); failures++; continue; }

  let instance;
  try {
    const mod = require(path.join(NB, entry.sourcePath));
    const Cls = mod[entry.className];
    instance = new Cls();
  } catch (e) {
    console.log(`✗ ${node.name} (${shortType}): failed to load class — ${e.message}`);
    failures++;
    continue;
  }

  const versions = supportedVersions(instance);
  const ok = versions.includes(node.typeVersion);
  const desc = descFor(instance, node.typeVersion);
  const params = paramNames(desc);
  console.log(`${ok ? '✓' : '✗'} ${node.name} (${shortType}) typeVersion ${node.typeVersion} — supported: [${versions.join(', ')}]`);
  if (!ok) failures++;

  // Spot-check that top-level parameter keys we set exist in the schema (loose check;
  // nested collections like queryParameters/options are containers so we only check roots).
  const used = Object.keys(node.parameters || {});
  const missing = used.filter((k) => params.length && !params.includes(k));
  if (missing.length) console.log(`    · params not in schema root (may be version-gated/nested): ${missing.join(', ')}`);
}

console.log(failures === 0
  ? '\nAll node typeVersions are valid against n8n-nodes-base.'
  : `\n${failures} node(s) FAILED validation.`);
process.exit(failures === 0 ? 0 : 1);
