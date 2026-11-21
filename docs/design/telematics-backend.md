# Telematics backend: from truck movements to the Driver's day (draft, 21 Nov 2026)

How the Worker collects truck movements, turns them into the Driver's day, and ties that day to Dave's Assignments. This covers pieces 3 (truck movements) and 5 (start and end miles) of `docs/design/system-design.html`, and the link to piece 1 (Assignments). Vocabulary: `GLOSSARY.md`; proposed new terms are at the end. It stays inside ADR 0001: one Worker and one D1 database, and nothing read from the hub's Supabase.

Status: draft for discussion, revised after an independent review against the raw data. The "Decisions needed" section must be settled before building.

## What the four sources showed (MCK-55-17, Mon 16 Nov 2026)

| Source | What it is | What we learned |
|---|---|---|
| Entry/exit JSON | HCSS Fleet's geofence visits: one row per entry into a Place, with UTC entry and exit times, entry and exit odometer and hour meter | **This alone is enough to build the day.** The `Result / Status: 5 / IsCompleted` envelope is a serialized .NET Task, the shape of Fleet's internal web endpoint, not the public API. That is the endpoint that refused our API login (403), so we can't count on this route yet. Entry and exit times fall exactly on ping times. |
| Entry/exit report (xlsx) | The same visits, exported later the same day, in local time | The JSON was taken at 15:02 ET. Its last row (J25008, entered 14:43) was still open and closed at 15:41:56 in the later export. An open row is **not** empty: `ExitDateTime` is null, but `ExitOdometer` and `Duration` hold the current values. **A visit is updated in place until it closes. Exit values on an open row are ignored.** |
| Ping history (xlsx) | One position every 61–62 s while the engine is on, and a `Check-In` every 6 h while parked, with events (`Ignition On`, `Idle Start`, `Ignition Off`) | Ignition on 06:19:40, off 16:12:45, 161.61 miles. **The speed field can't be trusted:** after 14:43 every ping says 0 mph, including the 22-minute drive home at about 50 mph. Movement must come from position and mileage, never from speed. |
| Supabase meter readings (csv) | The HeavyJob connector's snapshots from the **public** Telematics API (`GET /telematics/api/v1/equipment`): position, speed, engine status, odometer, hours, fuel | Access to the public API is **proven**. Each `reading_at` matches a ping exactly, so the API most likely returns the latest ping. But only one snapshot was taken while the truck was moving (38 s old); the others are the 6-hourly parked check-ins. **Whether it updates every minute is not yet proven** (see build step 0). The 16:01 reading (258,211.0, engine Active) fell mid-shift; the true end was 258,212.2 after ignition off. `fuel_used_gallons` was stuck at 241.3 for three days, so don't use it. |

Other details in the data that the design has to handle:

- **Pass-throughs.** `sunset` (no description, no group) was entered twice for 61 s each, with only one ping inside each time. It is a geofence the truck drives through, not a Stop.
- **Short exits.** J25008 07:02–07:13, then 07:15–08:24. In between, the truck really left: two pings about 400 m away at 27–30 mph. The day builder's 5-minute merge joins the two visits into one Stop; a stop detector would not, and shouldn't.
- **Midnight.** Fleet cuts visits at local midnight. A truck parked all day gets a 00:00–00:00 row (15 Nov), and a day starts with SHOP 00:00–06:24. A visit that starts at exactly 00:00 local means "already there when the day began", not an arrival. Days are built one date at a time and never joined across dates.
- **`CalculatedMiles` on a visit is the distance driven *inside* the geofence** (it equals exit minus entry odometer), not the distance of the leg. Leg miles = next entry odometer − this exit odometer.
- **Timestamps.** The JSON is true UTC (`12:02:03Z` = 07:02:03 ET). Dates are bucketed in US Eastern, like `GET today`.

### The day, cleaned (worked example)

Dropping visits under 2 minutes and merging repeat visits to the same Place within 5 minutes turns 18 rows into 15 Stops and 15 legs. The prototype ran on the JSON, and the last leg comes from the later export and the ping mileage.

