/**
 * normalize-core.js — pure transform logic for the weekly job report.
 *
 * SINGLE SOURCE OF TRUTH for the mapping/filter/dedupe/sort/scoring. It is:
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

// Publishers/boards we treat as reputable for the trust score (matched case-insensitively
// against the row's `source`, which for JSearch is the originating publisher).
const REPUTABLE_BOARDS = [
  'linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'wellfound', 'we work remotely',
  'remotive', 'jobicy', 'dice', 'builtin', 'stack overflow', 'weworkremotely', 'greenhouse',
  'lever', 'workday',
];

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

/** Strip HTML tags + decode the handful of entities the sources actually emit, collapse space. */
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clip to n chars on a word boundary with an ellipsis. */
function clip(s, n) {
  const str = String(s || '');
  if (str.length <= n) return str;
  return str.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

/** Normalize a company name for cross-source matching ("Acme, Inc." ~ "Acme LLC"). */
function normCompany(c) {
  return String(c || '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|llc|ltd|gmbh|co|corp|limited|company)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstAllowedType(types, allowed) {
  for (const t of types) {
    if (allowed.includes(normJobType(t))) return normJobType(t);
  }
  return '';
}

// ---- Per-source mappers to the common schema -----------------------------
// Common row: { source, title, company, job_type, location, salary, url,
//               posted_date (ISO string|''), tags (string), description,
//               company_website, company_logo, trust_score, trust_band, trust_reasons }

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
      _desc: stripHtml(j.description),
      _website: '',
      _logo: j.company_logo || '',
      _direct: false,
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
      _desc: stripHtml(j.jobDescription || j.jobExcerpt),
      _website: j.url && j.companyName ? '' : '',
      _logo: j.companyLogo || '',
      _direct: false,
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
      _desc: stripHtml(j.job_description),
      // Trust signals JSearch uniquely exposes about the employer.
      _website: j.employer_website || '',
      _logo: j.employer_logo || '',
      _direct: j.job_apply_is_direct === true,
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
 * Legitimacy / Trust score (0–100) from signals we actually have — NOT a real
 * employer rating (no free source provides those). Transparent: every point is
 * tied to a reason string. Fair across sources — the website/logo/direct-apply
 * bonuses only JSearch exposes are additive, never penalties, so Remotive/Jobicy
 * rows still reach a high score via salary + recency + multi-board presence.
 */
function computeTrust(row, sourceCount) {
  let score = 40; // baseline: it's on a curated aggregator at all
  const reasons = [];

  if (row.salary && String(row.salary).trim()) {
    score += 20;
    reasons.push('salary disclosed');
  }
  if (sourceCount >= 2) {
    score += 15;
    reasons.push(`cross-posted on ${sourceCount} boards`);
  }
  const days = row._date ? Math.floor((Date.now() - row._date.getTime()) / 86400000) : null;
  if (days !== null) {
    if (days <= 7) { score += 12; reasons.push('posted this week'); }
    else if (days <= 14) { score += 8; reasons.push('posted recently'); }
    else if (days <= 30) { score += 4; }
  }
  if (row._website) { score += 8; reasons.push('verified company website'); }
  if (row._logo) { score += 3; }
  if (row._direct) { score += 7; reasons.push('direct application'); }
  if (REPUTABLE_BOARDS.some((p) => String(row.source).toLowerCase().includes(p))) {
    score += 8;
    reasons.push('reputable job board');
  }

  score = Math.max(0, Math.min(100, score));
  const band = score >= 80 ? 'High' : score >= 60 ? 'Good' : 'Basic';
  return { score, band, reasons };
}

/**
 * Combine mapped rows from all sources, apply keyword + type + age filters,
 * dedupe, score, sort, and finalize the public shape.
 */
function buildRows(mappedBySource, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const cutoff = cfg.maxAgeDays
    ? Date.now() - cfg.maxAgeDays * 24 * 60 * 60 * 1000
    : null;

  const all = [].concat(...Object.values(mappedBySource));

  // How many distinct sources/publishers each company appears on (computed BEFORE dedupe,
  // since dedupe collapses the cross-posts we want to count). Feeds the trust score.
  const companySources = new Map();
  for (const row of all) {
    const key = normCompany(row.company);
    if (!key) continue;
    if (!companySources.has(key)) companySources.set(key, new Set());
    companySources.get(key).add(String(row.source).toLowerCase());
  }

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

    const sourceCount = (companySources.get(normCompany(row.company)) || new Set()).size || 1;
    const trust = computeTrust(row, sourceCount);

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
      // Retained for descriptions + the LLM summary; raw fallback text if the LLM is skipped.
      description: clip(row._desc || '', 400),
      // A neutral one-liner derived from the fields we have; the LLM node overwrites this when present.
      summary: '',
      company_website: row._website || '',
      company_logo: row._logo || '',
      // Trust / legitimacy scoring (see computeTrust).
      trust_score: trust.score,
      trust_band: trust.band,
      trust_reasons: trust.reasons.join('; '),
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
  stripHtml,
  clip,
  normCompany,
  fromRemotive,
  fromJobicy,
  fromJSearch,
  matchesKeyword,
  computeTrust,
  buildRows,
};
