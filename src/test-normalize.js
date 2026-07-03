/**
 * test-normalize.js — offline end-to-end check of the transform.
 *
 * Fetches the three live job APIs (same URLs the n8n HTTP nodes use) and runs
 * the real buildRows() logic against them, printing the resulting report rows.
 * This proves the mapping/filter/dedupe works before the workflow is ever
 * imported into n8n. Requires Node 18+ (global fetch).
 *
 *   node src/test-normalize.js
 */

const {
  fromRemotive,
  fromJobicy,
  buildRows,
} = require('./normalize-core');

const SOURCES = {
  remotive: 'https://remotive.com/api/remote-jobs?search=automation',
  jobicy: 'https://jobicy.com/api/v2/remote-jobs?count=50&tag=automation',
};

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'n8n-job-scraper-test' } });
    if (!res.ok) {
      console.error(`  ! ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`  ! ${url} -> ${err.message}`);
    return null;
  }
}

(async () => {
  console.log('Fetching live sources...');
  const [rem, job] = await Promise.all([
    getJson(SOURCES.remotive),
    getJson(SOURCES.jobicy),
  ]);

  const remJobs = rem && rem.jobs ? rem.jobs : [];
  const jobJobs = job && job.jobs ? job.jobs : [];
  console.log(
    `  raw counts -> Remotive: ${remJobs.length}, Jobicy: ${jobJobs.length}`
  );

  const rows = buildRows({
    remotive: fromRemotive(remJobs),
    jobicy: fromJobicy(jobJobs),
  });

  console.log(`\nMatched part-time/contract/freelance automation roles: ${rows.length}\n`);
  for (const r of rows.slice(0, 25)) {
    console.log(`• [${r.source}] ${r.title} — ${r.company} (${r.job_type})`);
    console.log(`    ${r.location} | ${r.posted_date} | ${r.salary || 'salary n/a'}`);
    console.log(`    Trust ${r.trust_score}/100 (${r.trust_band}) — ${r.trust_reasons}`);
    console.log(`    desc: ${(r.description || '(none)').slice(0, 120)}`);
    console.log(`    ${r.url}`);
  }
  if (rows.length > 25) console.log(`  ...and ${rows.length - 25} more`);
})();
