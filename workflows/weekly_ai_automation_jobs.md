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

Credentials required:
- **Gmail OAuth2** on both Gmail nodes (`Email Report`, `Email No Results`).
- **Header Auth** `X-RapidAPI-Key` on the **JSearch** node.
- **Header Auth** `x-goog-api-key` on the **Gemini** node (free key from Google AI Studio).

## Tools / nodes, in order
1. **Config** (Set) — publishes the search term + filter settings to the two HTTP nodes and
   the Code node.
2. **Remotive** (HTTP) — `GET https://remotive.com/api/remote-jobs?search={{searchTerm}}&limit=50`.
   Response body: `{ jobs: [...] }`. Respect Remotive's **≤ 4 calls/day** guidance.
3. **Jobicy** (HTTP) — `GET https://jobicy.com/api/v2/remote-jobs?count=50&tag={{searchTerm}}`.
   Response body: `{ jobs: [...] }`.
4. **Compile Jobs** (Code, run-once-for-all-items) — maps all sources to a common schema,
   keeps rows whose employment type ∈ `allowedTypes`, applies the automation keyword gate
   (against title + tags + category + description), drops postings older than `maxAgeDays`,
   dedupes by URL (then title|company), sorts newest-first. Also **retains a cleaned description**
   and computes a **0–100 Trust score** (+ band + reasons). Emits **one item per job**, or a single
   `{ empty: true }` marker when nothing matched. Source of truth: `src/normalize-jobs.js`.
5. **Has Results?** (IF) — `{{ $json.empty }} is true` →
   - **true** output → **Email No Results**
   - **false** output → **Prep Summaries** *and* **Store in Log** (log hangs here so history is
     recorded even if the LLM/report path fails).
6. **Prep Summaries** (Code) — collapses the N job items into ONE item holding the job array plus a
   ready-made Gemini request body, so the next node makes a single batched call.
7. **Gemini** (HTTP, POST `…/models/gemini-2.0-flash:generateContent`) — one call returns a JSON
   array of one-line summaries. `onError: continueRegularOutput` + retry, response pinned to JSON.
8. **Apply Summaries** (Code) — re-expands to one item per job, attaching each summary; on any
   Gemini failure a role falls back to the first sentence of its own description.
9. **Build Report** (Code) — the whole deliverable in one node: a QuickChart Trust-score image
   (embedded in the email **and** fetched as `company-trust-chart.png`, binary `chart`), the HTML
   email body + subject, and a styled Excel-compatible `.xls` (binary `data`). Source: `src/build-report.js`.
10. **Email Report** (Gmail) — subject/body from `{{ $json.subject }}` / `{{ $json.html }}`, with
    **two** attachments: binary `data` (the `.xls`) and binary `chart` (the `.png`).
11. **Email No Results** (Gmail) — short "nothing matched this week" note.

## Expected outputs
- **Deliverable:** a designed HTML email (Trust-score chart + per-role cards with AI summaries and
  Trust badges) with **two attachments** — `ai-automation-jobs.xls` (styled: banner, summary,
  trust-band legend, colored Trust column, clickable roles) and `company-trust-chart.png`.
  Spreadsheet columns: `trust_score, trust_band, title, company, job_type, location, salary,
  posted_date, summary, source, url`.
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
- **Trust score, not a rating.** No free source returns real employer star-ratings, so the score is
  a transparent legitimacy signal built from data we already have (salary shown, cross-posting,
  verified site/logo, direct apply, recency, reputable board). It's fair across sources — the
  JSearch-only signals are additive bonuses, never penalties, so Remotive/Jobicy rows aren't
  disadvantaged.
- **Styled spreadsheet on n8n Cloud.** Cloud blocks external Code-node libraries (exceljs) and the
  built-in "Convert to File" node can't format cells — so the `.xls` is an HTML table saved with an
  `.xls` extension, which Excel/Sheets open **with** the styling. It's `.xls` under the hood, not
  a true `.xlsx`.
- **One batched LLM call.** `Prep Summaries` collapses all rows into a single item so `Gemini` fires
  once per run regardless of job count; `Apply Summaries` re-expands. Keeps cost flat and well inside
  the free tier.
- **Don't hotlink employer logos.** Some boards (e.g. Remotive) 403 hotlinked logo URLs, which renders
  as a broken image in email — the cards use a colored initial avatar instead. The QuickChart image is
  fine to hotlink.
- **Set the recipient after import.** The template ships with `you@example.com` in the Config node;
  leaving it unchanged sends the report to that dead placeholder domain and it bounces (Mail Delivery
  Subsystem / "Address not found"). Set `Config.recipient` to a real address before the first run.
