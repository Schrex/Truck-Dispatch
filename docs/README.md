# Docs

Start with [`specs/mission.md`](specs/mission.md) for why the project exists, then [`../GLOSSARY.md`](../GLOSSARY.md) for its words. Words in capitals across these docs (Assignment, Driver, Assign, Truck log…) are the glossary's.

## Specs: what we are building and in what order

| File | What |
|---|---|
| [`specs/mission.md`](specs/mission.md) | The problem, the four-step pipeline to a Truck log, who it is for, principles, out of scope |
| [`specs/roadmap.md`](specs/roadmap.md) | Every phase cut into one-PR steps, with what is done, in review, to do and blocked |
| [`specs/tech-stack.md`](specs/tech-stack.md) | Stack, tooling, how we test, and what is still undecided |
| [`specs/phase-1-planning.md`](specs/phase-1-planning.md) | Phase 1 user stories (built): what the Board, Driver view and Settings had to do, and why |
| [`specs/phase-2-check-in.md`](specs/phase-2-check-in.md) | Phase 2 user stories (built): Check-in, the Inspection and Truck problems |

## How it works now

| File | What |
|---|---|
| [`how-it-works.md`](how-it-works.md) | What each page does today |
| [`api.md`](api.md) | Every API route, its answers and refusals |
| [`deployment.md`](deployment.md) | Previews, staging, accounts, secrets, CI and recovery |

## Why it is this way

| File | What |
|---|---|
| [`adr/`](adr/) | Architecture decisions: own app (0001), Hub's UI stack (0002), Send without a lock (0003, superseded), past days enforced by the Worker (0004), Assign each Assignment on its own (0005), the Inspection is the official, append-only record (0006), answering Unplanned work on a past day (0007), the Not considered list in place of the 2-minute drive-through rule (0009) |
| [`design/dispatch-board-decisions.md`](design/dispatch-board-decisions.md) | Why the app works as it does (phase 1), what is decided for phases 2 to 4, and their target schema |
| [`design/telematics-backend.md`](design/telematics-backend.md) | Phase 3 in detail: what one real day of HCSS Fleet data shows, how Trips are built and matched to Assignments, and proposed changes |
| [`design/ui-standards.md`](design/ui-standards.md) | The one layout and set of controls every page follows: header, navigation, surfaces, states and motion |
| [`design/system-design.html`](design/system-design.html) | Interactive map of the pipeline from Dave's plan to a Truck log, with a real truck's day (open in a browser) |

## For AI agents

| File | What |
|---|---|
| [`agents/`](agents/) | How agents use the issue tracker, triage labels and these domain docs (linked from `CLAUDE.md`) |

## Where new docs go

- A new phase or feature spec: `specs/phase-<n>-<name>.md`, then add its steps to `specs/roadmap.md`.
- A decision that is hard to reverse and surprising without context: a new ADR in `adr/`.
- A new word: `GLOSSARY.md`, with no implementation details.
- A change to what a page does or to the API: update `how-it-works.md` or `api.md` in the same PR.
