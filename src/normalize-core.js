/**
 * normalize-core.js — pure transform logic for the weekly job report.
 *
 * SINGLE SOURCE OF TRUTH for the mapping/filter/dedupe/sort. It is:
 *   - required by src/test-normalize.js for the offline live-API test, and
 *   - copied verbatim (functions only) into the n8n Code node body,
 *     src/normalize-jobs.js, which adds the thin n8n glue at the bottom.
 * Keep the two in sync. No n8n globals ($input/$json/etc.) appear here so it
 * runs under plain Node.js.
 */

const DEFAULT_CONFIG = {
  // A row is kept only if it has one of these employment types.
  allowedTypes: ['part_time', 'contract', 'freelance'],
  // Drop anything older than this many days (unparseable dates are kept).
  maxAgeDays: 30,
  // Quality gate: keep a row only if its haystack (title + tags + category +
  // description) mentions an automation/AI keyword. The gate matches the DESCRIPTION,
  // not just the title, so automation roles whose title is generic ("Data Analyst")
  // are still kept while off-topic noise ("Head of Sales", "Freelance Writer") is dropped.
  requireKeyword: true,
  keywords: [
    'automation', 'automate', 'rpa', 'zapier', 'n8n', 'make.com', 'workflow',
    'integration', 'no-code', 'low-code', 'ai agent', 'artificial intelligence',
    'machine learning', 'data annotation', 'data label',
    'process automation', 'workflow automation', 'ai automation', 'agentic',
    'chatbot', 'power automate', 'uipath',
  ],
  // Noise filter: drop a row whose TITLE reads as a clearly-non-automation role
  // (sales/writing/recruiting), UNLESS the title also carries an automation keyword
  // (so "Sales Automation Engineer" survives but "Head of Sales" is dropped). This
  // catches roles that only matched because the description happened to mention automation.
  excludeTitleKeywords: [
    'sales', 'account executive', 'account manager', 'business development',
    'recruit', 'copywriter', 'content writer', 'sdr', 'bdr',
  ],
  // HARD block: clerical roles that sometimes carry "automation" / "office automation" in the
  // title but are never AI-automation roles. Dropped even when the title mentions a keyword
  // (i.e. this overrides the on-topic guard that protects e.g. "Sales Automation Engineer").
  blockTitleKeywords: [
    'secretary', 'receptionist', 'data entry', 'administrative assistant', 'office administrator',
    'virtual assistant', 'appointment setter', 'telemarketer', 'call center', 'cold caller',
    'customer service representative',
  ],
};

/** Canonicalize an employment-type label: "Part-Time" -> "part_time". */
function normJobType(raw) {
  if (!raw) return '';
  return String(raw)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_'); // spaces & hyphens -> underscore
}

/** Best-effort parse to a JS Date; returns null when unknown. */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  // Unix seconds (Arbeitnow created_at) arrive as number or numeric string.
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const secs = Number(value);
    const ms = secs > 1e12 ? secs : secs * 1000; // tolerate ms or s
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function firstAllowedType(types, allowed) {
  for (const t of types) {
    if (allowed.includes(normJobType(t))) return normJobType(t);
  }
  return '';
}

// ---- Per-source mappers to the common schema -----------------------------
// Common row: { source, title, company, job_type, location, salary, url,
//               posted_date (ISO string|''), tags (string) }

function fromRemotive(jobs) {
  return (jobs || []).map((j) => {
    const tags = Array.isArray(j.tags) ? j.tags.join(', ') : '';
    return {
      source: 'Remotive',
      title: j.title || '',
      company: j.company_name || '',
      _types: [j.job_type],
      location: j.candidate_required_location || 'Remote',
      salary: j.salary || '',
      url: j.url || '',
      _date: toDate(j.publication_date),
      tags,
      _hay: `${j.title || ''} ${tags} ${j.category || ''} ${j.description || ''}`,
    };
  });
}

function fromJobicy(jobs) {
  return (jobs || []).map((j) => {
    let salary = '';
    if (j.salaryMin || j.salaryMax) {
      const cur = j.salaryCurrency || '';
      salary = `${cur} ${j.salaryMin || '?'}–${j.salaryMax || '?'}`.trim();
    }
    const tags = Array.isArray(j.jobIndustry) ? j.jobIndustry.join(', ') : '';
    return {
      source: 'Jobicy',
      title: j.jobTitle || '',
      company: j.companyName || '',
      _types: Array.isArray(j.jobType) ? j.jobType : [j.jobType],
      location: j.jobGeo || 'Remote',
      salary,
      url: j.url || '',
      _date: toDate(j.pubDate),
      tags,
      _hay: `${j.jobTitle || ''} ${tags} ${j.jobExcerpt || ''} ${j.jobDescription || ''}`,
    };
  });
}

