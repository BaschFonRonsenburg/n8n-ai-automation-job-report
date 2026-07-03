// Inline every external image (chart + logos) into email-preview.html so it can be
// previewed in a strict-CSP context (Artifact). Writes email-preview.inline.html.
const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '..', '.tmp');
let html = fs.readFileSync(path.join(dir, 'email-preview.html'), 'utf8');
const urls = [...new Set([...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(u => /^https?:/.test(u)))];
(async () => {
  for (const u of urls) {
    try {
      const fetchUrl = u.replace(/&amp;/g, '&'); // decode HTML-escaped attribute for the real request
      const r = await fetch(fetchUrl, { headers: { 'User-Agent': 'preview' } });
      if (!r.ok) { console.log('skip', r.status, u.slice(0,60)); continue; }
      const ct = r.headers.get('content-type') || 'image/png';
      const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
      html = html.split(u).join(`data:${ct};base64,${b64}`);
      console.log('inlined', ct, Math.round(b64.length/1024)+'KB', u.slice(0,50));
    } catch (e) { console.log('err', u.slice(0,60), e.message); }
  }
  fs.writeFileSync(path.join(dir, 'email-preview.inline.html'), html);
  console.log('wrote email-preview.inline.html', html.length, 'bytes');
})();
