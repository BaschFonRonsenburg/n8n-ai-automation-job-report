/**
 * prep-summaries.js — body of the n8n Code node "Prep Summaries".
 * Mode: "Run Once for All Items".
 *
 * Collapses the N job items from "Compile Jobs" into ONE item so the Gemini HTTP
 * node fires a SINGLE batched call (cost stays flat regardless of job count). The
 * output item carries:
 *   - jobs:       the full job rows, untouched, for "Apply Summaries" to re-expand.
 *   - geminiBody: the exact JSON request body for Gemini's generateContent endpoint,
 *                 asking for a one-sentence summary per role as a strict JSON array.
 */

const items = $input.all().map((i) => i.json);

// Compact payload for the model — index + the minimum it needs to summarize.
const jobsForLlm = items.map((j, idx) => ({
  i: idx,
  title: j.title || '',
  company: j.company || '',
  job_type: j.job_type || '',
  location: j.location || '',
  desc: String(j.description || '').slice(0, 500),
}));

const instruction =
  'You are a job-market analyst. For EACH job object below, write ONE concise, ' +
  'factual sentence (max 22 words) that says what the role involves and, if clear, ' +
  'what the employer does. No hype, no "exciting opportunity". ' +
  'Return ONLY a JSON array like [{"i":0,"summary":"..."}] — one object per job, ' +
  'matching the "i" index. No markdown, no code fences.\n\nJobs:\n' +
  JSON.stringify(jobsForLlm);

const geminiBody = {
  contents: [{ parts: [{ text: instruction }] }],
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
  },
};

return [{ json: { jobs: items, count: items.length, geminiBody } }];
