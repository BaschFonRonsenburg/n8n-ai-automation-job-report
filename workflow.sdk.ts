import { workflow, node, trigger, ifElse, newCredential, expr } from '@n8n/workflow-sdk';

const gmailCred = newCredential('Gmail Account');

const scheduleWeekly = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  output: [{}],
  config: {
    name: 'Weekly Monday 07:07',
    parameters: {
      rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 7, triggerAtMinute: 7 }] },
    },
  },
});

const configNode = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  output: [{ searchTerm: 'automation', maxAgeDays: 30, allowedTypes: 'part_time,contract,freelance', requireKeyword: true, recipient: 'you@example.com' }],
  config: {
    name: 'Config',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'a1', name: 'searchTerm', value: 'automation', type: 'string' },
        { id: 'a2', name: 'maxAgeDays', value: 30, type: 'number' },
        { id: 'a3', name: 'allowedTypes', value: 'part_time,contract,freelance', type: 'string' },
        { id: 'a4', name: 'requireKeyword', value: true, type: 'boolean' },
        { id: 'a5', name: 'recipient', value: 'you@example.com', type: 'string' },
      ] },
    },
  },
});

const remotive = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  output: [{ jobs: [{ title: 'AI Automation Specialist', company_name: 'Acme', url: 'https://example.com/job', job_type: 'part_time', publication_date: '2026-07-01', candidate_required_location: 'Worldwide', salary: '', category: 'Software Development', tags: ['automation'], description: 'automation role' }] }],
  config: {
    name: 'Remotive',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: 'https://remotive.com/api/remote-jobs',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'search', value: expr('{{ $json.searchTerm }}') },
        { name: 'limit', value: '50' },
      ] },
      options: { timeout: 20000 },
    },
  },
});

const jobicy = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  output: [{ jobs: [] }],
  config: {
    name: 'Jobicy',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: 'https://jobicy.com/api/v2/remote-jobs',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'count', value: '50' },
        { name: 'tag', value: expr('{{ $json.searchTerm }}') },
      ] },
      options: { timeout: 20000 },
    },
  },
});

