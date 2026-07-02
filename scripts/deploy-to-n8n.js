/**
 * deploy-to-n8n.js — create (and optionally activate) the workflow on an n8n instance
 * via the public REST API. No secrets are stored in this file; it reads them from env:
 *
 *   N8N_BASE_URL   e.g. https://your-name.app.n8n.cloud   (no trailing slash)
 *   N8N_API_KEY    an API key from n8n → Settings → n8n API → Create API Key
 *   N8N_ACTIVATE   optional "true" to activate after create (leave unset until the
 *                  Gmail credential is attached, or the first scheduled run will error)
 *
 * Usage (PowerShell):
 *   $env:N8N_BASE_URL="https://xxx.app.n8n.cloud"; $env:N8N_API_KEY="..."; node scripts/deploy-to-n8n.js
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY || '';
if (!BASE || !KEY) {
  console.error('Set N8N_BASE_URL and N8N_API_KEY in the environment first.');
  process.exit(2);
}

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflow.json'), 'utf8'));
// The public API accepts only these top-level fields on create.
const payload = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || { executionOrder: 'v1' },
};

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE}/api/v1${urlPath}`, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = text; }
  if (!res.ok) throw new Error(`${method} ${urlPath} -> HTTP ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

(async () => {
  console.log(`Deploying "${payload.name}" to ${BASE} ...`);
  const created = await api('POST', '/workflows', payload);
  const id = created.id || (created.data && created.data.id);
  console.log(`✓ Created workflow id=${id}`);
  console.log(`  Editor: ${BASE}/workflow/${id}`);

  if ((process.env.N8N_ACTIVATE || '').toLowerCase() === 'true') {
    await api('POST', `/workflows/${id}/activate`);
    console.log('✓ Activated (weekly schedule live).');
  } else {
    console.log('• Left INACTIVE. Attach the Gmail credential to both Gmail nodes, then');
    console.log('  activate in the UI (or re-run with N8N_ACTIVATE=true).');
  }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
