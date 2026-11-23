# Phase 3: Trips, detailed design (draft, 22 Nov 2026)

This is the detailed design for phase 3 of `docs/design/dispatch-board-decisions.md` ("Final mocks", "Phases 2 to 4", "Target schema (v2)"). Those decisions are the base, and this doc does not repeat them. It adds:

- what one real day of HCSS data shows;
- how Trips are built and matched to Assignments;
- where Trips appear in the screens that already exist;
- the few places where the data says an agreed decision has to change. These are listed as proposals at the end.

Words are from `GLOSSARY.md`: Assignment, Driver, Truck, Place, Trip, Load, Ticket, Inspection, Send, Truck log. "Visit" below is a raw HCSS row, not a glossary word.

## Agreed (from `main`), and used here as is

- Trips come from HCSS Fleet place enter/leave data, pulled every 10 minutes from 4 AM to 8 PM Eastern. They are kept raw and paired into Trips.
- A Trip from an Assignment's From to its To is a Load; the way back is empty. `trips.kind` is `load`, `empty`, `not_a_haul` or NULL (not answered yet).
- The Driver of a Trip is whoever last inspected that Truck before it (phase 2). Without an Inspection, Dave answers "Who was driving?".
- At sign-off the Driver puts each Ticket on its Load and confirms his Trips. Dave answers the rest next morning: Trips with no Assignment (make one, link one, not a haul), "Who was driving?", and Assignments with no Trips.
- Trips made before a reroute are matched against the Assignment as it was. `assignment_changes` already keeps every earlier version from the Send on.
- An Assignment's Now, Done and "since" are worked out from its Trips, not stored.
- Miles and engine hours are the Fleet meter readings around the day (`meter_readings`): the last one before the day and the first one after it. On 16 Nov those were read 15 Nov 21:41 and 16 Nov 22:12 Eastern, so the end miles exist from that evening.

## Decided for the Truck log (spec #55)

