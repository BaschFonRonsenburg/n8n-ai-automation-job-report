/**
 * build-workflow.js — assembles workflow.json from the node definitions below,
 * inlining src/normalize-jobs.js as the Code node body (so escaping is correct and
 * the workflow always matches the tested transform).
 *
 *   node scripts/build-workflow.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const jsCode = fs.readFileSync(path.join(ROOT, 'src', 'normalize-jobs.js'), 'utf8');

// Placeholder recipient for the public template — set your own address in the Config node's
// `recipient` field after import (both Gmail nodes read it from there).
const RECIPIENT = 'you@example.com';

// HTML body for the report email, built from the Compile Jobs node's items.
const reportBody =
  "=<h2>Weekly AI Automation — Part-Time / Contract / Freelance</h2>" +
  "<p>{{ $('Compile Jobs').all().length }} matching remote role(s) this week " +
  "(part-time, contract or freelance; automation / AI focus).</p>" +
  "<p>Full list attached as an Excel file. Top roles:</p><ul>" +
  "{{ $('Compile Jobs').all().slice(0, 10)" +
  ".map(i => `<li><a href=\"${i.json.url}\">${i.json.title}</a> — ${i.json.company} " +
  "<em>(${i.json.job_type}, ${i.json.location})</em></li>`).join('') }}" +
  "</ul><p style=\"color:#888;font-size:12px\">Sources: Remotive, Jobicy + JSearch " +
  "(Indeed / LinkedIn / Glassdoor / ZipRecruiter via Google for Jobs). " +
  "Generated automatically by n8n.</p>";

const noResultsBody =
  "=<h2>Weekly AI Automation — Part-Time Jobs</h2>" +
  "<p>No part-time / contract / freelance automation roles matched this week " +
  "on Remotive, Jobicy or JSearch. I'll check again next Monday.</p>";

const subjectBase =
  "Weekly AI Automation Part-Time Jobs — {{ $now.toFormat('yyyy-LL-dd') }}";

const nodes = [
  {
    id: 'node-schedule',
    name: 'Schedule (Mon & Thu 08:00)',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [0, 320],
    parameters: {
      rule: {
        interval: [
          // Twice weekly for fresher listings — Monday (1) and Thursday (4) at 08:00.
          { field: 'weeks', weeksInterval: 1, triggerAtDay: [1, 4], triggerAtHour: 8, triggerAtMinute: 0 },
        ],
      },
    },
  },
  {
    id: 'node-config',
    name: 'Config',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [220, 320],
    parameters: {
      assignments: {
        assignments: [
          { id: 'a1', name: 'searchTerm', value: 'automation', type: 'string' },
          { id: 'a2', name: 'maxAgeDays', value: 30, type: 'number' },
          { id: 'a3', name: 'allowedTypes', value: 'part_time,contract,freelance', type: 'string' },
          { id: 'a4', name: 'requireKeyword', value: true, type: 'boolean' },
          // Recipient lives here so a client version only changes this one field.
          { id: 'a5', name: 'recipient', value: RECIPIENT, type: 'string' },
        ],
      },
      options: {},
    },
  },
  {
    id: 'node-remotive',
    name: 'Remotive',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [440, 200],
    parameters: {
      url: 'https://remotive.com/api/remote-jobs',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'search', value: '={{ $json.searchTerm }}' },
          { name: 'limit', value: '50' },
        ],
      },
      options: { timeout: 20000 },
    },
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
  },
  {
    id: 'node-jobicy',
    name: 'Jobicy',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [440, 440],
    parameters: {
      url: 'https://jobicy.com/api/v2/remote-jobs',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'count', value: '50' },
          { name: 'tag', value: '={{ $json.searchTerm }}' },
        ],
      },
      options: { timeout: 20000 },
    },
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
  },
  {
    // JSearch (RapidAPI) — aggregates Indeed/Glassdoor/LinkedIn/ZipRecruiter via Google for
    // Jobs. Needs an "Header Auth" credential holding X-RapidAPI-Key (attach in n8n).
    id: 'node-jsearch',
    name: 'JSearch',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [440, 620],
    parameters: {
      method: 'GET',
      // JSearch moved its primary endpoint from /search to /search-v2 (the old path now
      // 404s "Endpoint '/search' does not exist"). v2 takes the same query params.
      url: 'https://jsearch.p.rapidapi.com/search-v2',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'X-RapidAPI-Host', value: 'jsearch.p.rapidapi.com' }] },
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'query', value: '={{ $json.searchTerm }}' },
          { name: 'page', value: '1' },
          { name: 'num_pages', value: '2' },
          { name: 'employment_types', value: 'PARTTIME,CONTRACTOR' },
          { name: 'remote_jobs_only', value: 'true' },
          { name: 'date_posted', value: 'month' },
        ],
      },
      options: { timeout: 20000 },
    },
    // No credentials block on purpose: an empty/placeholder id disables the credential
    // selector on import. On import, create a "Header Auth" credential (Name `X-RapidAPI-Key`,
    // Value = your RapidAPI key) and select it on this node. (Live instance already has one.)
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
  },
  {
    // Synchronization barrier: with three sources fanned into one Code node, n8n fires the
    // Code node on the FIRST arrival (so $('Jobicy')/$('JSearch') throw "hasn't been executed").
    // Merge (append) waits for all connected inputs before Compile Jobs runs.
    id: 'node-merge',
    name: 'Merge Sources',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3.2,
    position: [640, 460],
    parameters: { mode: 'append', numberInputs: 3 },
  },
  {
    id: 'node-compile',
    name: 'Compile Jobs',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [680, 320],
    parameters: { mode: 'runOnceForAllItems', jsCode },
  },
  {
    id: 'node-if',
    name: 'Has Results?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [900, 320],
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          {
            id: 'c1',
            leftValue: "={{ $json.empty }}",
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
      },
      options: {},
    },
  },
  {
    id: 'node-email-empty',
    name: 'Email No Results',
    type: 'n8n-nodes-base.gmail',
    typeVersion: 2.1,
    position: [1140, 200],
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: "={{ $('Config').first().json.recipient }}",
      subject: '=' + subjectBase + ' (no matches)',
      emailType: 'html',
      message: noResultsBody,
      options: {},
    },
  },
  {
    id: 'node-xlsx',
    name: 'To XLSX',
    type: 'n8n-nodes-base.convertToFile',
    typeVersion: 1.1,
    position: [1140, 440],
    parameters: {
      operation: 'xlsx',
      options: { fileName: 'ai-automation-part-time-jobs.xlsx', sheetName: 'Jobs' },
    },
  },
  {
    id: 'node-email-report',
    name: 'Email Report',
    type: 'n8n-nodes-base.gmail',
    typeVersion: 2.1,
    position: [1360, 440],
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: "={{ $('Config').first().json.recipient }}",
      subject: '=' + subjectBase + " ({{ $('Compile Jobs').all().length }} roles)",
      emailType: 'html',
      message: reportBody,
      options: { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } },
    },
  },
  {
    // Running log: append each job as a row to an n8n Data Table (no credential needed).
    // On import into another instance, either point dataTableId at your own table or
    // create one named "AI Automation Jobs Log" with matching columns.
    id: 'node-store-log',
    name: 'Store in Log',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [1360, 240],
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'AI Automation Jobs Log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          report_date: "={{ $now.toFormat('yyyy-LL-dd') }}",
          source: '={{ $json.source }}',
          title: '={{ $json.title }}',
          company: '={{ $json.company }}',
          job_type: '={{ $json.job_type }}',
          location: '={{ $json.location }}',
          salary: '={{ $json.salary }}',
          posted_date: '={{ $json.posted_date }}',
          url: '={{ $json.url }}',
          tags: '={{ $json.tags }}',
        },
        schema: ['report_date', 'source', 'title', 'company', 'job_type', 'location', 'salary', 'posted_date', 'url', 'tags']
          .map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true })),
        matchingColumns: [],
      },
      options: {},
    },
  },
];

const connections = {
  'Schedule (Mon & Thu 08:00)': { main: [[{ node: 'Config', type: 'main', index: 0 }]] },
  Config: {
    main: [[
      { node: 'Remotive', type: 'main', index: 0 },
      { node: 'Jobicy', type: 'main', index: 0 },
      { node: 'JSearch', type: 'main', index: 0 },
    ]],
  },
  // Each source lands on a distinct Merge input; Merge waits for all three before Compile Jobs.
  Remotive: { main: [[{ node: 'Merge Sources', type: 'main', index: 0 }]] },
  Jobicy: { main: [[{ node: 'Merge Sources', type: 'main', index: 1 }]] },
  JSearch: { main: [[{ node: 'Merge Sources', type: 'main', index: 2 }]] },
  'Merge Sources': { main: [[{ node: 'Compile Jobs', type: 'main', index: 0 }]] },
  'Compile Jobs': { main: [[{ node: 'Has Results?', type: 'main', index: 0 }]] },
  // IF output 0 = TRUE (empty) -> no-results email; output 1 = FALSE (has jobs) -> xlsx
  'Has Results?': {
    main: [
      [{ node: 'Email No Results', type: 'main', index: 0 }],
      // has-jobs branch fans to both the Excel/email path and the Data Table log
      [
        { node: 'To XLSX', type: 'main', index: 0 },
        { node: 'Store in Log', type: 'main', index: 0 },
      ],
    ],
  },
  'To XLSX': { main: [[{ node: 'Email Report', type: 'main', index: 0 }]] },
};

const workflow = {
  name: 'Weekly AI Automation Part-Time Job Report',
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

fs.writeFileSync(path.join(ROOT, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log('Wrote workflow.json with', nodes.length, 'nodes.');
