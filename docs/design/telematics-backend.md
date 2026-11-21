# Telematics backend: from truck movements to the Driver's day (draft, 21 Nov 2026)

How the Worker collects truck movements, turns them into the Driver's day, and ties that day to Dave's Assignments. This covers pieces 3 (truck movements) and 5 (start and end miles) of `docs/design/system-design.html`, and the link to piece 1 (Assignments). Vocabulary: `GLOSSARY.md`; proposed new terms are at the end. It stays inside ADR 0001: one Worker and one D1 database, and nothing read from the hub's Supabase.

Status: draft for discussion. The "Decisions needed" section must be settled before building.

## What the four sources showed (MCK-55-17, Mon 16 Nov 2026)

| Source | What it is | What we learned |
|---|---|---|
| Entry/exit JSON | HCSS Fleet's geofence visits: one row per entry into a Place, with UTC entry and exit times, entry and exit odometer and hour meter | **This alone is enough to build the day.** The `Result / Status: 5 / IsCompleted` envelope is a serialized .NET Task, the shape of Fleet's internal web endpoint, not the public API. That is the endpoint that refused our API login (403), so we can't count on this route yet. |
| Entry/exit report (xlsx) | The same visits, exported later the same day, in local time | The JSON was taken at 15:02 ET. Its last row (J25008, entered 14:43) had `ExitDateTime: null` and closed at 15:41 in the later export. **A visit is open until the truck leaves, so we must update visits in place, keyed by truck + geofence + entry time.** |
| Ping history (xlsx) | One position about every 61 s, with events (`Ignition On`, `Idle Start`, `Ignition Off`, `Check-In`) | Ignition on 06:19:40, off 16:12:45, 161.61 miles for the day. This is the raw material to detect Stops ourselves if Fleet visits stay closed to us. Plant stops can be as short as 3 minutes, so we would need to poll about once a minute. |
| Supabase meter readings (csv) | The HeavyJob connector's snapshots from the **public** Telematics API (`GET /telematics/api/v1/equipment`): position, speed, engine status, odometer, hours, fuel | Access to the public API is **proven** and its data is fresh: the reading was 38 s old when collected. The 16:01 ET reading (258,211.0, engine Active) fell mid-shift, and the true end was 258,212.2 after ignition off. **The end-of-day odometer has to come from after the last ignition off, not from a clock time.** `fuel_used_gallons` was stuck at 241.3 for three days, so don't use it. |

Other details in the data that the design has to handle:

- **Pass-throughs.** `sunset` (no description, no group) was entered twice for 61 s each. It is a geofence the truck drives through, not a Stop.
- **Boundary flicker.** J25008 07:02–07:13, then 07:15–08:24. That is one Stop split in two by a 2-minute gap.
- **Midnight split.** Fleet cuts a visit at local midnight (SHOP 00:00–06:24). Treat it as the same Stop continuing.
- **`CalculatedMiles` on a visit is the distance driven *inside* the geofence**, not the distance of the leg. Leg miles = next entry odometer − this exit odometer.
- **Timestamps.** The JSON is true UTC (`12:02:03Z` = 07:02:03 ET). Dates are bucketed in US Eastern, like `GET today`.

### The day, cleaned (worked example)

Dropping visits under 2 minutes and merging repeat visits to the same Place within 5 minutes turns 18 rows into 15 Stops and 14 legs (prototype run on the JSON):

```
SHOP      → J25008     06:24 → 07:02   20.6 mi
J25008    → VILLAGER   08:24 → 08:34    3.4 mi   ┐
VILLAGER  → J25008     08:43 → 08:56    3.6 mi   │ 4 round trips:
J25008    → VILLAGER   09:35 → 09:46    3.5 mi   │ long wait at the job (21–82 min),
VILLAGER  → J25008     09:50 → 10:00    3.2 mi   │ short stop at the plant (3–9 min)
J25008    → VILLAGER   10:27 → 10:38    3.4 mi   │ → loading at J25008, dumping at Villager
VILLAGER  → J25008     10:41 → 10:53    3.6 mi   │
J25008    → VILLAGER   11:14 → 11:25    3.4 mi   ┘
VILLAGER  → WALWDOLO   11:30 → 11:56   20.4 mi     reposition, empty
WALWDOLO  → J25008     12:08 → 12:36   21.2 mi   ┐ 2 loads from the dolomite plant
J25008    → WALWDOLO   12:54 → 13:18   21.2 mi   │
WALWDOLO  → J25008     13:29 → 13:54   21.2 mi   ┘
J25008    → J611       14:15 → 14:23    3.5 mi     ? no Assignment would explain this
J611      → J25008     14:33 → 14:43    3.7 mi
J25008    → SHOP       15:41 → 16:03               (from the later export)
```