// JSearch (RapidAPI, aggregates Indeed/Glassdoor/LinkedIn/etc via Google for Jobs).
// Employment types come from the PLURAL `job_employment_types` array, whose tokens are
// UPPERCASE with no separators (FULLTIME/PARTTIME/CONTRACTOR/INTERN) and may list several
// (e.g. ["FULLTIME","PARTTIME"]). We map that array — the singular `job_employment_type`
// field is now a display string ("Part-time", "Full-time and Part-time") and unreliable to parse.
const JSEARCH_TYPE = { FULLTIME: 'full_time', PARTTIME: 'part_time', CONTRACTOR: 'contract', INTERN: 'intern' };

function fromJSearch(jobs) {
  return (jobs || []).map((j) => {
    let salary = '';
    if (j.job_min_salary || j.job_max_salary) {
      const cur = j.job_salary_currency || '';
      const per = j.job_salary_period ? '/' + String(j.job_salary_period).toLowerCase() : '';
      salary = `${cur} ${j.job_min_salary || '?'}–${j.job_max_salary || '?'}${per}`.trim();
    }
    const loc = j.job_is_remote ? 'Remote'
      : [j.job_city, j.job_country].filter(Boolean).join(', ') || 'Remote';
    return {
      source: j.job_publisher || 'JSearch',
      title: j.job_title || '',
      company: j.employer_name || '',
      _types: (Array.isArray(j.job_employment_types) && j.job_employment_types.length
        ? j.job_employment_types
        : [j.job_employment_type]).map((t) => JSEARCH_TYPE[t] || t),
      location: loc,
      salary,
      url: j.job_apply_link || '',
      _date: toDate(j.job_posted_at_datetime_utc),
      tags: j.job_publisher || '',
      _hay: `${j.job_title || ''} ${j.job_publisher || ''} ${j.job_description || ''}`,
    };
  });
}

/** Keyword gate: does the row's haystack mention any configured keyword? */
function matchesKeyword(row, keywords) {
  const hay = String(row._hay || `${row.title} ${row.tags}`).toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

/**
 * Combine mapped rows from all sources, apply keyword + type + age filters,
 * dedupe, sort newest-first, and finalize the public shape.
 */
function buildRows(mappedBySource, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const cutoff = cfg.maxAgeDays
    ? Date.now() - cfg.maxAgeDays * 24 * 60 * 60 * 1000
    : null;

  const all = [].concat(...Object.values(mappedBySource));
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];

  for (const row of all) {
    // type gate (a row may carry several types; keep if any is allowed)
    const jobType = firstAllowedType(row._types || [], cfg.allowedTypes);
    if (!jobType) continue;

    // keyword gate — matches against the description-level haystack for inclusion
    if (cfg.requireKeyword && !matchesKeyword(row, cfg.keywords)) continue;

    // noise gate — drop obvious non-automation titles unless the title itself is on-topic
    const titleLc = (row.title || '').toLowerCase();
    // hard block runs first: clerical titles are dropped even if they mention a keyword
    if ((cfg.blockTitleKeywords || []).some((k) => titleLc.includes(k))) continue;
    const titleExcluded = (cfg.excludeTitleKeywords || []).some((k) => titleLc.includes(k));
    const titleOnTopic = cfg.keywords.some((k) => titleLc.includes(k.toLowerCase()));
    if (titleExcluded && !titleOnTopic) continue;

    // age gate (keep rows with an unknown date)
    if (cutoff && row._date && row._date.getTime() < cutoff) continue;

    // dedupe: same URL, OR same title. JSearch cross-posts one role to LinkedIn/Workday/Indeed
    // with different URLs AND different employer strings ("Penn State University" vs "The
    // Pennsylvania State University"), so we collapse on the normalized title. Trade-off: two
    // genuinely different roles with an identical title collapse to one (rare for specific titles).
    const urlKey = (row.url || '').toLowerCase().trim();
    const titleKey = (row.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if ((urlKey && seenUrl.has(urlKey)) || (titleKey && seenTitle.has(titleKey))) continue;
    if (urlKey) seenUrl.add(urlKey);
    if (titleKey) seenTitle.add(titleKey);

    out.push({
      source: row.source,
      title: row.title,
      company: row.company,
      job_type: jobType,
      location: row.location,
      salary: row.salary,
      posted_date: row._date ? row._date.toISOString().slice(0, 10) : '',
      url: row.url,
      tags: row.tags,
      _ts: row._date ? row._date.getTime() : 0,
    });
  }

  out.sort((a, b) => b._ts - a._ts);
  return out.map(({ _ts, ...rest }) => rest); // drop the sort helper
}

module.exports = {
  DEFAULT_CONFIG,
  normJobType,
  toDate,
  fromRemotive,
  fromJobicy,
  fromJSearch,
  matchesKeyword,
  buildRows,
};
