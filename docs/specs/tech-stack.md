# Tech stack

Status: draft, 23 Nov 2026. This describes what is in the repo today, plus the choices already made for later phases. To change a choice here, write an ADR in `docs/adr/`.

## Runtime

| Part | Choice | Why |
|---|---|---|
| Server | One **Cloudflare Worker** (`worker/src/`) that serves both the API and the built page | Same shape as the Hub's other apps. ADR 0001: its own Worker, not the Hub's Dispatch. |
| Database | **Cloudflare D1** (SQLite). Migrations in `migrations/` change the schema only and are add-only within a PR. | Its own database. Phases 2 to 4 are already designed: see "Target schema" in [`../design/dispatch-board-decisions.md`](../design/dispatch-board-decisions.md). |
| Files (phase 4) | **Cloudflare R2** for Ticket photos | Decided, not built yet |
| Time | The Worker decides "today" in **US Eastern**. `NOW` fixes the clock in tests. | ADR 0004 |
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

A good test says what Dave or a Driver would see, or what the API answers, for a situation described in the glossary's words, and does not depend on how a rule is written. New tests follow the existing ones in reading that way. There are three seams:

- **The Worker's API, called as a request** against a real local D1, migrated from `migrations/` and reseeded for each test (`worker/src/app.test.ts`).
- **The page in jsdom with a fake API** (`src/App.test.tsx`, `src/pages/*.test.tsx`, `src/components/*.test.tsx`).
- **The day rules as pure functions** (`shared/days.test.ts`): Working days and Holidays across years, words and arrow targets, day states, Changed and Added.

`scripts/smoke.mjs` adds read-only checks against staging, run by CI after each deploy.

## Environments

Local (synthetic seed), a preview per PR, and staging, all on the Schrex Dev Cloudflare account behind Cloudflare Access, with synthetic data only. Production is not set up yet. Addresses, accounts, secrets and the PR → staging flow: [`../deployment.md`](../deployment.md).

## Not yet decided

- Sign-in and roles (waits for the Hub)
- Where the Truck log goes once finished: HeavyJob, payroll or CSV only
- Production account and its rollout