**The truck can't tell which way a Load went. The Assignment can.** By position alone, J25008 → VILLAGER and VILLAGER → J25008 look the same. If Dave's Assignments that day were "J25008 → Villager · dirt" and "Walworth → J25008 · stone", the 4 + 2 legs that match them are Loads, the reverse legs are returns, and the J611 visit is the one blank the Driver gets asked about. That is how telematics connects to the Assignment.

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
| Call | Fleet entry/exit for each truck, today, every 5 min | `GET /telematics/api/v1/equipment` (all trucks in one call) every minute, 05:00–19:00 ET |
| Geofences | HCSS's own, the same ones Dave already sees | Ours: a centre and radius on each Place (polygons later if needed) |
| Access | **Not granted.** Needs HCSS to give a client scope for Fleet reports, or a supported export | **Working today** (the meter-reading connector uses it) |
| Accuracy | As good as Fleet | Limited by the poll interval. A 3-minute plant stop is 2–3 samples, enough with a 2-sample minimum |
| Extra data | None | Raw positions, so ignition on/off and unexplained stops outside any Place (lunch, waiting) |

**Recommendation: build B first, behind the seam, and add A if HCSS grants access.** B is the only route we can rely on today, and it also catches stops outside every geofence, which piece 4 needs. The 16 Nov exports are the test fixture: replay the ping history through B's detector and compare the result to the entry/exit report for the same day. They should agree to within a minute on every Stop at a known Place.

B's detector, per truck, for each new position:
1. Find which Place, if any, the position is inside (distance to centre ≤ radius).
2. Entering a Place opens a visit; it needs 2 consecutive samples inside, which filters out pass-throughs like `sunset`.
3. Leaving closes it; it needs 2 consecutive samples outside, which absorbs boundary flicker.
4. Speed 0 for ≥ 5 min outside every Place opens an **off-Place Stop** (geofence code null, position kept). A new Place can be named from these.

Its state (the open visit and the last samples) is kept per truck in D1, so each cron run carries on from the last one.

### 2. Raw store

Visits are upserted on `(truck_id, source, geofence_code, entered_at)`, so re-fetching the same day is harmless and an open visit is updated when it closes. Positions (B only) are kept 60 days, roughly 6 trucks × 840 per day ≈ 5,000 rows a day.

### 3. Day builder (pure)

`buildDay(visits, places, assignments, truck, date) → { stops, legs, totals }`. It doesn't do I/O, so it is tested against the 16 Nov fixture directly. It runs after every ingest that changed that truck's day, after every Assignment change on that date, and once in the nightly close-out. Each run replaces the stored `stops` and `legs` for that truck-day.

Steps:
1. **Clean.** Drop visits under 2 min. Merge visits to the same Place with a gap of 5 min or less. Join the midnight split. (Thresholds are constants, tuned on fixtures.)
2. **Map to Places.** Match `geofence_code` to `places.geofence_code`. An unknown code stays on the Stop by its raw name and appears in a Settings list "Geofences with no Place" so Dave can map it once. Job-site codes start with the job number (`J25008 …`), so a new one can be suggested with its Job filled in.
3. **Pair into legs.** Each leg runs from one Stop's exit to the next Stop's entry, with miles from the odometers.
4. **Match legs to Assignments** (next section).
5. **Day totals.** Start odometer = the reading at the first ignition on (or the SHOP exit). End odometer = the reading after the last ignition off. Day miles are checked against the sum of leg miles; a gap of more than 3 mi is flagged ("some movement was missed").

### 4. Matching legs to Assignments

Candidates: Assignments on that date whose Truck is this truck, or, when an Assignment has no Truck, whose Driver normally drives this truck.

For each leg A → B, in this order:

| Rule | Leg becomes |
|---|---|
| An Assignment has From = A and To = B | **Load** for that Assignment |
| An Assignment has only To = B (From blank) and A is a plant | **Load** for that Assignment |
| An Assignment has only From = A (To blank) | **Load** for that Assignment |
| An Assignment has From = B and To = A (the reverse) | **Return** (empty), linked to that Assignment |
| A or B is the shop or a yard, and no rule above applies | **To/from shop** |
| Nothing fits | **Unexplained**, a blank for the Driver |

If two Assignments both fit a leg, pick neither and mark it **Ambiguous**: a blank for the Driver to choose. Rules never guess silently.

A Load stays **suggested** until a ticket (piece 6) or the Driver confirms it. Arriving at a Place doesn't prove a delivery.

### 5. Which Driver a truck-day belongs to

The truck can't tell who is driving. Until the Driver app confirms it (piece 2), the truck-day belongs to:
1. the Driver on that day's Assignments with this Truck, or else
2. the Driver whose usual Truck it is.

If two Drivers have Assignments on the same Truck that day, the day is flagged and nothing is assigned.

### 6. Answers and sign-off

The Driver's answers (which Assignment a blank leg belongs to, a material, "lunch", "waiting", a note) are stored apart from the derived legs. Each is keyed by a stable leg key `truck_id + departed_at`, so rebuilding the day doesn't lose them. Once the Driver signs the day, the builder stops rewriting it. A late visit after sign-off is flagged, not merged.

## Schema (new migration, add-only)