```
SHOP      → J25008     06:24 → 07:02   20.6 mi
J25008    → VILLAGER   08:24 → 08:34    3.4 mi   ┐
VILLAGER  → J25008     08:43 → 08:56    3.6 mi   │ 4 round trips:
J25008    → VILLAGER   09:35 → 09:46    3.5 mi   │ long wait at the job (21–82 min),
VILLAGER  → J25008     09:50 → 10:00    3.2 mi   │ short stop at the plant (3–9 min)
J25008    → VILLAGER   10:27 → 10:38    3.4 mi   │
VILLAGER  → J25008     10:41 → 10:53    3.6 mi   │
J25008    → VILLAGER   11:14 → 11:25    3.4 mi   ┘
VILLAGER  → WALWDOLO   11:30 → 11:56   20.4 mi
WALWDOLO  → J25008     12:08 → 12:36   21.2 mi   ┐ 2 round trips from the dolomite plant
J25008    → WALWDOLO   12:54 → 13:18   21.2 mi   │ (11–12 min at the plant)
WALWDOLO  → J25008     13:29 → 13:54   21.2 mi   ┘
J25008    → J611       14:15 → 14:23    3.5 mi
J611      → J25008     14:33 → 14:43    3.7 mi
J25008    → SHOP       15:41 → 16:03   18.4 mi
```

**Which way the material went is a guess from the truck's data, not a fact.**
- **For loading at J25008 and dumping at Villager:** the truck waited 20–35 min in one spot at J25008, and its Villager stops were 3–9 min with almost no movement.
- **Against it:**
  - J25008 waits after the stone runs were just as long (18–21 min).
  - The glossary's own example has Villager as a pickup.
  - Drive times are the same in both directions.

The truck can't settle it, and it doesn't need to. **The Assignment's From → To decides the direction.** Suppose Dave's Assignments were A1 "J25008 → Villager" and A2 "Walworth → J25008". Then the rules in §4 give:
- 6 Loads: 4 on A1, 2 on A2.
- 4 Returns.
- 2 empty drives heading to load: Villager → Walworth and J611 → J25008.
- 2 shop legs.
- 1 unexplained leg, J25008 → J611. The Driver gets asked once about the J611 Stop.

That accounts for all 15 legs.

## Shape of the system

```
 HCSS Telematics API ─┐                          ┌─► Dave's board: live Load count per Assignment
 (public, 1/min)      │   ┌────────────┐         │
                      ├──►│ Stop source │──► telematics_visits ──► Day builder ──► stops, legs, truck_days
 HCSS Fleet entry/exit┘   └────────────┘         (raw, upserted)    (pure, re-run)        │
 (if access granted)                                     ▲                               └─► Driver's day: timeline,
                                         places, trucks, assignments ─┘                       Loads, blanks to answer
```

Everything runs in the existing Worker:

- `scheduled()` handler (Cron Trigger) for ingest and the nightly close-out.
- New D1 tables (below) in the same database.
- Secrets `HCSS_CLIENT_ID` and `HCSS_CLIENT_SECRET` (`wrangler secret put`, per environment). The bearer token (1 h) is cached in a D1 row so cron runs don't fetch a new one each minute.

### 1. Stop source: one seam, two adapters

The rest of the system only sees **visits**: `{ truck, geofenceCode, enteredAt, exitedAt?, entryOdometer, exitOdometer?, entryHours, exitHours? }`. Two adapters can produce them:

| | **A. Fleet entry/exit** | **B. Poll the public API, detect Stops ourselves** |
|---|---|---|
| Call | Fleet entry/exit for each truck, today, every 5 min | `GET /telematics/api/v1/equipment` (all trucks in one call) every minute, around the clock |
| Geofences | HCSS's own, the same ones Dave already sees | Ours, one shape per Place (see Decision 2) |
| Access | **Not granted.** Needs HCSS to give a client scope for Fleet reports, or a supported export | **Working today** (the meter-reading connector uses it); one-minute freshness still to prove |
| Missed calls | Harmless: the next call returns the whole day again | **Lost for good**: the API only gives the current position. A failed run can miss a 3-minute plant stop |
| Extra data | None | Raw positions, so ignition on/off and stops outside every Place (lunch, waiting) |