const compileJobs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  output: [{"source":"Remotive","title":"AI Automation Specialist","company":"Acme","job_type":"part_time","location":"Worldwide","salary":"","posted_date":"2026-07-01","url":"https://example.com/job","tags":"automation","empty":false}],
  config: {
    name: 'Compile Jobs',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "/**\n * normalize-jobs.js — body of the n8n Code node \"Compile Jobs\".\n * Mode: \"Run Once for All Items\".\n *\n * n8n Code nodes cannot require() local files, so the pure transform below is\n * INLINED from src/normalize-core.js — keep the two in sync. The only n8n-specific\n * parts are the input readers (readApiArray / readConfig) and the return shape at\n * the bottom.\n *\n * Reads the upstream nodes: \"Config\" (Set), \"Remotive\" (HTTP), \"Jobicy\" (HTTP).\n * Returns one n8n item per matched job, or a single { empty: true } item when\n * nothing matched (so the \"no results\" email branch still fires — a node that\n * outputs zero items would stop the workflow before the email is sent).\n */\n\n// ===== BEGIN inlined core (mirror of src/normalize-core.js) =================\nconst DEFAULT_CONFIG = {\n  allowedTypes: ['part_time', 'contract', 'freelance'],\n  maxAgeDays: 30,\n  requireKeyword: true,\n  keywords: [\n    'automation', 'automate', 'rpa', 'zapier', 'n8n', 'make.com', 'workflow',\n    'integration', 'no-code', 'low-code', 'ai agent', 'artificial intelligence',\n    'machine learning', 'data annotation', 'data label',\n  ],\n  excludeTitleKeywords: [\n    'sales', 'account executive', 'account manager', 'business development',\n    'recruit', 'copywriter', 'content writer', 'sdr', 'bdr',\n  ],\n};\n\nfunction normJobType(raw) {\n  if (!raw) return '';\n  return String(raw).toLowerCase().trim().replace(/[\\s-]+/g, '_');\n}\n\nfunction toDate(value) {\n  if (value === null || value === undefined || value === '') return null;\n  if (typeof value === 'number' || /^\\d+$/.test(String(value))) {\n    const secs = Number(value);\n    const ms = secs > 1e12 ? secs : secs * 1000;\n    const d = new Date(ms);\n    return isNaN(d.getTime()) ? null : d;\n  }\n  const d = new Date(value);\n  return isNaN(d.getTime()) ? null : d;\n}\n\nfunction firstAllowedType(types, allowed) {\n  for (const t of types) {\n    if (allowed.includes(normJobType(t))) return normJobType(t);\n  }\n  return '';\n}\n\nfunction fromRemotive(jobs) {\n  return (jobs || []).map((j) => {\n    const tags = Array.isArray(j.tags) ? j.tags.join(', ') : '';\n    return {\n      source: 'Remotive',\n      title: j.title || '',\n      company: j.company_name || '',\n      _types: [j.job_type],\n      location: j.candidate_required_location || 'Remote',\n      salary: j.salary || '',\n      url: j.url || '',\n      _date: toDate(j.publication_date),\n      tags,\n      _hay: `${j.title || ''} ${tags} ${j.category || ''} ${j.description || ''}`,\n    };\n  });\n}\n\nfunction fromJobicy(jobs) {\n  return (jobs || []).map((j) => {\n    let salary = '';\n    if (j.salaryMin || j.salaryMax) {\n      const cur = j.salaryCurrency || '';\n      salary = `${cur} ${j.salaryMin || '?'}–${j.salaryMax || '?'}`.trim();\n    }\n    const tags = Array.isArray(j.jobIndustry) ? j.jobIndustry.join(', ') : '';\n    return {\n      source: 'Jobicy',\n      title: j.jobTitle || '',\n      company: j.companyName || '',\n      _types: Array.isArray(j.jobType) ? j.jobType : [j.jobType],\n      location: j.jobGeo || 'Remote',\n      salary,\n      url: j.url || '',\n      _date: toDate(j.pubDate),\n      tags,\n      _hay: `${j.jobTitle || ''} ${tags} ${j.jobExcerpt || ''} ${j.jobDescription || ''}`,\n    };\n  });\n}\n\nfunction matchesKeyword(row, keywords) {\n  const hay = String(row._hay || `${row.title} ${row.tags}`).toLowerCase();\n  return keywords.some((k) => hay.includes(k.toLowerCase()));\n}\n\nfunction buildRows(mappedBySource, config) {\n  const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});\n  const cutoff = cfg.maxAgeDays\n    ? Date.now() - cfg.maxAgeDays * 24 * 60 * 60 * 1000\n    : null;\n  const all = [].concat.apply([], Object.keys(mappedBySource).map((k) => mappedBySource[k]));\n  const seen = new Set();\n  const out = [];\n  for (const row of all) {\n    const jobType = firstAllowedType(row._types || [], cfg.allowedTypes);\n    if (!jobType) continue;\n    if (cfg.requireKeyword && !matchesKeyword(row, cfg.keywords)) continue;\n    const titleLc = (row.title || '').toLowerCase();\n    const titleExcluded = (cfg.excludeTitleKeywords || []).some((k) => titleLc.includes(k));\n    const titleOnTopic = cfg.keywords.some((k) => titleLc.includes(k.toLowerCase()));\n    if (titleExcluded && !titleOnTopic) continue;\n    if (cutoff && row._date && row._date.getTime() < cutoff) continue;\n    const key = (row.url || `${row.title}|${row.company}`).toLowerCase().trim();\n    if (seen.has(key)) continue;\n    seen.add(key);\n    out.push({\n      source: row.source,\n      title: row.title,\n      company: row.company,\n      job_type: jobType,\n      location: row.location,\n      salary: row.salary,\n      posted_date: row._date ? row._date.toISOString().slice(0, 10) : '',\n      url: row.url,\n      tags: row.tags,\n      _ts: row._date ? row._date.getTime() : 0,\n    });\n  }\n  out.sort((a, b) => b._ts - a._ts);\n  return out.map((r) => { const c = Object.assign({}, r); delete c._ts; return c; });\n}\n// ===== END inlined core ====================================================\n\n// ----- n8n glue ------------------------------------------------------------\n\n/** Pull the array at `key` from an HTTP node's JSON body; [] if node failed/missing. */\nfunction readApiArray(nodeName, key) {\n  try {\n    const items = $(nodeName).all();\n    if (!items.length) return [];\n    const body = items[0].json || {};\n    return Array.isArray(body[key]) ? body[key] : [];\n  } catch (e) {\n    return [];\n  }\n}\n\n/** Read overrides from the \"Config\" Set node; falls back to code defaults. */\nfunction readConfig() {\n  let raw = {};\n  try { raw = $('Config').first().json || {}; } catch (e) { raw = {}; }\n  const cfg = {};\n  if (raw.maxAgeDays !== undefined && raw.maxAgeDays !== '') cfg.maxAgeDays = Number(raw.maxAgeDays);\n  if (raw.allowedTypes) cfg.allowedTypes = String(raw.allowedTypes).split(',').map((s) => s.trim()).filter(Boolean);\n  if (raw.requireKeyword !== undefined) cfg.requireKeyword = raw.requireKeyword === true || raw.requireKeyword === 'true';\n  return cfg;\n}\n\nconst remotiveJobs = readApiArray('Remotive', 'jobs');\nconst jobicyJobs = readApiArray('Jobicy', 'jobs');\n\nconst rows = buildRows(\n  { remotive: fromRemotive(remotiveJobs), jobicy: fromJobicy(jobicyJobs) },\n  readConfig(),\n);\n\nif (rows.length === 0) {\n  return [{ json: { empty: true, count: 0 } }];\n}\nreturn rows.map((r) => ({ json: r }));\n",
    },
  },
});

