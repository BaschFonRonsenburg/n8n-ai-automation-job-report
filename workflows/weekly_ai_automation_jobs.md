# Workflow SOP: Weekly AI-Automation Part-Time Job Report

## Objective
Every week, deliver a curated, deduplicated list of **remote part-time / contract /
freelance AI-automation roles** to the user's inbox as an Excel attachment — with a
graceful "no matches this week" email when nothing qualifies.

## Trigger
`Schedule Trigger` — weekly, **Monday 07:07** local time. (Minute 07, not :00, to avoid
the fleet-wide top-of-hour spike.)

## Required inputs
None at runtime. Behavior is controlled by the **Config** node:
- `searchTerm` (default `automation`)
- `maxAgeDays` (default `30`)
- `allowedTypes` (default `part_time,contract,freelance`)
- `requireKeyword` (default `true`)

Credential required: a **Gmail OAuth2** credential on both Gmail nodes.

## Tools / nodes, in order
1. **Config** (Set) — publishes the search term + filter settings to the two HTTP nodes and
   the Code node.
2. **Remotive** (HTTP) — `GET https://remotive.com/api/remote-jobs?search={{searchTerm}}&limit=50`.
   Response body: `{ jobs: [...] }`. Respect Remotive's **≤ 4 calls/day** guidance.
3. **Jobicy** (HTTP) — `GET https://jobicy.com/api/v2/remote-jobs?count=50&tag={{searchTerm}}`.
   Response body: `{ jobs: [...] }`.
4. **Compile Jobs** (Code, run-once-for-all-items) — maps both sources to a common schema,
   keeps rows whose employment type ∈ `allowedTypes`, applies the automation keyword gate
   (against title + tags + category + description), drops postings older than `maxAgeDays`,
   dedupes by URL (then title|company), sorts newest-first. Emits **one item per job**, or a
   single `{ empty: true }` marker when nothing matched. Source of truth: `src/normalize-jobs.js`.
5. **Has Results?** (IF) — `{{ $json.empty }} is true` →
   - **true** output → **Email No Results**
   - **false** output → **To XLSX**
6. **To XLSX** (Convert to File) — turns the job items into `ai-automation-part-time-jobs.xlsx`
   (binary property `data`).
7. **Email Report** (Gmail) — HTML body (count + top 8 linked roles) with the `.xlsx`
   attached; subject includes the date and role count.
8. **Email No Results** (Gmail) — short "nothing matched this week" note.

## Expected outputs
- **Deliverable:** an email to the user with `ai-automation-part-time-jobs.xlsx` attached,
  columns `source, title, company, job_type, location, salary, posted_date, url, tags`.
- **Quiet week:** a "no matches" email instead. Never a silent run.

## Edge cases & failure handling
- **A source is down / rate-limited:** each HTTP node uses `onError: continueRegularOutput`
  + retry (3×, 2 s). The Code node's `readApiArray()` treats a missing/error body as `[]`,
  so the run still completes on the surviving source.
- **Zero matches:** handled explicitly — the Code node always emits ≥ 1 item (the `empty`
  marker) so a node outputting zero items can't silently halt the flow before the email.
- **Loose API search results** (e.g. a "Head of Sales" posting): the keyword gate over the
  description filters most out. Tighten by editing `DEFAULT_CONFIG.keywords`, or loosen by
  setting `requireKeyword=false` in Config.
- **Duplicate postings across sources:** deduped by URL, then `title|company`.

## Legal / ethical notes
- Uses official public JSON APIs, not HTML scraping. No auth, no ToS circumvention.
- Remotive: keep to ≤ 4 calls/day and don't redistribute their listings to third-party job
  sites (a private report to the user is fine). Jobicy asks for attribution back to Jobicy.

## Lessons learned
- **Don't double-filter.** Remotive/Jobicy already filter by keyword server-side. An early
  version *also* required the keyword in the **title**, which cut real matches to zero. Fix:
  run the keyword gate against the **description** (broad haystack), not the title, and treat
  it as a quality filter on top of the API search — not a second search.
- **Arbeitnow was dropped.** It has no text-search parameter (returns the latest ~100 mostly
  German jobs), so it contributed only noise. RemoteOK returned just its legal notice;
  Himalayas has no reliable search param. Two good sources beat a flaky third.
- **A zero-item node stops the branch.** To guarantee the "no results" email fires, the Code
  node emits an `empty` marker item rather than an empty array.