**Recommendation: prove B's freshness first (build step 0), then build B behind the seam, and add A if HCSS grants access.** B is the only route we can rely on today, and it also catches stops outside every geofence, which piece 4 needs.

**The replay test.** The review replayed the 16 Nov ping history through B's detector, with one radius per Place, and compared the result with the Fleet report:
- Every real Stop was found.
- Every entry and exit was within 62 s.
- Both `sunset` pass-throughs were rejected.
- Simulated polling (30 s lag, random jitter, 200 runs) stayed within 125 s.
- **The weak spot is missed runs.** With 2% of runs missed, 10 of 200 simulated days had an error, and the 3-minute Villager stop was lost once.

B's detector, per truck, for each new reading (counting distinct `reading_at` values only, so a ping seen twice is one sample):
1. **Find the Place.** Pick the one whose shape contains the position; if shapes overlap, pick the smallest.
2. **Entering** a Place opens a visit once 2 consecutive samples are inside. This rejects pass-throughs like `sunset`.
3. **Leaving** closes the visit once 2 consecutive samples are outside.
4. **Stopped outside every Place:** 3 or more consecutive samples (about 2 min) within 50 m of each other, judged by **position, not speed**, open an off-Place Stop. Its geofence is empty and its position is kept. On 16 Nov this finds exactly one, 06:29–06:38 on Route 104. These stops only appear on the Driver's timeline and are never counted as Loads. A new Place can be named from them.

Its state (the open visit and the last samples) is kept per truck in D1, so each cron run carries on from the last one.

**The health check judges freshness only while the engine is on.** A parked truck reports only every 6 h, and that is normal.

### 2. Raw store

Each visit has a surrogate `id`. A unique index on `(truck_id, source, geofence_code, entered_at)` makes re-fetching harmless; `geofence_code` is `''` for off-Place Stops, never NULL, because SQLite treats NULLs as distinct and the upsert would never match. An open visit is updated when it closes. Positions (B only) are kept 60 days: about 6 trucks × 600 readings per working day, plus check-ins.

### 3. Day builder (pure)

`buildDay(visits, places, assignments, truck, date) → { stops, legs, totals }`. It doesn't do I/O, so it is tested against the 16 Nov fixture directly. It runs after an ingest that changed that truck's visits, after any Assignment change on that date, and once in the nightly close-out.

**One source per truck-day.** Use Fleet (A) visits if that source covered the day; otherwise use the polled ones (B). The source is recorded on `truck_days`. The two sources are never mixed in one day.

Steps:
1. **Clean.** Drop visits under 2 min. Merge visits to the same Place with a gap of 5 min or less. A visit starting at 00:00 local is the day's starting position, not an arrival. (Thresholds are constants, tuned on fixtures.)
2. **Map to Places.** Match `geofence_code` to `places.geofence_code`. An unknown code stays on the Stop by its raw name and appears in a Settings list "Geofences with no Place" so Dave can map it once. Job-site codes start with the job number (`J25008 …`), so a new one can be suggested with its Job filled in.
3. **Pair into legs.** Each leg runs from one Stop's exit to the next Stop's entry, with miles from the odometers.
4. **Match legs to Assignments** (§4).
5. **Day totals.**
   - **Start odometer:** the reading at the first ignition on.
   - **End odometer:** the reading after the last ignition off.
   - **Check:** day miles must equal leg miles plus miles driven inside Stops; on 16 Nov that is 154.3 + 7.3 = 161.6. A gap of more than 1 mi is flagged: a Stop or leg was missed.

### 4. Matching legs to Assignments

**Candidates.** The Assignments on that date of the truck-day's Driver (§5), whatever Truck is written on them. When no Driver is known, the Assignments with this Truck. This way a truck swap doesn't send Loads to the wrong day.

**Rules.** For each leg A → B, the first rule that fits wins. If two Assignments fit at the same rule, the leg is **Ambiguous**: a blank for the Driver to choose. The rules never guess silently.

