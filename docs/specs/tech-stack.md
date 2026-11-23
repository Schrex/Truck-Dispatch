# Tech stack

Status: draft, 23 Nov 2026. This describes what is in the repo today, plus the choices already made for later phases. To change a choice here, write an ADR in `docs/adr/`.

## Runtime

| Part | Choice | Why |
|---|---|---|
| Server | One **Cloudflare Worker** (`worker/src/`) that serves both the API and the built page | Same shape as the Hub's other apps. ADR 0001: its own Worker, not the Hub's Dispatch. |
| Database | **Cloudflare D1** (SQLite). Migrations in `migrations/` change the schema only and are add-only within a PR. | Its own database. The schema for all four phases is already designed (design doc, "Target schema (v2)"). |
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
- **Vitest**: the Worker runs against a real local D1, and the UI runs in jsdom with a fake API. Run it with `bun run test`, not `bun test`.
- `bun run typecheck` checks the page, the Worker and the scripts.
- **Wrangler 4** with `@cloudflare/vite-plugin` for local dev (workerd plus local D1)
- `scripts/smoke.mjs` runs end-to-end checks against a running app. CI runs it on staging.

## Environments

| | Local | PR preview | Staging | Production |
|---|---|---|---|---|
| Where | laptop or container | `pr-<n>-truck-dispatch-preview.schrex-dev.workers.dev` | `truck-dispatch-staging.schrex-dev.workers.dev` | not set up yet |
| Data | synthetic seed | synthetic, shared by open PRs | synthetic, kept across deploys | real |
| Access | none | Cloudflare Access (Schrex Dev) | Cloudflare Access plus the CI token | Hub sign-in (later) |

Workflow: short branch, then a PR (CI, protected preview, 1 approval), then merge, then automatic deploy to staging. See `docs/deployment.md`.

## Not yet decided

- Sign-in and roles (waits for the Hub)
- Where the Truck log goes once finished: HeavyJob, payroll or CSV only
- Production account and its rollout