const hasResults = ifElse({
  version: 2.2,
  output: [{}],
  config: {
    name: 'Has Results?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.empty }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
    },
  },
});

const toXlsx = node({
  type: 'n8n-nodes-base.convertToFile',
  version: 1.1,
  output: [{}],
  config: {
    name: 'To XLSX',
    parameters: {
      operation: 'xlsx',
      options: { fileName: 'ai-automation-part-time-jobs.xlsx', sheetName: 'Jobs' },
    },
  },
});

const emailReport = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.1,
  output: [{}],
  config: {
    name: 'Email Report',
    credentials: { gmailOAuth2: gmailCred },
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: expr("{{ $('Config').first().json.recipient }}"),
      subject: expr("Weekly AI Automation Part-Time Jobs — {{ $now.toFormat(\"yyyy-LL-dd\") }} ({{ $('Compile Jobs').all().length }} roles)"),
      emailType: 'html',
      message: expr("<h2>Weekly AI Automation — Part-Time / Contract / Freelance</h2><p>{{ $('Compile Jobs').all().length }} matching remote role(s) this week (part-time, contract or freelance; automation / AI focus).</p><p>Full list attached as an Excel file. Top roles:</p><ul>{{ $('Compile Jobs').all().slice(0, 8).map(i => `<li><a href=\"${i.json.url}\">${i.json.title}</a> — ${i.json.company} <em>(${i.json.job_type}, ${i.json.location})</em></li>`).join(\"\") }}</ul><p style=\"color:#888;font-size:12px\">Sources: Remotive + Jobicy. Generated automatically by n8n.</p>"),
      options: { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } },
    },
  },
});

const emailNoResults = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.1,
  output: [{}],
  config: {
    name: 'Email No Results',
    credentials: { gmailOAuth2: gmailCred },
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: expr("{{ $('Config').first().json.recipient }}"),
      subject: expr("Weekly AI Automation Part-Time Jobs — {{ $now.toFormat(\"yyyy-LL-dd\") }} (no matches)"),
      emailType: 'html',
      message: expr("<h2>Weekly AI Automation — Part-Time Jobs</h2><p>No part-time / contract / freelance automation roles matched this week on Remotive or Jobicy. I'll check again next Monday.</p>"),
      options: {},
    },
  },
});

export default workflow('ai-automation-part-time-jobs', 'Weekly AI Automation Part-Time Job Report')
  .add(scheduleWeekly)
  .to(configNode)
  .add(configNode)
  .to(remotive.to(compileJobs))
  .add(configNode)
  .to(jobicy.to(compileJobs))
  .add(compileJobs)
  .to(hasResults
    .onTrue(emailNoResults)
    .onFalse(toXlsx.to(emailReport)));
