# Truck-Dispatch

Dave plans each Driver's day as Assignments and Assigns each to the Driver's phone. Later phases turn that plan, the Truck's own movements and the Driver's Tickets into a finished **Truck log** for every Truck, every day, which nobody types. Why and what next: [mission](docs/specs/mission.md) and [roadmap](docs/specs/roadmap.md).

**Status:** phase 1 (planning: Board, Driver view, Settings) is built and runs on staging with synthetic data. Phases 2 to 4 (check-in, Trips, Tickets and the Truck log) are designed, not built.

## Where things are

| You want to… | Read |
|---|---|
| Understand why this exists and where it is going | [`docs/specs/mission.md`](docs/specs/mission.md), [`docs/specs/roadmap.md`](docs/specs/roadmap.md) |
| Learn the words (Assignment, Assign, Draft, Truck log…) | [`GLOSSARY.md`](GLOSSARY.md) |
| See what the app does today, page by page | [`docs/how-it-works.md`](docs/how-it-works.md) |
| Call or change the API | [`docs/api.md`](docs/api.md) |
| Know the stack and the environments | [`docs/specs/tech-stack.md`](docs/specs/tech-stack.md) |
| Find why something was decided | [`docs/adr/`](docs/adr/) (big decisions), [`docs/design/dispatch-board-decisions.md`](docs/design/dispatch-board-decisions.md) (every design decision) |
| Deploy, review a preview or fix CI | [`docs/deployment.md`](docs/deployment.md) |
| Everything in `docs/` | [`docs/README.md`](docs/README.md) |

## Run it locally

