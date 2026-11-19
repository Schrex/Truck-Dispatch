# Truck-Dispatch
Assign work to trucks and drivers, let drivers pick up jobs, and capture trips, miles, hours, and material tickets.

Today: a standalone Cloudflare Worker that serves the **Dispatch board**: it opens on tomorrow (US Eastern), shows one card per Driver with that day's **Assignments**, and adds one with **Add Assignment** (only the date is required; a Driver and a note are optional). On a day after today, **Copy today** copies today's Assignments onto it without their notes; an open Assignment can be duplicated to another Driver. A second page, **Settings**, is linked from the board and empty for now. Backed by D1 with **synthetic** drivers only. Hub integration (at `/truck-dispatch/`), sign-in and production are later phases.

## Run it locally

Needs [Bun](https://bun.sh) **1.3.14**, pinned in `package.json` → `packageManager` to match the Hub and CI. A newer Bun rewrites `bun.lock` in a form CI rejects; install that version, or don't commit lockfile changes made with a newer one. No Cloudflare account needed.

```bash
bun install
bun run setup        # create the local D1, apply migrations, load synthetic data
bun run dev          # http://localhost:5173/truck-dispatch/
```

Click **Add Assignment**, optionally pick a Driver and write a note, and save; the Assignment appears on that Driver's card (or on "Unassigned").

| Command | What it does |
|---|---|
| `bun run dev` | Vite + the Worker in workerd, with local D1 (`.wrangler/state`) |
| `bun run test` | Vitest (Worker against a real local D1, UI in jsdom) + migration-number check. Not `bun test`. |
| `bun run typecheck` | TypeScript for the page, the Worker and the scripts |
| `bun run build` | Build the page and the Worker into `dist/` |
| `bun run preview` | Build, then run the built Worker; the app answers at `/` and `/truck-dispatch/` |
| `bun run smoke <url>` | End-to-end checks against a running app (CI runs it on staging) |
| `bun run db:reset` | Delete the local D1 and set it up again |

## Layout

| Path | What |
|---|---|
| `src/` | React pages (React 18, react-router 6, Tailwind 3, shadcn/ui, sonner toasts, Hub theme tokens in `src/index.css`): Board at `/`, Settings at `/settings`, both also under `/truck-dispatch/` |
| `worker/src/` | Worker: removes the `/truck-dispatch` prefix, then serves the API (`api.ts`) or page files |
| `shared/types.ts` | API shapes used by both |
| `shared/base.ts` | The `/truck-dispatch` prefix, used by both |
| `migrations/` | D1 schema only. Create with `bunx wrangler d1 migrations create truck-dispatch <name>` |
| `seed/fixture.sql` | Synthetic Drivers; `INSERT OR IGNORE`, safe to run repeatedly. No Assignments. |
| `wrangler.jsonc` | Local app (top level), `env.preview`, `env.staging` |

## API

Under `/api/` standalone or `/truck-dispatch/api/` under the Hub. No sign-in yet; Cloudflare Access protects previews and staging.

| Route | Answer |
|---|---|
| `GET health` | `{ ok, environment, commit }` |
| `GET drivers` | `{ drivers: [{ id, name }] }` |
| `GET today` | `{ today, tomorrow }`, dates in US Eastern time |
| `GET assignments?date=2026-11-20` | `{ assignments: [{ id, date, driverId, driverName, note, createdAt, updatedAt }] }` by Driver name, then creation time; no Driver last. 400 `{ fields: { date } }` without a real date |
| `POST assignments` | JSON `{ date, driverId?, note? }` → 201 `{ assignment }`, or 400 `{ fields: { name: message } }` (bad date, unknown Driver, note over 1000 characters). Unknown fields are ignored |
| `PUT assignments/:id` | JSON `{ date, driverId?, note? }`, every field replaced (one left out or empty is cleared; a new Driver or date moves it) → 200 `{ assignment }` with a new `updatedAt`; 400 `{ fields }` as for POST; 404 if it does not exist |
| `POST assignments/copy` | JSON `{ from, to }` (dates) → 201 `{ assignments }`: one new Assignment on `to` for each on `from`, every field kept except the note, which is empty. Adds to what `to` already has; copying twice copies twice. Nothing on `from` → 201 `{ assignments: [] }`. 400 `{ fields: { from?, to? } }` for a bad date |
| `DELETE assignments/:id` | → 204; a real delete, nothing kept. 404 if it does not exist |

Days before today (US Eastern) are read-only. Adding an Assignment on one, or moving one into one, is 400 `{ fields: { date } }`; copying onto one is 400 `{ fields: { to } }`; changing, moving or deleting an Assignment already on one is 409 `{ error: 'past_day', message }`.

The Worker reads the current time from its environment: `NOW` (an ISO 8601 moment) fixes it, as the tests do; deployed environments leave it unset. The old `orders` table is still in the database, unused.

## Workflow

Short-lived feature branch → pull request into `main` → CI checks + a protected preview linked on the PR → one approval → merge → automatic deploy to shared staging. Details, setup and recovery: [docs/deployment.md](docs/deployment.md).

## Rules for database changes

- Migrations change the schema only; test data goes in `seed/fixture.sql`.
- In a pull request, only add (tables, columns, indexes). Rename or drop in a later release, after nothing uses it. The preview database is shared by open PRs, and on staging the old version runs on the migrated database until the new one is live.
- If CI says two migrations share a number, renumber yours after merging `main`.
