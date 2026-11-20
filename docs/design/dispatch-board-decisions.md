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
