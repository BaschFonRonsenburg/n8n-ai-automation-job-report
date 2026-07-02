/**
 * mcp-call.js — tiny client for n8n's native MCP server (streamable HTTP, stateless).
 * Reads endpoint + token from env so no secret is stored here:
 *   N8N_MCP_URL    e.g. https://xxx.app.n8n.cloud/mcp-server/http
 *   N8N_MCP_TOKEN  the bearer token
 *
 * Usage:
 *   node scripts/mcp-call.js :list                 # tools/list
 *   node scripts/mcp-call.js <toolName> '<jsonArgs>'   # tools/call
 *   echo '<jsonArgs>' | node scripts/mcp-call.js <toolName> -   # args from stdin
 */
const URL = process.env.N8N_MCP_URL;
const TOKEN = process.env.N8N_MCP_TOKEN;
if (!URL || !TOKEN) { console.error('Set N8N_MCP_URL and N8N_MCP_TOKEN'); process.exit(2); }

function parseSSE(text) {
  // Collect JSON from `data:` lines and return the last/only JSON-RPC object.
  const datas = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  const objs = [];
  for (const d of datas) { try { objs.push(JSON.parse(d)); } catch (_) {} }
  return objs.length ? objs[objs.length - 1] : null;
}

async function rpc(method, params, id) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: id || 1, method, params: params || {} }),
  });
  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  const obj = ct.includes('text/event-stream') ? parseSSE(text) : (() => { try { return JSON.parse(text); } catch { return null; } })();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  if (!obj) throw new Error(`No JSON in response: ${text.slice(0, 400)}`);
  if (obj.error) throw new Error(`RPC error ${obj.error.code}: ${obj.error.message}`);
  return obj.result;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

(async () => {
  const arg = process.argv[2];
  if (arg === ':list') {
    const r = await rpc('tools/list', {}, 1);
    console.log((r.tools || []).map((t) => `${t.name}: ${t.description ? t.description.split('\n')[0] : ''}`).join('\n'));
    return;
  }
  let rawArgs = process.argv[3] || '{}';
  if (rawArgs === '-') rawArgs = await readStdin();
  const toolArgs = JSON.parse(rawArgs || '{}');
  const r = await rpc('tools/call', { name: arg, arguments: toolArgs }, 2);
  // MCP tool results carry content[]; print text parts, else raw JSON.
  if (r && Array.isArray(r.content)) {
    for (const c of r.content) console.log(c.type === 'text' ? c.text : JSON.stringify(c));
    if (r.isError) process.exitCode = 1;
  } else {
    console.log(JSON.stringify(r, null, 2));
  }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