Needs [Bun](https://bun.sh) **1.3.14**, pinned in `package.json` → `packageManager` to match the Hub and CI. A newer Bun rewrites `bun.lock` in a form CI rejects; install that version, or don't commit lockfile changes made with a newer one. No Cloudflare account needed.

```bash
bun install
bun run setup        # create the local D1, apply migrations, load synthetic data
bun run dev          # http://localhost:5173/truck-dispatch/
```

Tap **+** on a Driver's lane (or on "Unassigned"), tap the chips you know (or type a Place or Material that is not in the list), leave the Truck on "His own" unless the work needs a certain one, and Save; the Assignment appears last in that lane.

| Command | What it does |
|---|---|
| `bun run dev` | Vite + the Worker in workerd, with local D1 (`.wrangler/state`) |
| `bun run test` | Vitest (Worker against a real local D1, UI in jsdom) + migration-number check. Not `bun test`. |
| `bun run typecheck` | TypeScript for the page, the Worker and the scripts |
| `bun run build` | Build the page and the Worker into `dist/` |
| `bun run preview` | Build, then run the built Worker; the app answers at `/` and `/truck-dispatch/` |
| `bun run e2e` | Build, start the built app with its own fresh local D1 (`.wrangler/e2e`, not yours) and a fixed clock, run the browser journeys in headless Chromium (`e2e/`), and stop it. First time: `bunx playwright install chromium` |
| `bun run smoke <url>` | End-to-end checks against a running app (CI runs it on staging) |
| `bun run db:reset` | Delete the local D1 and set it up again |

## Layout

| Path | What |
|---|---|
| `src/` | React pages (React 18, react-router 6, Tailwind 3, shadcn/ui, sonner toasts, Hub theme tokens in `src/index.css`): Board at `/` (or the Driver view, on a device that chose it), Driver view at `/driver`, Settings at `/settings`, and the phase 3 Simulation at `/simulate` (Truck 55, MCK-55-17, driven by Randy on Mon 16 Nov 2026 on the real HCSS Fleet data: a clock and a scenario picker, then the Scheduler view, Randy's lane on the real board blocks, and the Driver view, his Today on the real Driver cards, each with the Assignment's Trip part from the Trip builder at the clock's time; then the Truck log: its header (Truck, date, start and end time, start and end miles, Driver or "Who was driving?", Total hours), one column per Assignment, "Assignment 1" on (Job, Pick up, Drop off, Material, # of loads, # of tons, blank "from Tickets" until read, Trucking hours), then an amber box per piece of Unplanned work no Assignment explains (its Places and times, never a guessed Pick up or Drop off), also counted on Randy's lane, which Dave answers with Make an Assignment (where he loaded and the Material) to get an Assignment "From the Truck" the rules count, Link to an Assignment (a reroute of one of Randy's Assignments from the piece's first Trip) or Not a haul (with an optional note), and the drives to and from the shop, as known at that time; beside the views, the Trip log of every Trip the Truck made, the drive back to the shop included, with its kind, Assignment and matching rule; nothing is saved), all also under `/truck-dispatch/` |
| `worker/src/` | Worker: removes the `/truck-dispatch` prefix, then serves the API (`api.ts`) or page files |
| `shared/types.ts` | API shapes used by both |
| `shared/trips.ts`, `shared/trips.fixture.ts` | The phase 3 Trip builder (pure): cleans one Truck's raw Fleet visits, pairs them into Trips, matches each to an Assignment as it was when the Trip left, and works out each Assignment's Trip part (Loads, Now/Done, since, last Load, Trucking hours; tons blank until Tickets), its Job (the drop-off's, else the pick-up's), the Trips no Assignment explains, and the Truck's day for the Truck log's header (Driver, start and end time from ignition and the shop, meter miles, Total hours); and a fake day with the times and odometers of a real one and made-up names, used only by its tests. Not used by the Worker yet. Design: `docs/design/telematics-backend.md` |
| `src/simulate/realDay.ts`, `src/simulate/simulate.ts`, `src/simulate/DriverView.tsx`, `src/simulate/TripLog.tsx` | The Simulation's one day: MCK-55-17 on 16 Nov 2026 from the real Fleet export, Supabase meter readings and ping history (real Place names, unlike the seed), Randy and Truck 55, its ignition on and off, and Dave's Assignments for it (as planned, the other way round, the reroute at 11:20; made for the simulation, the real ones were not shared); and `simulateAt`, the day at one clock time as the API would send it; and the page's Driver view and Trip log sections. |
| `src/components/TruckLog.tsx`, `src/components/TruckLogAssignments.tsx` | The Truck log (the paper Daily Truck Log filled in by the app): its header from the Trip builder's Truck day, and below it one column per Assignment (the paper's Orders), an amber box per piece of Unplanned work for Dave, and the drives to and from the shop. Shown in the Simulation. |
| `shared/base.ts` | The `/truck-dispatch` prefix, used by both |
| `shared/days.ts` | Day rules used by both, with no date library: Working days and the six Holidays, next and previous Working day, the word for a day (Today, Next Monday), short dates and arrow labels, and the Assign rules: whether an Assignment is Changed or Added since it was Assigned, a day's state (none, Draft with the count of Drafts, Assigned, Changed; cancelled Drafts are not counted) and its week strip word |
| `migrations/` | D1 schema only. Create with `bunx wrangler d1 migrations create truck-dispatch <name>` |
| `e2e/` | Browser end-to-end journeys (Playwright, `playwright.config.ts`); `scripts/e2e-serve.mjs` serves the built app for them |
| `seed/inspection-items.sql` | Reference data every environment loads, production too: the Inspection checklist's 12 starting items from the paper form, fixed ids, `INSERT OR IGNORE` so Dave's changes survive. Loaded before the fixture. |
| `seed/fixture.sql` | Synthetic Trucks, Drivers with usual Trucks, Jobs, Places, Materials and Foremen; `INSERT OR IGNORE`, safe to run repeatedly. No Assignments. |
| `wrangler.jsonc` | Local app (top level), `env.preview`, `env.staging` |

## Workflow

Short-lived feature branch → pull request into `main` → CI checks + a protected preview linked on the PR → one approval → merge → automatic deploy to shared staging. Details, setup and recovery: [docs/deployment.md](docs/deployment.md).

## Rules for database changes

- Migrations change the schema only; test data goes in `seed/fixture.sql`, and reference data every environment needs (such as the Inspection checklist's starting items) in its own seed file, run by `bun run setup` and every pipeline.
- In a pull request, only add (tables, columns, indexes). Rename or drop in a later release, after nothing uses it. The preview database is shared by open PRs, and on staging the old version runs on the migrated database until the new one is live.
- If CI says two migrations share a number, renumber yours after merging `main`.