```
places               + latitude REAL, longitude REAL, radius_m INTEGER        -- B's geofences; geofence_code already exists

telematics_visits    truck_id, source ('fleet'|'poll'), geofence_code?, place_id?,
                     entered_at, exited_at?, entry_odometer, exit_odometer?,
                     entry_hours, exit_hours?, latitude?, longitude?, fetched_at
                     PK (truck_id, source, geofence_code, entered_at)

telematics_positions truck_id, reading_at, latitude, longitude, speed_mph, engine_on,
                     odometer, hour_meter                PK (truck_id, reading_at)   -- 60-day retention

detector_state       truck_id PK, state_json, updated_at                          -- B's open visit per truck

truck_days           truck_id, date, driver_id?, driver_source ('assignment'|'usual'|'confirmed'|'conflict'),
                     start_odometer?, end_odometer?, first_ignition_on?, last_ignition_off?,
                     day_miles?, leg_miles?, status ('live'|'closed'|'signed'), built_at
                     PK (truck_id, date)

stops                truck_id, date, seq, place_id?, geofence_code?, arrived_at, left_at?, minutes
legs                 truck_id, date, departed_at, arrived_at, from_stop_seq, to_stop_seq, miles,
                     kind ('load'|'return'|'shop'|'unexplained'|'ambiguous'),
                     assignment_id?, confirmed INTEGER          PK (truck_id, departed_at)

leg_answers          truck_id, departed_at, assignment_id?, material_id?, label?, note?,
                     answered_by_driver_id, answered_at          PK (truck_id, departed_at)

ingest_runs          id, source, started_at, finished_at?, ok, trucks, visits_changed, error?
hcss_token           id = 1, access_token, expires_at
```

The existing `trucks.hcss_guid` links a Truck to HCSS `EquipmentId`. MCK-55-17's is `4f58019f-…`.

## API additions

| Route | Answer |
|---|---|
| `GET days?date=&driverId=` (or `&truckId=`) | The Driver's day: `{ truckDay, stops, legs, assignments: [{ id, …, loads, returns }], blanks }` |
| `GET assignments?date=` | Same as now, plus `loads` and `lastLoadAt` per Assignment, so the board shows "J25008 → Villager · dirt · 4 loads" |
| `PUT days/:truckId/:date/legs/:departedAt/answer` | Saves one answer. 409 once the day is signed |
| `POST days/:truckId/:date/sign` | Driver signs; status → `signed` |
| `GET telematics/health` | Last run per source, the age of the newest data per truck, unmapped geofences |
| `POST telematics/run` | Runs ingest now (staging and testing). Cloudflare Access only |

## Schedule

`wrangler.jsonc` → `triggers.crons`. Cron runs in UTC, so the Worker checks the Eastern hour itself and returns early outside working hours.

| Cron | Does |
|---|---|
| `* * * * *` | Within 05:00–19:00 ET: B polls all trucks, updates visits, rebuilds changed truck-days. (A, if enabled: every 5th minute.) |
| `30 8 * * *` (03:30 ET in winter, 04:30 in summer) | Close-out of yesterday: final fetch, final build, end odometer after the last ignition off, day-vs-leg miles check, status → `closed`. Delete positions older than 60 days. |

Failures: each run writes `ingest_runs`. A 401 refreshes the token once; a 403 or 429 backs off and is reported by `telematics/health`. Ingest never touches Assignments.

## Proposed glossary terms

The glossary says a Load is never a "trip", so these terms keep the pieces apart:

- **Stop**: one stay of a Truck at a Place (or at an unknown spot) from arrival to leaving, after cleaning. _Avoid_: visit (that is the raw telematics row), geofence entry.
- **Leg**: the drive from one Stop to the next. It is a Load, a return, a run to or from the shop, or unexplained. _Avoid_: trip, run.
- **Load** (already defined): a Leg that carried material, counted for an Assignment.
- **Truck Day**: everything one Truck did on one day (US Eastern), with the Driver it belongs to. It becomes the truck log.

## Decisions needed

1. **Stop source.** Build B (poll the public API, our own geofences) first, as recommended? Or first ask HCSS for supported access to Fleet entry/exit (A)? How was the JSON pulled: with an API client, or from the browser?
2. **Geofence shapes for B.** A centre and radius per Place typed in Settings (simple, and the plant geofences are small), or copy HCSS's polygons once?
3. **Who sees the day first.** Dave's board with live Load counts, or the Driver's own day view (piece 2 and 4, which needs a Driver login)?
4. **The meter-reading connector in the hub.** Leave it running. This Worker takes its own odometer readings and doesn't read Supabase (ADR 0001). Agree?

## Build order (each one a ticket)

1. Day builder plus the 16 Nov fixture (pure, no network): Stops, legs and matching, tested on the real day above.
2. Migration and visit store with upsert; `POST telematics/run` reading a fixture file in tests.
3. Adapter B: token cache, poll, detector, cron, health, plus a replay test from the ping history against the entry/exit report.
4. Place centre and radius in Settings; the "Geofences with no Place" list.
5. Load counts on the board.
6. Driver's day view, answers, sign-off.
7. Adapter A, if HCSS grants access.
