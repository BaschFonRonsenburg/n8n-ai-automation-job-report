/**
 * apply-summaries.js — body of the n8n Code node "Apply Summaries".
 * Mode: "Run Once for All Items".
 *
 * Re-expands the single batched item back to one item per job, attaching the
 * one-line `summary` from Gemini. If Gemini failed, errored, or returned
 * unparseable output, each job falls back to the first sentence of its own
 * description — so the report NEVER breaks on an LLM hiccup.
 *
 * Reads "Prep Summaries" (the retained job rows) and "Gemini" (the raw response).
 */

const jobs = (() => {
  try { return $('Prep Summaries').first().json.jobs || []; } catch (e) { return []; }
})();

// Parse Gemini's JSON array of { i, summary } into an index -> summary map. Any
// failure (node errored, empty body, non-JSON, wrapped in ```json fences) => {}.
function parseSummaries() {
  const map = {};
  try {
    const resp = $('Gemini').first().json || {};
    let text =
      (resp.candidates &&
        resp.candidates[0] &&
        resp.candidates[0].content &&
        resp.candidates[0].content.parts &&
        resp.candidates[0].content.parts[0] &&
        resp.candidates[0].content.parts[0].text) || '';
    text = String(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) {
      for (const o of arr) {
        if (o && typeof o.i === 'number') map[o.i] = String(o.summary || '').trim();
      }
    }
  } catch (e) {
    // leave map empty -> everything falls back to the description snippet
  }
  return map;
}

/** First sentence of the description, else a trimmed slice, as the no-LLM fallback. */
function firstSentence(desc) {
  const d = String(desc || '').trim();
  if (!d) return '';
  const m = d.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : d).trim().slice(0, 200);
}

const summaries = parseSummaries();

return jobs.map((j, idx) => {
  const s = summaries[idx];
  const summary = (s && s.length ? s : firstSentence(j.description)).slice(0, 200);
  return { json: Object.assign({}, j, { summary }) };
});