| # | Rule | Leg becomes |
|---|---|---|
| 1 | An Assignment has From = A and To = B | **Load** for that Assignment |
| 2 | An Assignment has From = B and To = A | **Return** (empty), linked to it |
| 3 | A or B is the shop or a yard | **To/from shop** |
| 4 | B is the From of an Assignment | **Empty, heading to load**, linked to it |
| 5 | An Assignment has From = A and To blank | **Load** for that Assignment |
| 6 | An Assignment has To = B and From blank, and A is a plant | **Load** for that Assignment |
| 7 | Nothing fits | **Unexplained** |

Rules 2–4 come before the partial rules 5–6 on purpose. Otherwise, with To blank, the drive to the shop and the run to the next plant would count as Loads. With From blank, the empty returns would count as Loads too.

**Two kinds of work the rules can't see:**
- **An Assignment whose From and To are the same Place** (e.g. moving material within a site) never produces a leg. Its Loads come from tickets or the Driver.
- **A dump at a spot with no geofence** shows only as an off-Place Stop. It isn't counted.

**Blanks are asked once per Stop**, not once per leg. "What was the stop at J611 at 14:23?" covers both legs.

A Load stays **suggested** until a ticket (piece 6) or the Driver confirms it. Arriving at a Place doesn't prove a delivery.

### 5. Which Driver a truck-day belongs to

The truck can't tell who is driving. In order:
1. **Confirmed:** the Driver confirmed this Truck in the app (piece 2, later).
2. **From the Assignments:** the Driver on that day's Assignments with this Truck.
3. **Usual Truck:** the Driver whose usual Truck it is.

If two Drivers have Assignments on the same Truck that day, the day is flagged and nothing is assigned. A Driver can have two truck-days (a swap mid-day). The Driver's day shows them together and is signed once.

### 6. Answers and sign-off

The Driver's answers live apart from the derived legs and Stops, which are rebuilt freely. Examples are which Assignment a leg belongs to, a material, "lunch", "waiting", or a note.

