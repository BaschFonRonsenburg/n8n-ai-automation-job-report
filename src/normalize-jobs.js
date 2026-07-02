/**
 * normalize-jobs.js — body of the n8n Code node "Compile Jobs".
 * Mode: "Run Once for All Items".
 *
 * n8n Code nodes cannot require() local files, so the pure transform below is
 * INLINED from src/normalize-core.js — keep the two in sync. The only n8n-specific
 * parts are the input readers (readApiArray / readConfig) and the return shape at
 * the bottom.
 *
 * Reads the upstream nodes: "Config" (Set), "Remotive" (HTTP), "Jobicy" (HTTP).
 * Returns one n8n item per matched job, or a single { empty: true } item when
 * nothing matched (so the "no results" email branch still fires — a node that
 * outputs zero items would stop the workflow before the email is sent).
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

function matchesKeyword(row, keywords) {
  const hay = String(row._hay || `${row.title} ${row.tags}`).toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

function buildRows(mappedBySource, config) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
  const cutoff = cfg.maxAgeDays
    ? Date.now() - cfg.maxAgeDays * 24 * 60 * 60 * 1000
    : null;
  const all = [].concat.apply([], Object.keys(mappedBySource).map((k) => mappedBySource[k]));
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