These come from the simulation spec (#55) and are built in the Trip builder (`shared/trips.ts`). Words as in `GLOSSARY.md`.

- **The Truck's day's Driver, without Inspections.** The Driver whose Assignments that day name the Truck (an Assignment with no Truck names his usual one), otherwise the Driver whose usual Truck it is. If more than one fits, nobody is chosen and the Truck log asks "Who was driving?". This stands in for the phase 2 rule (whoever last inspected it) until Inspections exist; see P4.
- **An Assignment's Job comes from its Places:** the Job of its drop-off, otherwise of its pick-up (its route as it is now, so a reroute can change it). The Assignment has no Job field. A Place belongs to at most one Job (`places.job_id`).
- **Trucking hours** of an Assignment run from the leave time of its first linked Trip to the arrive time of its last, loaded or empty. On 16 Nov as planned, A1 runs 08:24 to its last Load at 11:25 (3.02 h) and A2 11:30 to 13:54 (2.40 h). The empty drive from Bishop Kearney back to J25008 at 14:33 would fit rule 4 ("going to A1's pickup") and stretch A1 to 14:43, overlapping A2; it is the way back from a Trip nothing explains, so it goes to Dave with that Trip instead (see the rules below).
- **Total hours** run from the Truck's day's start time to its end time (see build order 1).
- **Tons** are the sum of the Ticket quantities on an Assignment's Loads (phase 4). Until Tickets exist the Truck log shows them blank, marked "from Tickets". Nobody types them.
- **Trips with no Assignment** (none fits, or two do), each with its way straight back when that follows, are an **extra job**: an extra Truck log column after Dave's Assignments, "Assignment 3 · unverified", with its Job (of where it went, else where it came from), Pick up, Drop off and Trucking hours. Whether it was a Load and of what Material is Dave's to decide next morning, so both read "Unknown · Dave decides". In the simulation they are shown, not answerable.
- **To and from the shop**: below the columns, the Truck log lists the drives out of the shop in the morning and back to it at the end of the day, with times and miles.

## Decided: real Truck logs from Fleet exports (23 Nov 2026, revised after review)

HCSS Fleet's entry/exit API refuses access, so for now Dave drops **Fleet exports** (`GLOSSARY.md`) into the app, several a day, for one Truck. Words as in `GLOSSARY.md` (**Fleet export**, **Import**, **Truck log**, **Check-in**, **Unplanned work**). Real data on staging: [ADR 0008](../adr/0008-one-real-trucks-data-on-staging.md). Spec: Schrex/Truck-Dispatch#81.

- **Order.** This builds after Unplanned work lands (PR #78 and #74), so it shows Unplanned work, never the earlier "unverified" column. Ties (two Assignments fit) stay "Which Assignment?".
- **Setup through the app.** Settings gains a Truck's HCSS code and a Place's geofence code. Dave sets up Truck 55 (MCK-55-17), Randy and the real Places on staging himself; nothing real is seeded or committed. No 16 Nov backfill (past days are read-only); the real loop is a day Dave plans ahead and Imports during.
- **Fleet imports page** (`/fleet-imports`, linked from the board header). It takes JSON or xlsx; the page reads the file and the Worker stores the visits. The export must hold one active Truck by its HCSS code; anything else is refused. Imports are accepted only where `ENVIRONMENT` is `local`, `preview`, `staging` or `test`.
- **No duplicates.** The same visit has the same Truck, geofence code and entry minute (UTC, cut to the minute), so JSON and xlsx rows of one visit meet; a same-minute re-entry at one geofence is merged (accepted). The most exact entry time any export gave is kept. A newer Import closes an open visit; an older one never reopens it. Each Import reports added, closed and already stored, and which Eastern days it covered (kept, so "as of" is known per day). No undo yet.
- **The 16 Nov files, as checked:** the 15:02 JSON holds 18 visits; the xlsx adds the 16:03 Shop visit and closes J25008 at 15:41 ("1 new · 1 closed"). Cuts at 10:15, 13:05 and 16:20 give 8/0, 6/1 and 5/0 new/closed; the Shop visit stays open past midnight. xlsx dates are read as US Eastern explicitly.
- **Codes with no Place** in an Import are listed (drive-throughs too, marked), never refused.
- **The stored day.** The Fleet imports page shows a Truck's day with the Simulation's views (Scheduler, Driver, Trip log, Truck log) and replay clock. A past day opens at end of day; today at its latest Import. A clock minute means its last second. Each day is built as of its latest Import, not the Worker's clock, so a stale export never turns a drive-through into Unplanned work.
- **Who drove, and what is matched.** The Truck's Driver at a Trip's time is the Driver of the latest check-in to it that day, at or before then; the Trip is matched against that Driver's Assignments that day, whatever Truck they name. With no check-in before a Trip, the Truck log asks "Who was driving?" (P4: never guess) and the Trip is matched against the Assignments that name the Truck (or the Driver's usual Truck when none is named). The Trip builder takes the check-ins as an input. Only Assigned Assignments are read; cancelled and discarded ones are kept for matching (discarding only hides a card).
- **Board and Driver page.** Reading a day adds the Trip part from stored visits; with none, nothing changes. Unplanned work shows in the lane of the Driver who drove then, or in its own row "Driver not known · Truck 55" under the lanes, never in Unassigned. The Driver sees his Truck log under Today all day, "as of" the latest Import, for the Truck he checked in to (else his usual one).
- **Miles** stay blank until meter readings exist; start and end time come from the visits. A real day is over once its date is before today (US Eastern); until then the end time appears only once the Truck is back at the Shop.

## What one real day shows (MCK-55-17, Mon 16 Nov 2026)

There are four sources:
- the Fleet entry/exit report as JSON (taken 15:02 ET) and as xlsx (later the same day);
- the Fleet ping history (xlsx);
- the snapshots in the hub's Supabase, taken from the public Telematics API.

An independent review recomputed every number below from the raw files.

1. **Fleet entry/exit is enough to build the day.** Each row is one visit to a Place, with UTC entry and exit times and the odometer and hour meter at each.
2. **Each row holds both the enter and the leave, and there is no event id.** The agreed `fleet_events` table expects a separate row for each enter and each leave, with a unique `hcss_event_id`. This data has neither (proposal P2).
3. **A visit stays open until the Truck leaves.** In the JSON, the last row (J25008, from 14:43) has `ExitDateTime: null`; the later export shows it closing at 15:41:56. The open row is not empty: `ExitOdometer` and `Duration` hold the current values. Exit values on an open row must be ignored.
4. **Drive-throughs.** The Truck crossed `sunset`, a Place with no description, twice, for 61 s each time. These are not Trips.
5. **Short exits.** J25008 07:02–07:13, then again 07:15–08:24. In between the Truck really left (two pings about 400 m away at 27–30 mph), but it is one time at that Place.
6. **Midnight.** Fleet cuts every visit at local midnight. A Truck parked all day gets a row from 00:00 to 00:00. A visit that starts at exactly 00:00 means "already there", not an arrival.
7. **`CalculatedMiles` on a visit is the distance driven inside the Place** (it equals exit odometer − entry odometer). A Trip's miles = next entry odometer − this exit odometer.
8. **Speed is wrong in the ping history.** After 14:43 every ping says 0 mph, including the 22-minute drive home at about 50 mph. Nothing may use the speed value.
9. **Fuel** (`fuel_used_gallons`) stayed at 241.3 for three days. Do not use it.
10. **The public Telematics API works for us.** The Supabase snapshots come from it, and each `reading_at` matches a ping exactly. **Fleet's report does not work for us yet:** the Worker's API login was refused (403). The JSON envelope (`Result`, `Status: 5`, `IsCompleted`) is Fleet's internal web call, not an API we are allowed to use (proposal P1).

### The day as Trips

After cleaning (rules in §2), 18 rows become 15 visits and 15 Trips. Suppose two Assignments: A1 "J25008 → Villager" and A2 "Walworth → J25008". The matching rules in §3 then give:

```
SHOP      → J25008     06:24 → 07:02   20.6 mi   empty (to the first pickup)
J25008    → VILLAGER   08:24 → 08:34    3.4 mi   load  A1   ┐
VILLAGER  → J25008     08:43 → 08:56    3.6 mi   empty A1   │
J25008    → VILLAGER   09:35 → 09:46    3.5 mi   load  A1   │ 4 Loads on A1
VILLAGER  → J25008     09:50 → 10:00    3.2 mi   empty A1   │
J25008    → VILLAGER   10:27 → 10:38    3.4 mi   load  A1   │
VILLAGER  → J25008     10:41 → 10:53    3.6 mi   empty A1   │
J25008    → VILLAGER   11:14 → 11:25    3.4 mi   load  A1   ┘
VILLAGER  → WALWDOLO   11:30 → 11:56   20.4 mi   empty A2 (to its pickup)
WALWDOLO  → J25008     12:08 → 12:36   21.2 mi   load  A2   ┐
J25008    → WALWDOLO   12:54 → 13:18   21.2 mi   empty A2   │ 2 Loads on A2
WALWDOLO  → J25008     13:29 → 13:54   21.2 mi   load  A2   ┘
J25008    → J611       14:15 → 14:23    3.5 mi   NULL  (Dave answers next morning)
J611      → J25008     14:33 → 14:43    3.7 mi   NULL  (the way back from J611: one side trip for Dave)
J25008    → SHOP       15:41 → 16:03   18.4 mi   empty
```

**The Truck cannot tell which way the material went.**
- **For loading at J25008:** the Truck waited 20–35 min in one place there, and stopped only 3–9 min at Villager.
- **Against it:** J25008 waits after the stone deliveries were as long (18–21 min), and the glossary's own example has Villager as a pickup.

It does not matter. The Assignment's From → To decides the direction.

## 1. Getting the data

The rest of phase 3 sees only **visits**: `{ truck, geofenceCode, enteredAt, exitedAt?, entryOdometer, exitOdometer?, entryHours, exitHours? }`. One adapter fills them. There are two possible adapters, so the choice can change without touching anything else:

| | **A. Fleet entry/exit** (agreed) | **B. Public Telematics API** (fallback) |
|---|---|---|
| Call | Fleet entry/exit for each Truck, for today, every 10 min, 4 AM–8 PM ET | `GET /telematics/api/v1/equipment`, all Trucks in one call, every minute, all day |
| Places | HCSS's own, the same truck map Dave sees (`geofence_code`) | Our own shape per Place; the app finds the visits itself |
| Access | **Refused (403) today** | **Works today** |
| A missed pull | Harmless: the next pull returns the whole day again | Lost for good: the API only gives the current position |
| Extra | None | Raw positions, so stops away from every Place show too |

**Adapter A**
- **The 10-minute schedule is enough.** Each pull returns the whole day, so nothing is missed, and closed visits never change.
- **Late work:** a visit that closes after 8 PM is picked up by one extra pull at 4 AM next day.

**Adapter B**
- **Replayed on the 16 Nov pings**, it found every real visit within 62 s and rejected both drive-throughs. The settings: 2 samples to enter or leave, a shape fitted to each Place, and "stopped" judged by position, never speed.
- **Its weak points:**
  - Each Place needs a good shape. One typed radius is not enough: at 150 m, Walworth's 12-minute visits came out as 2 minutes.
  - A missed minute is lost for good.
  - That the API updates every minute is not yet proved.

## 2. Raw visits and cleaning

Raw visits are stored as they come and never changed by people (proposal P2 gives the table). The Trip builder cleans them each time it runs:

1. **Drop drive-throughs:** a visit under 2 min, unless it is still open.
2. **Join short exits:** two visits to the same Place with 5 min or less between them become one.
3. **Midnight:** a visit starting at 00:00 local is where the Truck began the day.
4. **Ignore exit values on an open visit.**
5. **Map to Places** by `places.geofence_code`.
   - An unknown code keeps its raw name and is listed for Dave in Settings, under the Place panels' "On the truck map".
   - A code that starts with a job number (`J25008 …`) suggests that Job.

The thresholds are constants, tuned on fixtures like 16 Nov.

## 3. Building and matching Trips

`buildTrips(visits, places, assignments, assignmentChanges, truck, date) → trips` is pure, with no database or network inside it. It can live in `shared/`, next to `shared/days.ts`, and is tested on the 16 Nov fixture. Each Trip runs from one visit's exit to the next visit's entry.

**Which Assignments can match.** Use the Assignments of the Trip's Driver on that date, whatever Truck is written on them. If no Driver is known yet, use the Assignments that name this Truck, plus those with "his own" Truck whose Driver's usual Truck it is.

**The Assignment as it was when the Trip left.** For each candidate:
- if its earliest change in `assignment_changes` with `changed_at` after `left_at` exists, use that change's `before`;
- otherwise use the Assignment as it is now.

An Assignment cancelled after `left_at` still matches; one cancelled before does not. The day does not have to be Sent: a Draft day's Assignments match too.

**Rules.** The first rule that fits wins. If two Assignments fit at the same rule, `kind` stays NULL and Dave chooses next morning. The rules never guess.

| # | Trip A → B | `kind` | `assignment_id` |
|---|---|---|---|
| 1 | An Assignment has From = A, To = B | `load` | that Assignment |
| 2 | An Assignment has From = B, To = A (the way back) | `empty` | that Assignment |
| 3 | A or B is the shop or a yard | `empty` | none |
| 4 | B is the From of an Assignment (going to load) | `empty` | that Assignment |
| 5 | An Assignment has From = A, To empty | `load` | that Assignment |
| 6 | An Assignment has To = B, From empty, and A is a plant | `load` | that Assignment |
| 7 | Nothing fits | NULL | none; Dave answers |

**The way back from a Trip nothing explains goes with it.** When a rule 7 Trip A → B is followed straight away by B → A, and that drive back was only matched by rules 4–7 (an empty guess), the drive back is NULL too: one side trip for Dave to answer, not a drive to some Assignment's pickup. A drive back that fits an Assignment's route (rules 1, 2) or the shop (rule 3) keeps its match.

**Rule 3 is an assumption, not a measurement.** Fleet only records when the Truck entered and left each geofence, nothing about what it carried. A Trip to or from the shop or a yard is taken as empty because Trucks do not load there; a Ticket would be the only proof otherwise.

Rules 2–4 come before 5–6 on purpose. Otherwise:
- with To empty, the drive to the shop and the drive to the next plant become Loads;
- with From empty, every way back becomes a Load.

Two things the rules cannot see:
- **An Assignment whose From and To are the same Place** never has a Trip. It shows as an Assignment with no Trips, which is already one of Dave's morning questions.
- **A dump away from every Place** is not a Trip at all.

**A Trip stays a suggestion until someone confirms it.** That is a Ticket on the Load, or the Driver at sign-off. Arriving at a Place does not prove a delivery.

**When Trips are written.** A Trip is written once both of its visits are final:
- the visit it leaves is closed and more than 5 min old, so no short exit can still join it;
- the visit it reaches has started.

After that the row is not rebuilt. Answers (`kind`, `assignment_id`, `answered_at`) stay on it safely, and no separate answers table is needed. If raw data for a day already answered changes later, the day is flagged for Dave, not rewritten.

**Miles check.** The meter readings around the day give the day's miles. They should equal the sum of the Trips' miles plus the miles driven inside Places. On 16 Nov that is 154.3 + 7.3 = 161.6. A difference of more than 1 mi means a visit or Trip is missing, and the Truck log says so.

## 4. Where Trips show in the screens that exist

No existing screen changes its job. Each gets a few new fields from the read it already makes.

| Screen (exists) | New | Read |
|---|---|---|
| Board → `AssignmentBlock` | Now, Done, "since 10:41", "4 loads" | `GET assignments?date=` gets `loads`, `lastTripAt` and `status` (`none`, `now`, `done`) |
| Driver view → `DriverCard` | "3 loads · last 11:25" | `GET drivers/:id/days/:date`; each `DriverAssignment` in `DriverDay` gets the same fields |
| Settings → Truck and Place panels | Already show "Linked to HCSS Fleet" and "On the truck map" | No change; add the list of unknown codes |
| Trip log (new, phase 3) | One Truck's Trips for a day, the NULL ones first | New read, e.g. `GET trucks/:id/days/:date/trips` |
| Truck log (phase 4) | Built from the Trips; the header (Driver, start and end time, miles, Total hours) is the Trip builder's `truckDay`, each Assignment's column (Job, Pick up, Drop off, Material, # of loads, # of tons, Trucking hours) its `assignments`, and the Trips for Dave its `unexplained`; shown in the Simulation | Phase 4 |

Proposed meaning of the Assignment states (proposal P5):
- **Now:** the Truck's latest Trip is linked to this Assignment, and the Truck has not gone back to the shop since.
- **Done:** a later Trip is linked to a different Assignment, or the Truck is back at the shop.
- **since:** the `left_at` of its first Trip that day.

The pages already read again when they come back into view. Data changes at most every 10 min, so no live connection is needed.

## 5. Proposals: changes to the agreed decisions

Each one needs agreement before phase 3 is built.

- **P1. Access to Fleet entry/exit.** The agreed source is refused (403). Ask HCSS for a supported way to read entry/exit (an API scope or a scheduled export). While waiting, run a one-day test of the public API at one call a minute, so adapter B is ready if HCSS says no. Nothing else in this doc depends on which adapter wins.
- **P2. Replace `fleet_events` with `fleet_visits`.** The data has no event id and gives enter and leave in one row:
  ```
  fleet_visits  id, truck_id, source fleet|poll, geofence_code NOT NULL DEFAULT '',
                place_id?, entered_at, exited_at?, entry_odometer, exit_odometer?,
                entry_hours, exit_hours?, fetched_at
                UNIQUE (truck_id, source, geofence_code, entered_at)
  ```
  Each pull updates a row in place until it closes. `geofence_code` is never NULL, because SQLite treats NULLs as different and the update would never match.
- **P3. One more pull at 4 AM** for the day before, so a Truck that comes back after 8 PM still gets its last Trip.
- **P4. Driver before phase 2 is live.** If phase 3 ships before Inspections, fill `driver_id` from the Assignment's Truck or "his own" Truck. Use `driver_from = dave` so it still shows as an answer for Dave to confirm.
- **P5. The meaning of Now and Done** in §4.

## Build order (each one a ticket)

1. **`buildTrips` with the 16 Nov fixture** (pure, no network): cleaning, Trips, matching with earlier versions, and the miles check. This needs no HCSS access and no phase 2. **Done as a first version:** `shared/trips.ts` (`buildTripDay`), tested in `shared/trips.test.ts` on `shared/trips.fixture.ts`, and run in the page at `/simulate` on Truck 55's real day, where it fills each Assignment's optional Trip part (`Assignment.trips` in `shared/types.ts`) that the real board block shows, and the Truck's day (`TripDay.truckDay`) that the Truck log's header shows (`src/components/TruckLog.tsx`), and below it one column per Assignment (its Job, `job`, from its Places, # of loads and Trucking hours) and the Trips no Assignment explains (`TripDay.unexplained`), in `src/components/TruckLogAssignments.tsx`. The Truck's day: **Driver** is the Driver whose Assignments that day name the Truck (an Assignment with no Truck names the Driver's usual one), otherwise the Driver whose usual Truck it is; more than one fits and nobody is chosen ("Who was driving?"), standing in for the phase 2 rule (whoever last inspected it). **Start time** is the earlier of the first ignition on and the first exit from the shop or yard. **End time**, while the day goes on, is known once the last Trip has ended at the shop or yard and the Truck is still there: that arrival, or a later ignition off; once the day is over (`dayOver`), it is wherever the Truck stopped: the later of its last arrival and its last ignition off, so a Truck parked at a job or plant still gets an end time and Total hours. **Start and end miles** are the meter readings around the day, the end one only once it was taken. **Total hours** run from start to end time. On 16 Nov: Randy, 06:19 to 16:12, 258,050.6 to 258,212.2 mi, 9.88 h.
2. **Migration** with `fleet_visits` (if P2 is agreed), `trips` and `meter_readings`. Also `POST trips/pull`, reading a fixture file in tests.
3. **Adapter A or B**, after P1: token cache, the scheduled pull, and a health read.
4. **New fields on the board and the Driver view**: loads, Now, Done.
5. **The Trip log**, then phase 4.
