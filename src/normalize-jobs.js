/**
 * normalize-jobs.js — body of the n8n Code node "Compile Jobs".
 * Mode: "Run Once for All Items".
 *
 * n8n Code nodes cannot require() local files, so the pure transform below is
 * INLINED from src/normalize-core.js — keep the two in sync. The only n8n-specific
 * parts are the input readers (readApiArray / readConfig) and the return shape at
 * the bottom.
 *
 * Reads the upstream nodes: "Config" (Set), "Remotive" (HTTP), "Jobicy" (HTTP),
 * "JSearch" (HTTP). Returns one n8n item per matched job (now carrying a cleaned
 * `description`, an empty `summary` for the LLM node to fill, and a `trust_score`),
 * or a single { empty: true } item when nothing matched (so the "no results" email
 * branch still fires — a node that outputs zero items would stop the workflow).
 */

// ===== BEGIN inlined core (mirror of src/normalize-core.js) =================
const DEFAULT_CONFIG = {
  allowedTypes: ['part_time', 'contract', 'freelance'],
  maxAgeDays: 30,
  requireKeyword: true,
  keywords: [
    'automation', 'automate', 'rpa', 'zapier', 'n8n', 'make.com', 'workflow',
    'integration', 'no-code', 'low-code', 'ai agent', 'artificial intelligence',
    'machine learning', 'data annotation', 'data label',
    'process automation', 'workflow automation', 'ai automation', 'agentic',
    'chatbot', 'power automate', 'uipath',
  ],
  excludeTitleKeywords: [
    'sales', 'account executive', 'account manager', 'business development',
    'recruit', 'copywriter', 'content writer', 'sdr', 'bdr',
  ],
  // HARD block: clerical roles that sometimes carry "automation" in the title but are never
  // AI-automation roles. Dropped even when the title mentions a keyword.
  blockTitleKeywords: [
    'secretary', 'receptionist', 'data entry', 'administrative assistant', 'office administrator',
    'virtual assistant', 'appointment setter', 'telemarketer', 'call center', 'cold caller',
    'customer service representative',
  ],
};

const REPUTABLE_BOARDS = [
  'linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'wellfound', 'we work remotely',
  'remotive', 'jobicy', 'dice', 'builtin', 'stack overflow', 'weworkremotely', 'greenhouse',
  'lever', 'workday',
];

function normJobType(raw) {
  if (!raw) return '';
  return String(raw).toLowerCase().trim().replace(/[\s-]+/g, '_');
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const secs = Number(value);
    const ms = secs > 1e12 ? secs : secs * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

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

function clip(s, n) {
  const str = String(s || '');
  if (str.length <= n) return str;
  return str.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

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
      _website: '',
      _logo: j.companyLogo || '',
      _direct: false,
      _hay: `${j.jobTitle || ''} ${tags} ${j.jobExcerpt || ''} ${j.jobDescription || ''}`,
    };
  });
}

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
      _website: j.employer_website || '',
      _logo: j.employer_logo || '',
      _direct: j.job_apply_is_direct === true,
      _hay: `${j.job_title || ''} ${j.job_publisher || ''} ${j.job_description || ''}`,
    };
  });
}

function matchesKeyword(row, keywords) {
  const hay = String(row._hay || `${row.title} ${row.tags}`).toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

function computeTrust(row, sourceCount) {
  let score = 40;
  const reasons = [];
  if (row.salary && String(row.salary).trim()) { score += 20; reasons.push('salary disclosed'); }
  if (sourceCount >= 2) { score += 15; reasons.push(`cross-posted on ${sourceCount} boards`); }
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
    score += 8; reasons.push('reputable job board');
  }
  score = Math.max(0, Math.min(100, score));
  const band = score >= 80 ? 'High' : score >= 60 ? 'Good' : 'Basic';
  return { score, band, reasons };
}

function buildRows(mappedBySource, config) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
  const cutoff = cfg.maxAgeDays
    ? Date.now() - cfg.maxAgeDays * 24 * 60 * 60 * 1000
    : null;
  const all = [].concat.apply([], Object.keys(mappedBySource).map((k) => mappedBySource[k]));

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
    const jobType = firstAllowedType(row._types || [], cfg.allowedTypes);
    if (!jobType) continue;
    if (cfg.requireKeyword && !matchesKeyword(row, cfg.keywords)) continue;
    const titleLc = (row.title || '').toLowerCase();
    if ((cfg.blockTitleKeywords || []).some((k) => titleLc.includes(k))) continue;
    const titleExcluded = (cfg.excludeTitleKeywords || []).some((k) => titleLc.includes(k));
    const titleOnTopic = cfg.keywords.some((k) => titleLc.includes(k.toLowerCase()));
    if (titleExcluded && !titleOnTopic) continue;
    if (cutoff && row._date && row._date.getTime() < cutoff) continue;
    // dedupe by URL OR normalized title (JSearch cross-posts one role to several boards with
    // different URLs and different employer strings, so collapse on title).
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
      description: clip(row._desc || '', 400),
      summary: '',
      company_website: row._website || '',
      company_logo: row._logo || '',
      trust_score: trust.score,
      trust_band: trust.band,
      trust_reasons: trust.reasons.join('; '),
      _ts: row._date ? row._date.getTime() : 0,
    });
  }
  out.sort((a, b) => b._ts - a._ts);
  return out.map((r) => { const c = Object.assign({}, r); delete c._ts; return c; });
}
// ===== END inlined core ====================================================

// ----- n8n glue ------------------------------------------------------------

/** Pull the array at `key` from an HTTP node's JSON body; [] if node failed/missing. */
function readApiArray(nodeName, key) {
  try {
    const items = $(nodeName).all();
    if (!items.length) return [];
    const body = items[0].json || {};
    return Array.isArray(body[key]) ? body[key] : [];
  } catch (e) {
    return [];
  }
}

/**
 * JSearch's jobs array. /search-v2 nests them at `data.jobs` (data is an object);
 * the legacy /search returned `data` as the array directly. Handle both. [] on failure.
 */
function readJSearchJobs() {
  try {
    const items = $('JSearch').all();
    if (!items.length) return [];
    const body = items[0].json || {};
    const d = body.data;
    if (Array.isArray(d)) return d;                 // legacy /search
    if (d && Array.isArray(d.jobs)) return d.jobs;  // /search-v2
    return [];
  } catch (e) {
    return [];
  }
}

/** Read overrides from the "Config" Set node; falls back to code defaults. */
function readConfig() {
  let raw = {};
  try { raw = $('Config').first().json || {}; } catch (e) { raw = {}; }
  const cfg = {};
  if (raw.maxAgeDays !== undefined && raw.maxAgeDays !== '') cfg.maxAgeDays = Number(raw.maxAgeDays);
  if (raw.allowedTypes) cfg.allowedTypes = String(raw.allowedTypes).split(',').map((s) => s.trim()).filter(Boolean);
  if (raw.requireKeyword !== undefined) cfg.requireKeyword = raw.requireKeyword === true || raw.requireKeyword === 'true';
  return cfg;
}

const remotiveJobs = readApiArray('Remotive', 'jobs');
const jobicyJobs = readApiArray('Jobicy', 'jobs');
const jsearchJobs = readJSearchJobs(); // [] when the node/credential is absent

const rows = buildRows(
  {
    remotive: fromRemotive(remotiveJobs),
    jobicy: fromJobicy(jobicyJobs),
    jsearch: fromJSearch(jsearchJobs),
  },
  readConfig(),
);

if (rows.length === 0) {
  return [{ json: { empty: true, count: 0 } }];
}
return rows.map((r) => ({ json: r }));
