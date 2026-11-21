# Truck-Dispatch
Assign work to trucks and drivers, let drivers pick up jobs, and capture trips, miles, hours, and material tickets.

Today: a standalone Cloudflare Worker that serves the **Dispatch board**: it opens on the next **Working day** (US Eastern; on a Friday, Monday), shows one lane per Driver (name and usual Truck; a removed Driver only on a day he has work) and an Unassigned lane last, each with that day's **Assignments** as blocks reading "From → To" (or the note) in order, marked First and Then, and adds one with **Add Assignment** (only the date is required; a Driver, a Truck, a From and To Place, a Material, a Foreman and a note are optional; picking a Driver fills in their usual Truck). On a day after today, **Copy today** copies today's Assignments onto it without their notes; an open Assignment can be duplicated to another Driver. The header shows the day's short date and its word ("Mon, Nov 23 · Next Monday", with a Holiday's name); an arrow each side names the Working day it goes to, skipping weekends and the six Holidays, and the left and right arrow keys do the same when no field has the focus; **Back to** returns to the next Working day from any other day, and **Jump to** goes to any date. A second page, **Settings**, shows every list on one page (Drivers, Trucks, Places, Materials, Jobs, Foremen), each entry a chip with its key detail; tapping one opens a panel that saves as you type, **+ Add** adds one, **Remove** makes one inactive after asking (warning how many later days still hold a Driver's Assignments), and removed entries are listed apart and can be brought back; nothing is ever deleted. Backed by D1 with **synthetic** Drivers, Trucks, Jobs, Places, Materials and Foremen only. Hub integration (at `/truck-dispatch/`), sign-in and production are later phases.

## Run it locally

Needs [Bun](https://bun.sh) **1.3.14**, pinned in `package.json` → `packageManager` to match the Hub and CI. A newer Bun rewrites `bun.lock` in a form CI rejects; install that version, or don't commit lockfile changes made with a newer one. No Cloudflare account needed.

```bash
bun install
bun run setup        # create the local D1, apply migrations, load synthetic data
bun run dev          # http://localhost:5173/truck-dispatch/
```

Click **Add Assignment**, optionally pick a Driver (their usual Truck fills in) and write a note, and save; the Assignment appears last in that Driver's lane (or in "Unassigned").

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
| `shared/days.ts` | Day rules used by both, with no date library: Working days and the six Holidays, next and previous Working day, the word for a day (Today, Next Monday), short dates and arrow labels |
| `migrations/` | D1 schema only. Create with `bunx wrangler d1 migrations create truck-dispatch <name>` |
| `seed/fixture.sql` | Synthetic Trucks, Drivers with usual Trucks, Jobs, Places, Materials and Foremen; `INSERT OR IGNORE`, safe to run repeatedly. No Assignments. |
| `wrangler.jsonc` | Local app (top level), `env.preview`, `env.staging` |

## API

Under `/api/` standalone or `/truck-dispatch/api/` under the Hub. No sign-in yet; Cloudflare Access protects previews and staging.

| Route | Answer |
|---|---|
| `GET health` | `{ ok, environment, commit }` |
| `GET drivers`, `GET trucks`, `GET jobs`, `GET places`, `GET materials`, `GET foremen` | `{ drivers: [{ id, name, defaultTruckId, active }] }`, `{ trucks: [{ id, number, hcssCode, hcssGuid, active }] }`, `{ jobs: [{ id, name, jobNumber, active }] }`, `{ places: [{ id, shortName, fullName, kind, jobId, onTruckMap, active }] }`, `{ materials: [{ id, name, active }] }`, `{ foremen: [{ id, name, active }] }` by display name (name, number or short name): active entries only; `?include=inactive` for every entry. A Place's `kind` is `plant`, `job_site`, `shop`, `yard` or null (Settings offers shop and yard as one, Shop or yard, saved as `shop`); its geofence code is not part of the API, only `onTruckMap`, whether it has one, which is never saved from the page |
| `POST drivers`, `POST trucks`, `POST jobs`, `POST places`, `POST materials`, `POST foremen` | JSON with the display name and any other field → 201 `{ driver }` / `{ truck }` / `{ job }` / `{ place }` / `{ material }` / `{ foreman }`, or 400 `{ fields }` (missing name, a name already in the list ignoring case, unknown usual Truck or Job, a kind not in the list) |
| `PATCH <list>/:id` (drivers, trucks, jobs, places, materials, foremen) | JSON with only the fields to change, including `active: true/false` → 200 with the entry as for POST; 400 as for POST; 404 if it does not exist. There is no delete: an entry is made inactive |
| `GET drivers/:id/later-days` | `{ laterDays }`: how many days after today (US Eastern) hold one of the Driver's Assignments, for the warning before he is removed. 404 if the Driver does not exist |
| `GET today` | `{ today, tomorrow, nextWorkingDay }`, dates in US Eastern time; `nextWorkingDay` is the first weekday after today that is not a Holiday (New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas; a weekend Holiday is not moved) |
| `GET assignments?date=2026-11-20` | `{ assignments: [{ id, date, driverId, driverName, truckId, truckNumber, fromPlaceId, fromPlaceName, toPlaceId, toPlaceName, materialId, materialName, foremanId, foremanName, note, position, createdAt, updatedAt, changedAt }] }` (Place names are short names; `changedAt` is when it last really changed, null until then) by lane (Driver name, no Driver last), then `position` (its place in the lane, from 0), then creation time. 400 `{ fields: { date } }` without a real date |
| `POST assignments` | JSON `{ date, driverId?, truckId?, fromPlaceId?, toPlaceId?, materialId?, foremanId?, note? }` → 201 `{ assignment }`, last in its lane (its date and Driver, or Unassigned), or 400 `{ fields: { name: message } }` (bad date, unknown Driver, Truck, Place, Material or Foreman, note over 1000 characters). From and To may be the same Place. Unknown fields are ignored. Instead of an id, a Place or Material may be typed by name as `fromPlaceName`, `toPlaceName` or `materialName`: the entry with that name, ignoring case, is linked; a removed (inactive) one is made active again; otherwise a new one is added (a Place with no kind). This happens in the same request: if the Assignment is refused or not saved, nothing is added or brought back. 400 `{ fields }` on that name field for a blank name, one over 100 characters, or a name given together with the field's id |
| `PATCH assignments/:id` | JSON with only the fields to change, of `driverId`, `truckId`, `fromPlaceId`, `toPlaceId`, `materialId`, `foremanId`, `note`, and typed names as for POST: a field left out stays as it is, an empty one (null or `""`) is cleared → 200 `{ assignment }`. A real change of Driver puts it last in his lane (its date and Driver, or Unassigned); a real change sets `updatedAt` and `changedAt` to now; fields sent as they already are (the same Driver again, say) change nothing, not even those times. The day is fixed: `date` may be sent only as it is; any other is 409 `{ error: 'day_fixed', message }`. 400 `{ fields }` as for POST; 404 if it does not exist. There is no PUT (405) |
| `POST assignments/copy` | JSON `{ to }` (a date after today) → 201 `{ assignments }`: one new Assignment on `to` for each on today (US Eastern, by the Worker's clock), every field kept except the note, which is empty. Adds to what `to` already has; copying twice copies twice. Nothing on today → 201 `{ assignments: [] }`. 400 `{ fields: { to } }` for a bad date, a day before today, or today itself |
| `DELETE assignments/:id` | → 204; a real delete, nothing kept. 404 if it does not exist |

Days before today (US Eastern) are read-only. Adding an Assignment on one is 400 `{ fields: { date } }`; copying onto one is 400 `{ fields: { to } }`; changing or deleting an Assignment already on one is 409 `{ error: 'past_day', message }`.

The Worker reads the current time from its environment: `NOW` (an ISO 8601 moment) fixes it, as the tests do; deployed environments leave it unset. The old `orders` table is still in the database, unused.

## Workflow

Short-lived feature branch → pull request into `main` → CI checks + a protected preview linked on the PR → one approval → merge → automatic deploy to shared staging. Details, setup and recovery: [docs/deployment.md](docs/deployment.md).

## Rules for database changes

- Migrations change the schema only; test data goes in `seed/fixture.sql`.
- In a pull request, only add (tables, columns, indexes). Rename or drop in a later release, after nothing uses it. The preview database is shared by open PRs, and on staging the old version runs on the migrated database until the new one is live.
- If CI says two migrations share a number, renumber yours after merging `main`.
