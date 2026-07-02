/**
 * build-sdk-code.js — emit workflow.sdk.ts: the n8n Workflow SDK code for the same
 * workflow defined in workflow.json, for deployment via the n8n MCP server's
 * create_workflow_from_code tool. The Code-node body is read from src/normalize-jobs.js
 * and embedded with JSON.stringify so its backticks/quotes are escaped safely.
 *
 *   node scripts/build-sdk-code.js   ->  writes workflow.sdk.ts
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const S = JSON.stringify; // safe JS string literal for any content

const jsCode = fs.readFileSync(path.join(ROOT, 'src', 'normalize-jobs.js'), 'utf8');
const RECIPIENT = 'you@example.com';

// Expression bodies (no leading '='; expr() marks them as expressions).
const subjectReport =
  'Weekly AI Automation Part-Time Jobs — {{ $now.toFormat("yyyy-LL-dd") }}' +
  " ({{ $('Compile Jobs').all().length }} roles)";
const subjectEmpty =
  'Weekly AI Automation Part-Time Jobs — {{ $now.toFormat("yyyy-LL-dd") }} (no matches)';
const bodyReport =
  '<h2>Weekly AI Automation — Part-Time / Contract / Freelance</h2>' +
  "<p>{{ $('Compile Jobs').all().length }} matching remote role(s) this week " +
  '(part-time, contract or freelance; automation / AI focus).</p>' +
  '<p>Full list attached as an Excel file. Top roles:</p><ul>' +
  "{{ $('Compile Jobs').all().slice(0, 8)" +
  '.map(i => `<li><a href="${i.json.url}">${i.json.title}</a> — ${i.json.company} ' +
  '<em>(${i.json.job_type}, ${i.json.location})</em></li>`).join("") }}' +
  '</ul><p style="color:#888;font-size:12px">Sources: Remotive + Jobicy. ' +
  'Generated automatically by n8n.</p>';
const bodyEmpty =
  '<h2>Weekly AI Automation — Part-Time Jobs</h2>' +
  '<p>No part-time / contract / freelance automation roles matched this week ' +
  "on Remotive or Jobicy. I'll check again next Monday.</p>";

const sampleJob = {
  source: 'Remotive', title: 'AI Automation Specialist', company: 'Acme',
  job_type: 'part_time', location: 'Worldwide', salary: '', posted_date: '2026-07-01',
  url: 'https://example.com/job', tags: 'automation',
  // `empty` marks the no-results branch; included so the IF's $json.empty resolves.
  empty: false,
};

const code = `import { workflow, node, trigger, ifElse, newCredential, expr } from '@n8n/workflow-sdk';

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
  output: [{ searchTerm: 'automation', maxAgeDays: 30, allowedTypes: 'part_time,contract,freelance', requireKeyword: true, recipient: '${RECIPIENT}' }],
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
        { id: 'a5', name: 'recipient', value: '${RECIPIENT}', type: 'string' },
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
  output: [${S(sampleJob)}],
  config: {
    name: 'Compile Jobs',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: ${S(jsCode)},
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
      subject: expr(${S(subjectReport)}),
      emailType: 'html',
      message: expr(${S(bodyReport)}),
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
      subject: expr(${S(subjectEmpty)}),
      emailType: 'html',
      message: expr(${S(bodyEmpty)}),
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
`;

fs.writeFileSync(path.join(ROOT, 'workflow.sdk.ts'), code);
console.log('Wrote workflow.sdk.ts (', code.length, 'chars )');
