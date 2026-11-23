# Design decisions

Why the app works the way it does, from the design grillings of 19, 21 and 22 Nov 2026 (earlier versions of this file are in git history). It holds the reasons, not the behaviour:

- What the app does today: [`../how-it-works.md`](../how-it-works.md). The API: [`../api.md`](../api.md).
- What gets built, and in what order: [`../specs/roadmap.md`](../specs/roadmap.md).
- Hard-to-reverse choices: [`../adr/`](../adr/). Words: [`../../GLOSSARY.md`](../../GLOSSARY.md).

Sources: the "Trucking page · 5 design mocks" export, page **Final · scheduler, driver, settings** (F1 scheduler, F2 driver, F3 settings), plus the flow map (20 Nov), the trip log, and the pipeline map in [`system-design.html`](system-design.html).

## Phase 1: planning (built)

### The app
- **Its own app** with its own Worker and D1, on the Hub's stack and tokens (ADR 0001, ADR 0002). The Hub's Dispatch page and its `dispatch_orders` data are left alone, and nothing is migrated.
- **Served under `/truck-dispatch/`** from the start, so joining the Hub later is one forwarding function. There is no login yet; Hub integration waits until staging works fully.
- **Testing without Drivers.** During the build no Driver gets Cloudflare Access; Sumanth tests both the Scheduler and the Driver view.

### Assignments
- **Words.** The UI says "assignment" for the work and "job" only for a Job with a job number, even where the mocks say "job".
- **Only the date is required**, and there is an Unassigned lane, so Dave can write work down before he knows who will do it.
- **One Assignment, one Driver, many Loads.** Dave never enters a load count; Loads come from Trips and Tickets. There are no fields for billing, status, quantity or start time. A lowboy move is an ordinary Assignment with a note and no Material.
- **Order, not progress.** Neither Dave nor the Driver marks Start or Finished, and the board shows no Now, "since", Busy or Free. Progress will come only from the Truck (phase 3), so the board never claims to know what it cannot. The mocks' Start now / Finished buttons are deliberately not built.
- **A Truck only when it matters.** An Assignment names a Truck only when the work needs a certain one; blank means "his own".
- **Foreman per Assignment**, because the person running a job changes from day to day. A job-site Place's usual Foreman fills it in: the drop-off's if it is a job site, otherwise the pick-up's.
- **Typed names become list entries** on save. A name that matches an entry, ignoring case, uses it (bringing a removed one back). A new Place shows "Not on the truck map yet" until it has an HCSS boundary.
- **Lists in Dave's own order** (▲▼), because chips and lanes should follow how he thinks, not the alphabet. New and revived entries go last.
- **Nothing is deleted.** Entries are made inactive. A removed Driver keeps a lane on any day he has work, and Remove warns how many later days still have his work.
- **Saves are per field**, so one tap saves one thing. If two people change the same field, the last save wins.

### Days and Send
- **Days work as in the Daily Schedule** (`Schrex/daily-schedule`, `docs/specs/week-strip.md`): a week strip, arrows that skip weekends and Holidays, and the Board opening on the next Working day. The behaviour is the same, built in this app's stack.
- **Past days are enforced by the Worker** in US Eastern (ADR 0004), not by a lock in the page.
- **Send per day, with no lock after it** (ADR 0003), because trucking changes Sent days all day. Send has no warnings for now.
- **✕ deletes on a Draft day and cancels on a Sent day**, so a Driver who has seen an Assignment sees it cancelled rather than gone. A cancelled one stays in its lane until it is Put back.
- **Giving work to another Driver after Send** cancels it for the first Driver and adds it for the second, so each Driver sees what happened to his own day.
- **Changed and Added.** A field change, a cancel, a Put back, or its own move in the order, after the Send, counts as Changed. Neighbours that shift because of a move are not Changed, so no Driver is told about a change that is not his.
- **Earlier versions are kept** (add-only) from the Send onwards. The Driver sees "was Cobblestone", and phase 3 can match Trips made before a reroute.
- **An Assignment's day is fixed.** Work moves between days only by Start from, Copy to and ✕, so it never vanishes from a day without a trace.
- **Start from replaced Copy today**, which was wrong on a Monday. A copy lists the columns it copies rather than the ones it skips, so a column added later is never copied by accident. It drops notes, cancelled Assignments and removed entries.

### Driver view
- **Scheduler | Driver toggle** until the Hub's sign-in. The device remembers the Driver and the view, and nothing is saved in the database. Anyone can switch to Scheduler until sign-in exists.
- **Any day is reachable** (22 Nov): Yesterday, Today and Tomorrow tabs, ‹ › to step day by day, and "Next from Dave". Dave plans weekends too, and on the preview a Sent Monday was out of reach on a Saturday with calendar-day tabs alone.
- **"Not you?" became "← Drivers"** (22 Nov), a plain way back to the list of Drivers.

