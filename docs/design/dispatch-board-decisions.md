# Dispatch board: design decisions (grilling, 19 Nov 2026)

Outcome of a design grilling held in another folder (Truck Log Automation) and brought here. Vocabulary: `GLOSSARY.md`. Architecture decisions: `docs/adr/0001`, `docs/adr/0002`, [`docs/adr/0003`](../adr/0003-send-per-day-without-a-lock.md) (Send without a lock), [`docs/adr/0004`](../adr/0004-past-days-are-enforced-by-the-worker.md) (past days enforced by the Worker). Truck-log pipeline context: `docs/design/system-design.html`, `docs/design/pipeline-map.html`.

## The problem

Every evening Dave posts the next day's work for the Drivers (Randy, Nate, Scott) in Slack #trucks. The posts are loose: a driver, a foreman or site ("Brody at TIUNY"), sometimes a material, sometimes a machine number. They have no quantities and no job numbers, and nobody confirms the work was done. Changes are made by phone.

## Decisions

### App and stack
- A separate app with its own Worker and D1 database, not the hub's Dispatch page (ADR 0001). The hub's Dispatch and its `dispatch_orders` data are left as they are; nothing is migrated.
- Same front-end stack and design tokens as the hub (ADR 0002). Light mode only.
- No bottom nav. The page header follows the hub's style: a "← Hub" link, then an Oswald uppercase title with the date as subtitle.
- Built for its own base path from the start, so plugging into the hub later is one forwarding function.
- No login or roles yet: everyone can see everything. Hub integration waits until staging works fully.
- No Slack sending for now.

### Board
- Opens on tomorrow. The date bar has ‹ › arrows, a "Jump to" date input, and **Copy today**.
- **Copy today** copies driver, truck, from, to, material and foreman, and drops notes.
- One card per Driver. Each Assignment appears as a short line, e.g. "Villager → TIUNY · 2" minus".
- Adding or editing an Assignment opens a Dialog. Pickers are plain shadcn Selects.
- Today and future days are editable; only the latest version is kept, with no history. Past days are read-only.

