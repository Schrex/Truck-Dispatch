# Dispatch board: design decisions (grilling, 19 Nov 2026)

Outcome of a design grilling held in another folder (Truck Log Automation) and brought here. Vocabulary: `GLOSSARY.md`. Architecture decisions: `docs/adr/0001`, `docs/adr/0002`. Truck-log pipeline context: `docs/design/system-design.html`, `docs/design/pipeline-map.html`.

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

## Where the existing code differs (found 19 Nov, needs reconciling)

The repo already has a Dispatch board and a New Order form (`migrations/0001_orders.sql`, `src/components/NewOrderDialog.tsx`). Differences from the decisions above:

- The table is `orders`; the domain term is **Assignment**.
- `job` and `work` are required free text, and `driver_id` is required. The decision is that only the date is required, and lists replace free text.
- `start_time` exists; the decision is no start time.
- `pickup`, `dropoff` and `truck_number` are free text; the decision is links to Places and Trucks.
- There are no jobs, places, materials, foremen or trucks tables, and no Settings page.
- The base path is `/truck-dispatch/`, which is fine to keep.

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
- **✕** cancels on today and past days (kept, shown to the Driver as "Cancelled by Dave", kept for the trip log) and deletes on later days.
- **Order, not Now.** In phase 1 a lane shows its Assignments in order (First, Then…); no Now, "since", Busy or Free until trips exist. Dave can reorder on any editable day; moving one to another Driver puts it last.
- **Foreman and Jobs stay lists.** A job-site Place gets a usual Foreman that fills in the Assignment's Foreman; the Assignment keeps its own. Settings keeps Jobs (job numbers) and Foremen.
- **Typed names.** A Place or Material typed in the composer becomes a new list entry on save, flagged "not on the truck map yet".
- **Driver view.** Until the Hub's sign-in, the header toggle is **Scheduler | Driver**. Driver asks "Who are you?" once and the device remembers the name and the view, so a Driver's phone opens on his list. Anyone can still switch to Scheduler until sign-in exists.
- **Truck on an Assignment** is stored only when Dave names a certain one; blank means "his own". The phone shows the Truck he checked in to (phase 2); the scheduler shows his usual Truck in grey. Replaces "picking a Driver fills in their usual Truck".
- **Trip and Load.** A Trip is any movement the Truck records, loaded or empty; a Load is a Trip carrying material. Tickets and counts are per Load; the trip log lists Trips.
- **Truck work** (a lowboy move) is an ordinary Assignment with a note, From and To Places and no Material; it shows by its note. No separate kind.
- **Settings** is F3's single page, sections Drivers, Trucks, Places, Materials, Jobs, Foremen. Place kinds stay four in the data; Shop and Yard show as one "Shop or yard" choice saved as shop. Places, Materials and Drivers get a sort order (drag or ▲▼) that orders chips and lanes. Truck and Place panels show "Linked to HCSS Fleet" / "On the truck map" from the HCSS id and geofence code.

## Days, copied from the Daily Schedule (`Schrex/daily-schedule`, `docs/specs/week-strip.md`)
- **Week strip** in the header: Monday to Friday tiles plus narrow Saturday and Sunday, saying Today and Tomorrow, each with the day's state (Sent, Changed, Not sent, "2 unassigned", "–"); arrows that name their day and skip weekends and Holidays, also on the arrow keys; a week pager; "Back to (next working day)". Opens on the next working day. Same date behaviour, built in this app's stack (ADR-0002).
- **Send per day.** A day is a Draft, invisible to Drivers ("Dave hasn't sent Monday yet."), until Dave taps Send. After that there is no lock and no Send again: each change reaches the Driver at once and is marked "Changed by Dave".
- **Start from** replaces Copy today: an empty day says "Nothing planned for (day)" and offers "Start from (latest earlier day with Assignments)", copying Driver, order, Places, Material, Foreman and a named Truck, and dropping notes and cancelled ones. A past day offers "Copy to (next working day)" while that day is empty. Duplicate is dropped.
- **Locks** stay in the Worker by US Eastern time, as now; no "Change this schedule" lock (unlike the Daily Schedule).
- **Week view** (Drivers by Monday to Friday, read-only, iPad) comes after phase 1.
- **Same people in two apps.** The Daily Schedule already has these Drivers (Crew Type Trucking), Off Work, Jobs and Foremen. The apps stay separate (ADR-0001). Once both are in the Hub, trucking should read the Daily Schedule's Sent day and grey out Drivers who are Off Work.
- **Inspection is the official record.** Append-only, item by item, with repairs, Driver, Truck and time; a sign-off is its own signed row and a fix adds a new version. To be confirmed with whoever owns DOT compliance.
- **Truck problems** show on the Driver's lane and on that Truck in the composer until Dave marks them fixed. No Slack or texts.