### After trying it on staging (22 Nov)
- **Send stays the gate.** Randy's Monday did not show because it was still a Draft. The Board now says so on a Draft day.
- **The composer folds on Save** but keeps the Places and Material for the next **+**.
- **Settings says nothing about HCSS on a Truck.** Its code and id stay in the data for Trips later. A Place still shows "On the truck map" (open question).
- **First** is the first Assignment that is not cancelled, and the day's count leaves cancelled ones out.

## Phases 2 to 4: decided, not built

### Check-in (phase 2)
- **The Inspection is the official record.** It is append-only, item by item, with repairs, Driver, Truck and time. A sign-off is its own signed row, and a fix adds a new version. To confirm with whoever owns DOT compliance.
- **The Inspection checklist** is a list in Settings (add, rename, reorder, inactive, optional). Each item is answered OK, Needs repair or N/A, and an Inspection keeps each item's wording. There are no truck types.
- **Needs repair opens a Truck problem**, shown on the Driver's lane and on that Truck in the composer until Dave marks it fixed. The app never grounds a Truck (to confirm with DOT compliance). No Slack or texts.
- **The Driver's phone shows the Truck he checked in to**; the scheduler keeps showing his usual Truck in grey.

### Trips (phase 3)
- **Trips come from HCSS Fleet** place enter/leave events, pulled by the Worker every 10 minutes from 4 AM to 8 PM Eastern, kept raw and paired into Trips.
- **The Driver of a Trip** is whoever last inspected that Truck before it. A Trip from an Assignment's From to its To is a Load; the way back is empty.
- **Now, Done and "since"** on the Board are worked out from Trips, not stored.
- **Miles and engine hours** are the 4 AM HCSS Fleet readings around the day, read with this app's own token and stored per Truck.

### Tickets and sign-off (phase 4)
- **Tickets are a photo** (R2) on a Load, with ticket number, quantity and unit left empty for reading later, from the photo or Jeri's stone matching. The Driver never types numbers.
- **Who answers the trip log.** At sign-off, the Driver puts each Ticket on its Load and confirms his Trips. Next morning, Dave answers the rest: Trips with no Assignment (make one, link one, or mark it not a haul), "Who was driving?", and Assignments with no Trips. The day is finished when both have answered.
- **The finished day** is a read-only Truck log page per Truck per day, plus CSV. After 9 AM the next day the Driver's part is locked. Pushing to HeavyJob or payroll is a later decision.

### Later
- **Week view** (Drivers by Monday to Friday, read-only, for the iPad).
- **Same people in two apps.** The Daily Schedule already has these Drivers (Crew Type Trucking), Off Work, Jobs and Foremen. The apps stay separate (ADR 0001); once both are in the Hub, trucking should read the Daily Schedule's Sent day and grey out Drivers who are Off Work.

## Target schema, phases 2 to 4

Phase 1's tables are in `migrations/`. Everything below is added later (migrations only add). The unused `orders` table is dropped in a later release.

### Phase 2: check-in
```
inspection_items   id, label, optional 0/1, sort_order, active
inspections        id, date, driver_id, truck_id, done_at          append-only
inspection_answers inspection_id, position, item_id, label (copied), answer ok|repair|na, repair_note
truck_problems     id, truck_id, reported_by_driver_id, reported_at, text,
                   inspection_id? (when it came from an Inspection), fixed_at?, fixed_note?
```

### Phase 3: trips
```
fleet_events    id, truck_id, hcss_event_id UNIQUE, geofence_code, place_id?, kind enter|leave, at, odometer?   raw
trips           id, truck_id, date, from_place_id?, to_place_id?, left_at, arrived_at, miles?,
                driver_id?, driver_from inspection|dave,
                assignment_id?, kind load|empty|not_a_haul|NULL, answered_at?
meter_readings  truck_id, read_at, odometer, engine_hours   PK (truck_id, read_at)
```

### Phase 4: tickets and sign-off
```
tickets    id, date, driver_id, truck_id, trip_id? (its Load), photo_key (R2), taken_at,
           ticket_number?, quantity?, unit?, read_by photo|stone_matching|NULL
sign_offs  id, date, truck_id, who driver|dave, driver_id?, repairs?, signed_at, version   append-only; latest version counts, Driver's locks 9 AM next day
```
The Truck log is a page built from these tables; it has no table of its own.