### Assignment
- One Assignment belongs to one Driver. Two drivers doing the same work means two Assignments, with a "duplicate to…" action.
- One Assignment covers many Loads. Dave never enters a load count; it comes later from GPS and tickets.
- The only required field is the date. Everything else is optional:
  - Driver
  - Truck (filled from the driver's usual truck)
  - From Place
  - To Place
  - Material
  - Foreman
  - Note
- There are no fields for billing, status, load quantity, start time, equipment, or haul vs. move. A move is written as a note.
- Stored as one database row per Assignment, so GPS trips and tickets can link to it later.

### Settings
- A second page, with one tab per list: Drivers (with usual truck), Trucks (number, optional HCSS code and id), Jobs, Places (optional Job and kind), Materials, Foremen.
- The lists are seeded by hand in the database, then edited here. New entries are added in Settings, not from inside the board's dropdowns.
- Removing an entry marks it inactive and never deletes it, so old Assignments keep their names.

## Target schema (v1)

```
drivers    id, name, default_truck_id?, active
trucks     id, number, hcss_code?, hcss_guid?, active
jobs       id, job_number?, name, active
places     id, short_name, full_name?, kind?, job_id?, geofence_code?, active
materials  id, name, active
foremen    id, name, active
assignments id, date, driver_id?, truck_id?, from_place_id?, to_place_id?,
            material_id?, foreman_id?, note?, created_at, updated_at
```

---

# Final mocks: decisions (grilling, 21 Nov 2026)

Source: the "Trucking page · 5 design mocks" export, page **Final · scheduler, driver, settings** (F1 scheduler, F2 driver, F3 settings), plus the flow map (updated 20 Nov) and the trip log. Where these decisions differ from the 19 Nov ones above, these win.

## Phases
1. **Planning**: F1 scheduler, the Driver's list of Assignments (F2 without trips), F3 Settings.
2. **Truck check-in**: which Truck, the Inspection, Truck problems.
3. **Trips**: from HCSS Fleet telematics; the trip log; started / finished.
4. **Tickets and sign-off**: ticket photos per Load, end-of-day sign-off, fixes until 9 AM.

The schema for all four is designed now; each phase migrates only its own tables (migrations are add-only).

## Decided
- **Words.** The UI says "assignment" for the work and "job" only for a project with a job number, even where the mocks say "job".
- **Unassigned.** An Assignment may have no Driver; F1 keeps an Unassigned lane with its own +. Only the date is required.
- **No Start / Finished.** Neither Dave nor the Driver marks progress; started and finished come only from telematics (phase 3). Until then an Assignment has one action, ✕.
- **✕** deletes on a Draft day and cancels on a Sent day (kept, shown to the Driver as "Cancelled by Dave", kept for the trip log). Past days are read-only, so ✕ is not offered there. (Revised; see "Reconciled" and "Independent review" below.)
- **Order, not Now.** In phase 1 a lane shows its Assignments in order (First, Then…); no Now, "since", Busy or Free until trips exist. Dave can reorder on any editable day; moving one to another Driver puts it last.
- **Foreman and Jobs stay lists.** A job-site Place gets a usual Foreman that fills in the Assignment's Foreman; the Assignment keeps its own. Settings keeps Jobs (job numbers) and Foremen.
- **Typed names.** A Place or Material typed in the composer becomes a new list entry on save, flagged "not on the truck map yet".
- **Driver view.** Until the Hub's sign-in, the header toggle is **Scheduler | Driver**. Driver asks "Who are you?" once and the device remembers the name and the view, so a Driver's phone opens on his list. Anyone can still switch to Scheduler until sign-in exists.
- **Truck on an Assignment** is stored only when Dave names a certain one; blank means "his own". The phone shows the Truck he checked in to (phase 2); the scheduler shows his usual Truck in grey. Replaces "picking a Driver fills in their usual Truck".
- **Trip and Load.** A Trip is any movement the Truck records, loaded or empty; a Load is a Trip carrying material. Tickets and counts are per Load; the trip log lists Trips.
- **Truck work** (a lowboy move) is an ordinary Assignment with a note, From and To Places and no Material; it shows by its note. No separate kind.
- **Settings** is F3's single page, sections Drivers, Trucks, Places, Materials, Jobs, Foremen. Place kinds stay four in the data; Shop and Yard show as one "Shop or yard" choice saved as shop. Places, Materials and Drivers get a sort order (drag or ▲▼) that orders chips and lanes. Place panels show "On the truck map" from the geofence code; Truck panels say nothing about HCSS (22 Nov).

## Days, copied from the Daily Schedule (`Schrex/daily-schedule`, `docs/specs/week-strip.md`)
- **Week strip** in the header: Monday to Friday tiles plus narrow Saturday and Sunday, saying Today and Tomorrow, each with the day's state (Sent, Changed, Not sent, "2 unassigned", "–"); arrows that name their day and skip weekends and Holidays, also on the arrow keys; a week pager; "Back to (next working day)". Opens on the next working day. Same date behaviour, built in this app's stack (ADR-0002).
- **Send per day.** A day is a Draft, invisible to Drivers ("Dave hasn't sent Monday yet."), until Dave taps Send. After that there is no lock and no Send again: each change reaches the Driver at once and is marked "Changed by Dave". (ADR 0003.)
- **Start from** replaces Copy today: an empty day says "Nothing planned for (day)" and offers "Start from (latest earlier day with Assignments)", copying Driver, order, Places, Material, Foreman and a named Truck, and dropping notes and cancelled ones. A past day offers "Copy to (next working day)" while that day is empty. Duplicate is dropped.
- **Locks** stay in the Worker by US Eastern time, as now; no "Change this schedule" lock (unlike the Daily Schedule). (ADR 0004.)
- **Week view** (Drivers by Monday to Friday, read-only, iPad) comes after phase 1.
- **Same people in two apps.** The Daily Schedule already has these Drivers (Crew Type Trucking), Off Work, Jobs and Foremen. The apps stay separate (ADR-0001). Once both are in the Hub, trucking should read the Daily Schedule's Sent day and grey out Drivers who are Off Work.
- **Inspection is the official record.** Append-only, item by item, with repairs, Driver, Truck and time; a sign-off is its own signed row and a fix adds a new version. To be confirmed with whoever owns DOT compliance.
- **Truck problems** show on the Driver's lane and on that Truck in the composer until Dave marks them fixed. No Slack or texts.

## Phases 2 to 4
- **Inspection checklist** is a list in Settings (add, rename, reorder, inactive, optional). Each item is answered OK, Needs repair or N/A; an Inspection keeps each item's wording. No truck types.
- **Needs repair** opens a Truck problem, shown to Dave until he marks it fixed. The app never grounds a Truck (to confirm with DOT compliance).
- **Who answers the trip log.** At sign-off the Driver puts each Ticket on its Load and confirms his Trips. Dave answers the rest next morning: Trips with no Assignment (make one, link one, not a haul), "Who was driving?", Assignments with no Trips. The day is finished when both have.
- **Trips** come from HCSS Fleet place enter/leave events, pulled by the Worker every 10 minutes 4 AM to 8 PM Eastern, kept raw and paired into Trips. The Driver is whoever last inspected that Truck before the Trip; a Trip from an Assignment's From to its To is a Load, the way back is empty.
- **Tickets** are a photo (R2) on a Load, with empty ticket number, quantity and unit for reading later (from the photo or Jeri's stone matching). The Driver never types numbers.
- **The finished day** is a read-only Truck log page per Truck per day plus CSV. Pushing to HeavyJob or payroll is a later decision. After 9 AM next day the Driver's part is locked.
- **Miles and engine hours** are the 4 AM HCSS Fleet readings around the day, read with this app's own token and stored per Truck.

## Reconciled while writing the schema
- ✕ (Q4a) **deletes only on a Draft day**; on a Sent day, past or future, it cancels, so a Driver who has seen an Assignment sees it cancelled rather than gone.

## Independent review (21 Nov 2026)

A fresh reviewer checked the decisions, the spec and the ticket plan against the code, the mocks and the glossary. Decided after it:
- **Testing without Drivers.** During the build no Driver gets Cloudflare Access; Sumanth tests both the Scheduler and the Driver view.
- **Driver view shows today and tomorrow** (calendar days, so a Sent Saturday shows on Friday), and fetches today again when the phone comes back to it.
- **No warnings on Send** for now.
- **Giving work to another Driver on a Sent day** cancels it for the first Driver ("Cancelled by Dave") and adds a new one last in the other lane ("Added by Dave"). On a Draft day it is a plain move.
- **An Assignment's day is fixed.** The Worker refuses a date change; other days are reached by Copy and ✕.
- **Cancelled Assignments stay in the lane**, struck through, opening only to Put back. A day is empty only with no Assignments at all.
- **Changed vs Added.** Changed: a field, cancel, Put back, or its own move in the order, after the Send. Renumbered neighbours are not. One added after the Send is Added.
- **Earlier versions are kept from phase 1**: an add-only record of each Assignment's fields before every change after its day is Sent. Phase 3 matches Trips made before a reroute; the Driver card can say "was Cobblestone".
- **Removing a Driver who has work planned**: any Driver with Assignments on a day keeps a lane there, marked removed; Remove warns how many later days he has work on.
- **Usual Foreman** comes from the drop-off if it is a job site, else the pick-up.
- **Typed names** that match a removed entry bring it back. New and revived entries go last in their list; lists sort by their order, entries without one last, then by name.
- **Saves are per field** (PATCH); changing the Driver puts it last in the new lane.
- ~~**The Truck panel keeps the HCSS code and id**, next to "Linked to HCSS Fleet".~~ Superseded 22 Nov: Settings shows neither; they stay in the data.
- **Refusals follow the API doc** (`docs/api.md`): bad or past dates 400 `{ fields }`; an empty day or a day already planned 409 `{ error, message }`.
- **Do this first / Do this later** move one place each, hidden at the ends.
- **Copying lists the columns it copies** (not the ones it skips), so a new column is never copied by accident; inactive Trucks and Foremen are dropped like inactive Places and Materials.

## Target schema (v2)

Existing tables keep their columns; everything below is added (migrations only add). `orders` is unused and is dropped in a later release.

### Phase 1: planning
```
assignments   + position INTEGER NOT NULL DEFAULT 0   order within (date, driver_id); Unassigned too
              + cancelled_at TEXT                     set by ✕ on a Sent day; row kept
              truck_id now means "a certain truck"; NULL = his own
day_sends     date PK, sent_at                         one row per Sent day; Added = created_at after sent_at; Changed = changed_at after sent_at
assignments   + changed_at TEXT                        last change the Driver can see (fields, cancel, Put back, own move); not set on renumbered neighbours
assignment_changes  id, assignment_id, changed_at, before (JSON of the fields)   add-only; written on every change after the day is Sent
drivers       + sort_order INTEGER                     lane order
places        + sort_order INTEGER, + usual_foreman_id → foremen
materials     + sort_order INTEGER
```

### Phase 2: truck check-in
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
An Assignment's Now / Done / "since" are worked out from its Trips, not stored.

### Phase 4: tickets and sign-off
```
tickets    id, date, driver_id, truck_id, trip_id? (its Load), photo_key (R2), taken_at,
           ticket_number?, quantity?, unit?, read_by photo|stone_matching|NULL
sign_offs  id, date, truck_id, who driver|dave, driver_id?, repairs?, signed_at, version   append-only; latest version counts, Driver's locks 9 AM next day
```
The Truck log is a page built from these; it has no table of its own.

## After trying it on staging (grilling, 22 Nov 2026)

- **Send stays the gate.** Randy's Monday was not showing because Monday was a Draft. A Draft day with Assignments now says "Drivers can't see this day until you Send." under its state.
- **Settings says nothing about HCSS on a Truck**: no "Linked to HCSS Fleet" / "Not linked yet", no HCSS code or id fields. The values stay in the database for Trips later.
- **Save folds the composer.** The next **+**, in any lane, starts with the same Places and Material; Close or another day starts it empty.
- **Driver view**: "Not you?" is gone; "← Drivers", top left where "← Hub" is, goes back to "Who are you?". The device still opens on the last Driver picked. The Driver sees one day at a time, opening on Today: **Yesterday | Today | Tomorrow** tabs (calendar days) and **‹ ›** to step one calendar day, weekends included, since Dave plans weekends too. When Dave has Sent him work beyond tomorrow, "Next from Dave: Mon, Nov 23 →" goes there, so a Saturday never hides Monday (found on the preview: a Sent Monday was out of reach on a Saturday with calendar-day tabs alone).
- **First** is the first Assignment in a lane that is not cancelled, and a cancelled one is neither First nor Then; the Board's "N Assignments" leaves cancelled ones out.
