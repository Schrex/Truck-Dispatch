# Tech stack

Status: draft, 23 Nov 2026. This describes what is in the repo today, plus the choices already made for later phases. To change a choice here, write an ADR in `docs/adr/`.

## Runtime

| Part | Choice | Why |
|---|---|---|
| Server | One **Cloudflare Worker** (`worker/src/`) that serves both the API and the built page | Same shape as the Hub's other apps. ADR 0001: its own Worker, not the Hub's Dispatch. |
| Database | **Cloudflare D1** (SQLite). Migrations in `migrations/` change the schema only and are add-only within a PR. Synthetic test data is in `seed/fixture.sql` (never production); reference data every environment needs, such as the Inspection checklist, gets its own seed file that production loads too. | Its own database. Phases 2 to 4 are already designed: see "Target schema" in [`../design/dispatch-board-decisions.md`](../design/dispatch-board-decisions.md). |
| Files | **Cloudflare R2**, one private bucket bound as `PHOTOS` (`truck-dispatch-photos` locally, `truck-dispatch-photos-preview`, `truck-dispatch-photos-staging`): Paper log photos now, Ticket photos in phase 4. Pictures are read only through the Worker. | Built for the Paper log; the tests run against a local bucket in the same harness as the local D1 |
| Time | The Worker decides "today" in **US Eastern**. Moments are stored as exact UTC times and shown in Eastern. `NOW` fixes the clock in tests. | ADR 0004 |
| Truck data (phase 3) | **HCSS Fleet** place enter/leave events, pulled by the Worker every 10 minutes from 4 AM to 8 PM Eastern. Miles and engine hours come from the 4 AM readings. | Decided. API access to the Fleet report is still open: it refused our login (403). |

## Page

The Hub's stack at the Hub's versions (ADR 0002). Do not upgrade ahead of the Hub.

- React 18, react-router 6, Vite 6, TypeScript 5
- Tailwind 3 with shadcn/ui (slate, CSS variables), lucide icons, sonner toasts
- The Hub's design tokens in `src/index.css`, with Oswald and Inter. Light mode only.
- Served under `/truck-dispatch/`, and also at `/` when standalone (`shared/base.ts`)
- Code shared by page and Worker lives in `shared/`: API types and the day rules (`days.ts`)

## Tooling

- **Bun 1.3.14**, pinned in `package.json`. A newer Bun rewrites `bun.lock` in a form CI rejects.
- **Vitest** (see Testing below). Run it with `bun run test`, not `bun test`.
- `bun run typecheck` checks the page, the Worker and the scripts.
- **Wrangler 4** with `@cloudflare/vite-plugin` for local dev (workerd plus local D1)

## Testing

A good test says what Dave or a Driver would see, or what the API answers, for a situation described in the glossary's words, and does not depend on how a rule is written. New tests follow the existing ones in reading that way. There are four seams:

- **The Worker's API, called as a request** against a real local D1, migrated from `migrations/` and reseeded for each test (`worker/src/app.test.ts`, and per area `worker/src/inspections.test.ts`, `worker/src/truckProblems.test.ts` and `worker/src/paperLogs.test.ts`). `worker/src/testing/localD1.ts` owns the database and a local R2 bucket (`PHOTOS`); `worker/src/testing/api.ts` has the shared helpers: `apiOn(d1)` to send a request at the tests' clock (`MORNING`), the seeded checklist's `ITEMS`, and `inspection()` for a whole Inspection.
- **The page in jsdom with a fake API** (`src/App.test.tsx`, `src/pages/*.test.tsx`, `src/components/*.test.tsx`).
- **The day rules as pure functions** (`shared/days.test.ts`): Working days and Holidays across years, words and arrow targets, day states, Changed and Added.
- **Browser end-to-end** (Playwright, `e2e/`, run with `bun run e2e`): a few whole journeys through the real built app. It builds, then `scripts/e2e-serve.mjs` starts the built Worker with `wrangler dev` on its own fresh local D1 in `.wrangler/e2e` (migrated and seeded at every start; the developer's `.wrangler/state` is never touched) and the clock fixed with `NOW` (`e2e/clock.ts`: Monday 23 Nov 2026, 9 AM Eastern). Journeys go to the day they need explicitly (the Board's `?date=`), and set their own screen: the Driver view at phone size, the Board at desktop size. Rules stay in the seams above; these only prove the pieces work together. Vitest does not pick up `e2e/`. No traces, screenshots or videos by default. CI runs it as the `e2e` job, installing Chromium itself (cached); that job must be added to the required checks of the "Protect main" ruleset (a repo admin's step in [`../deployment.md`](../deployment.md)). The first journey is phase 1's: Dave adds an Assignment with the composer and Assigns it, and the Driver sees it.

`scripts/smoke.mjs` adds read-only checks against staging, run by CI after each deploy.

## Environments

Local (synthetic seed), a preview per PR, and staging, all on the Schrex Dev Cloudflare account behind Cloudflare Access, with synthetic data only. Production is not set up yet. Addresses, accounts, secrets and the PR → staging flow: [`../deployment.md`](../deployment.md).

## Not yet decided

- Sign-in and roles (waits for the Hub)
- Where the Truck log goes once finished: HeavyJob, payroll or CSV only
- Production account and its rollout

## Look and feel

- The Hub's tokens in `src/index.css` are unchanged; elevation (`--shadow-*`, `shadow-glow`) and motion (`--ease-out`, `--ease-spring`, `--duration-*`) tokens are added beside them, with utilities `animate-rise` (entrance, staggered by `--i`), `animate-unfold` (a panel opening), `lift` (hover lift on tappable cards) and `hivis-rule` (the stripe on every page header). Motion is turned off under `prefers-reduced-motion`.
- The Board is in the first download; the Driver view, Settings and the Simulation are loaded on their own (`React.lazy` in `src/App.tsx`) and prefetched when the browser is idle.