**Keeping answers through a rebuild.** Each answer has its own id and stores what it was about: the truck, the date, the from and to Places (or the Stop's Place), and the time. A rebuild can shift times by a ping (about 61 s), merge visits, or switch source. After each rebuild, an answer re-attaches to the leg or Stop on the same truck-day with the same Places, starting within 10 minutes. An answer that finds nothing is shown again as "needs a re-check" and is never dropped.

**Sign-off.** Once the Driver signs the day, the builder stops rewriting it. A visit that arrives late is flagged, not merged.

## Schema (new migration, add-only)

```
places               + boundary_json TEXT                        -- polygon (or centre + radius) for adapter B
                                                                 -- geofence_code already exists

telematics_visits    id PK, truck_id, source ('fleet'|'poll'), geofence_code NOT NULL DEFAULT '',
                     place_id?, entered_at, exited_at?, entry_odometer, exit_odometer?,
                     entry_hours, exit_hours?, latitude?, longitude?, fetched_at
                     UNIQUE (truck_id, source, geofence_code, entered_at)

telematics_positions truck_id, reading_at, latitude, longitude, engine_on, odometer, hour_meter
                     PK (truck_id, reading_at)                       -- 60-day retention; speed not stored

detector_state       truck_id PK, state_json, updated_at             -- B's open visit per truck

truck_days           truck_id, date, source ('fleet'|'poll'), driver_id?,
                     driver_source ('confirmed'|'assignment'|'usual'|'conflict'),
                     start_odometer?, end_odometer?, first_ignition_on?, last_ignition_off?,
                     day_miles?, leg_miles?, stop_miles?, status ('live'|'closed'|'signed'), built_at
                     PK (truck_id, date)

stops                truck_id, date, seq, place_id?, geofence_code, latitude?, longitude?,
                     arrived_at, left_at?, minutes                   PK (truck_id, date, seq)
legs                 truck_id, date, seq, departed_at, arrived_at, from_stop_seq, to_stop_seq, miles,
                     kind ('load'|'return'|'shop'|'to_load'|'unexplained'|'ambiguous'),
                     assignment_id?, confirmed INTEGER                PK (truck_id, date, seq)

answers              id PK, driver_id, truck_id, date, target ('leg'|'stop'),
                     from_place_id?, to_place_id?, place_id?, at,     -- what it was about, for re-attaching
                     assignment_id?, material_id?, label?, note?, answered_at

driver_signoffs      driver_id, date, signed_at                       PK (driver_id, date)
ingest_runs          id, source, started_at, finished_at?, ok, trucks, visits_changed, error?
hcss_token           id = 1, access_token, expires_at
```

The existing `trucks.hcss_guid` links a Truck to HCSS `EquipmentId`. MCK-55-17's is `4f58019f-…`.

## API additions

| Route | Answer |
|---|---|
| `GET days?date=&driverId=` (or `&truckId=`) | The Driver's day: `{ truckDays, stops, legs, assignments: [{ id, …, loads, returns }], blanks }` |
| `GET assignments?date=` | Same as now, plus `loads` and `lastLoadAt` per Assignment, so the board shows "J25008 → Villager · 4 loads" |
| `PUT days/:driverId/:date/answers/:id` | Saves one answer. 409 once the day is signed |
| `POST days/:driverId/:date/sign` | Driver signs every truck-day they had that date |
| `GET telematics/health` | Last run per source, data age per truck while its engine is on, unmapped geofences |
| `POST telematics/run` | Runs ingest now (staging and testing). Cloudflare Access only |

## Schedule

`wrangler.jsonc` → `triggers.crons`. Cron runs in UTC; Eastern dates are computed in code.

| Cron | Does |
|---|---|
| `* * * * *` | B polls all trucks around the clock: one call a minute for the whole fleet, so early starts and late returns land on the right date. A truck-day is rebuilt only when its visits changed. (A, if enabled: every 5th minute.) |
| `30 8 * * *` (03:30 ET in winter, 04:30 in summer) | Close-out of yesterday: final build, end odometer after the last ignition off, miles check, status → `closed`. Delete positions older than 60 days. |

Failures: each run writes `ingest_runs`. A 401 refreshes the token once; a 403 or 429 backs off and is reported by `telematics/health`. Ingest never touches Assignments.

## Proposed glossary terms

The glossary says a Load is never a "trip", so these terms keep the pieces apart:

- **Stop**: one stay of a Truck at a Place (or at an unknown spot) from arrival to leaving, after cleaning. _Avoid_: visit (that is the raw telematics row), geofence entry.
- **Leg**: the drive from one Stop to the next. It is a Load, a return, a drive to or from the shop, an empty drive to the next pickup, or unexplained. _Avoid_: trip.
- **Load** (already defined): a Leg that carried material, counted for an Assignment.
- **Truck Day**: everything one Truck did on one day (US Eastern), with the Driver it belongs to. It becomes the truck log.

## Decisions needed

1. **Stop source.** Build B (poll the public API, our own geofences) first, as recommended, or first ask HCSS for supported access to Fleet entry/exit (A)? How was the JSON pulled: with an API client, or from the browser?
2. **Geofence shapes for B.** The replay showed that one typed radius per Place isn't good enough:
   - At 150 m, Walworth's 12-minute visits shrink to 2 min, because pings inside the plant spread up to 400 m from its centre.
   - At 250 m, Villager exits are 4 min late.
   - At J611, the furthest ping inside and the nearest ping outside are 3 m apart (190 m vs 187 m).

   Options: copy HCSS's polygons once (if Fleet can export them), draw them on a map in Settings, or derive them from Fleet visits.
3. **Who sees the day first.** Dave's board with live Load counts, or the Driver's own day view (pieces 2 and 4, which needs a Driver login)?
4. **The meter-reading connector in the hub.** Leave it running. This Worker takes its own odometer readings and doesn't read Supabase (ADR 0001). Agree?

## Build order (each one a ticket)

0. **Spike:** poll the public API once a minute for one working day. Store what comes back and check that positions really change every minute while a truck moves. B depends on this.
1. Day builder plus the 16 Nov fixture (pure, no network): Stops, legs, matching and the miles check, tested on the real day above, with the Assignment sets the review used.
2. Migration and visit store with upsert; `POST telematics/run` reading a fixture file in tests.
3. Adapter B: token cache, poll, detector, cron, health, plus the replay test from the ping history against the entry/exit report (tolerance 2 min).
4. Place shapes in Settings; the "Geofences with no Place" list.
5. Load counts on the board.
6. Driver's day view, answers, sign-off.
7. Adapter A, if HCSS grants access.
