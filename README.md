# ApplyPilot

An AI job-search copilot. Upload your resume, pick the companies you want to work for, and ApplyPilot:

1. **Reads your resume** into a structured, editable profile (Claude reads PDFs directly; DOCX and text are supported too).
2. **Watches company job boards** on Greenhouse, Lever and Ashby through their public posting APIs.
3. **Filters and scores** every new posting against your profile and preferences, explaining strengths and gaps.
4. **Writes a tailored cover letter** for every posting worth applying to.
5. **Applies for you.** Everything goes into a review queue by default, where you approve it with one click. You can also turn on **auto-apply** for strong matches on boards that support it.
6. **Tracks outcomes**: applied, interview, rejected or offer.

Built with Next.js 16, TypeScript, Tailwind CSS v4, PostgreSQL, the Anthropic SDK and Playwright.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then set ANTHROPIC_API_KEY
npm run db:setup               # creates the schema and a demo account
npm run dev                    # http://localhost:3000
```

Sign in as `demo@example.com` / `password123` to look around with example data, or create your own account.

You don't need to install a database. With no `DATABASE_URL`, the app runs on [PGlite](https://pglite.dev), which is PostgreSQL compiled to WebAssembly and stored in `./.pglite`.

To use auto-apply, point `CHROMIUM_PATH` at a Chrome or Chromium binary.

## How applying works

| Board | Discovered and scored | Submitted |
| --- | --- | --- |
| Greenhouse | yes | automatically (after approval, or by auto-apply) |
| Lever | yes | automatically (after approval, or by auto-apply) |
| Ashby | yes | manually: open the posting, apply, then click **I applied** |

The submitter opens the application form in headless Chromium and reads every field with its label. It fills each field in this order:

1. **Your answer for this application**, if the form asked something earlier and you answered it in the queue.
2. **A deterministic match** against your profile and saved *screening answers*: name, email, phone, links, sponsorship, salary, notice period and your own custom Q&A. Dropdowns and radio buttons are only filled when your answer clearly matches one of the options.
3. **Claude**, for anything left over. It writes open-ended answers ("Why do you want to work here?"). For factual questions it must return nothing unless your data answers them, and for demographic questions it chooses "decline to answer".

If any **required** field is still empty, the form is **not** submitted. The application moves to *Needs input* and shows the exact questions. Answer them and approve again.

### Safety rails

- **Dry run by default.** Until `APPLY_LIVE=true` is set, the submitter fills in the whole form but never clicks Submit, and it reports what it would have done. Watch a few dry runs before going live.
- **Daily limit** on submissions (default 10, configurable per user).
- **Two thresholds.** One score decides what reaches your review queue, and a higher one decides what is auto-applied.
- **CAPTCHAs are never bypassed.** Some forms show a CAPTCHA the user has to solve. When that happens the application is marked failed with a note to apply by hand.
- **LinkedIn and Indeed are not scraped.** Their terms forbid automated access and applying. ApplyPilot only uses the public posting APIs that Greenhouse, Lever and Ashby publish for exactly this purpose.

## Background worker

"Find new jobs" in the UI runs the pipeline for the signed-in user. To run it for every user on a schedule:

```bash
npm run worker            # every WORKER_INTERVAL_MINUTES (default 60)
npm run worker -- --once  # one pass, for cron
```

PGlite allows only one process at a time. To run the worker alongside the web app, set `DATABASE_URL` to a real Postgres server.

## Docker

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build   # Postgres + app + worker
docker compose run --rm seed                             # optional demo account
```

Both images install Alpine's Chromium for the submitter.

## Project layout

```
src/server/
  ats.ts            Greenhouse / Lever / Ashby adapters and careers-URL parsing
  filter.ts         cheap preference pre-filter, run before any AI call
  ai.ts             every Claude call (structured outputs), behind an AiService interface
  pipeline.ts       sync -> filter -> score -> cover letter -> queue -> submit
  submit/fields.ts  deciding each form field's value (pure, unit tested)
  submit/browser.ts headless-Chromium form driver
  submit/index.ts   one application, end to end
  repo.ts           all SQL
  schema.sql        the schema (idempotent)
scripts/            db setup, migrations, background worker
tests/              unit + PGlite integration tests with fake AI, boards and browser
```

## AI usage and cost

Every call goes to `claude-opus-5` by default (`ANTHROPIC_MODEL` overrides it) with structured outputs, so the app always gets back validated objects rather than free text. Server-side refusal fallbacks are enabled. Scoring runs at low effort because it is high volume. Cover letters run at high effort. The candidate profile sits in a cached system block, so scoring many postings in one run reuses it. `PIPELINE_MAX_SCORED` (default 40) caps how many postings are scored per run.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | development server |
| `npm run build && npm start` | production build (`AUTH_SECRET` required) |
| `npm test` | unit and integration tests |
| `npm run lint` / `npm run typecheck` | static checks |
| `npm run db:setup` | schema plus demo account (`-- --force` recreates it) |
| `npm run db:migrate` | schema only, for a real Postgres server |
| `npm run worker` | scheduled pipeline runner |
