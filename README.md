# Truck-Dispatch
Assign work to trucks and drivers, let drivers pick up jobs, and capture trips, miles, hours, and material tickets.

Today: a standalone Cloudflare Worker that serves the **Dispatch board**: pick a day, see its orders, and add one with **New Order** (the work, an assigned driver, an optional truck number). Backed by D1 with **synthetic** drivers only. Hub integration (at `/truck-dispatch/`), sign-in and production are later phases.

## Run it locally

Needs [Bun](https://bun.sh) **1.3.14**, pinned in `package.json` → `packageManager` to match the Hub and CI. A newer Bun rewrites `bun.lock` in a form CI rejects; install that version, or don't commit lockfile changes made with a newer one. No Cloudflare account needed.

```bash
bun install
bun run setup        # create the local D1, apply migrations, load synthetic data
bun run dev          # http://localhost:5173/truck-dispatch/
```

Click **New Order**, fill in the work, pick a driver and save; the order appears on that day's board.

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
| `src/` | React page (React 18, Tailwind 3, shadcn/ui, Hub theme tokens in `src/index.css`) |
| `worker/src/` | Worker: removes the `/truck-dispatch` prefix, then serves the API (`api.ts`) or page files |
| `shared/types.ts` | API shapes used by both |
| `migrations/` | D1 schema only. Create with `bunx wrangler d1 migrations create truck-dispatch <name>` |
| `seed/fixture.sql` | Synthetic drivers; `INSERT OR IGNORE`, safe to run repeatedly. No orders. |
| `wrangler.jsonc` | Local app (top level), `env.preview`, `env.staging` |

## API

Under `/api/` standalone or `/truck-dispatch/api/` under the Hub. No sign-in yet; Cloudflare Access protects previews and staging.

| Route | Answer |
|---|---|
| `GET health` | `{ ok, environment, commit }` |
| `GET drivers` | `{ drivers: [{ id, name }] }` |
| `GET orders?date=2026-11-18` | `{ orders: [...] }` by start time, untimed last |
| `POST orders` | JSON `{ workDate, job, work, driverId, startTime?, pickup?, dropoff?, truckNumber?, notes? }` → 201 `{ order }`, or 400 `{ fields: { name: message } }` |

## Workflow

Short-lived feature branch → pull request into `main` → CI checks + a protected preview linked on the PR → one approval → merge → automatic deploy to shared staging. Details, setup and recovery: [docs/deployment.md](docs/deployment.md).

## Rules for database changes

- Migrations change the schema only; test data goes in `seed/fixture.sql`.
- In a pull request, only add (tables, columns, indexes). Rename or drop in a later release, after nothing uses it. The preview database is shared by open PRs, and on staging the old version runs on the migrated database until the new one is live.
- If CI says two migrations share a number, renumber yours after merging `main`.
