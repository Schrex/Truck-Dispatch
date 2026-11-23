# Phase 2 spec: Check-in (user stories)

Status: **built** (roadmap phase 2, [PR #62](https://github.com/Schrex/Truck-Dispatch/pull/62)). Agreed in a design grilling on 23 Nov 2026. Words in capitals are the ones in [`GLOSSARY.md`](../../GLOSSARY.md) (new in this phase: **Check-in**). The build order is in [`roadmap.md`](roadmap.md), phase 2. The reasons behind the design are in [`../design/dispatch-board-decisions.md`](../design/dispatch-board-decisions.md), "Check-in (phase 2)".

## Problem

Today each Driver fills in the paper **Daily Truck Log & Inspection**: the Truck number, a row of tick boxes for the walk-around, "Repairs needed", and a signature. Dave doesn't see the paper until much later, if at all. He doesn't know who took which Truck this morning, or that a Truck has a problem, until someone phones him. Phase 3 also needs to know who drove each Truck: a Truck's movements can never say who is driving.

## Solution

On **Today** in the Driver view, the Driver **checks in**: he picks the Truck he is taking (his usual one is pre-selected) and does its **Inspection**, item by item, from the same checklist as the paper form. Anything marked **Needs repair** needs a short note and becomes a **Truck problem**. He can also **report a problem** at any time that day. On the Board, Dave sees for today who has checked in, to which Truck and when, and which Trucks have open problems. He marks problems fixed in Settings.

Until Drivers sign in through the Hub, the Driver view trusts whichever name was picked on the phone. So phase 2 is built and tried on staging, but Inspections are not used as the real record until sign-in exists.

## User stories

### The checklist (Settings)

1. As Dave, I want an **Inspection checklist** section in Settings, so that the items are mine to keep current.
2. As Dave, I want it to start with the paper form's 12 items, in the paper's order: Dump box clean, Air leaks / brake pressure, Truck paperwork, Mud flaps, Fire ext / triangles, Tires / wheels, Lights, Coolant, Engine oil, Fueled up, Air tank (drain), Suspension. That way Drivers see what they already know.
3. As Dave, I want to add, rename, reorder (▲▼) and remove items, and to mark an item optional, so that the checklist can change without a developer.
4. As Dave, I want a removed item kept and listed apart, as with every other list, so that old Inspections still read correctly.
5. As Dave, I want an Inspection to keep each item's wording as it was that day, so that renaming an item never changes a past Inspection.

### Checking in (Driver view, Today)

6. As a Driver, I want a **Check in** card at the top of Today until I have checked in, so that I know it is the first thing to do.
7. As a Driver, I want to still see my Assignments before I check in, so that I can read my day before walking to the Truck.
8. As a Driver, I want my usual Truck pre-selected (none when I have no usual Truck or it is removed), and any active Truck offered instead, so that a swap is one tap.
9. As a Driver, I want to check in on Today whether or not Dave has Assigned me anything, so that a day with no plan (a yard move) still has an Inspection.
10. As a Driver, I want no Check in on Yesterday, Tomorrow or any other day, so that an Inspection is always about this morning.
11. As a Driver, I want the Truck's open Truck problems shown at the top of the Inspection ("Mud flap torn · reported Fri by Nate"), so that I know them before driving and do not report them twice.
12. As a Driver, I want each item answered **OK**, **Needs repair** or **N/A** with one tap, so that the walk-around is as quick as the paper.
13. As a Driver, I want **Needs repair** to ask for a short note ("left rear tire low"), so that Dave knows what is wrong.
14. As a Driver, I want an optional **Other notes** box, so that I can mention something that is not a repair.
15. As a Driver, I want **Finish** allowed only once every item that is not optional is answered, and every Needs repair has its note, so that no Inspection is half done.
16. As a Driver, I want the start time recorded when I finish, without typing it, so that the log has it.
17. As a Driver, I want, once checked in, a single line "Truck 24 · checked in 6:42 · Report a problem · Check in again", so that the check-in no longer takes up the screen.
18. As a Driver, I want to check in again to another Truck later that day, or inspect the same Truck again (after a repair), so that the record follows what happened. The latest one counts and earlier ones stay.

### Truck problems

19. As a Driver, I want each Needs repair item to become a Truck problem with my note, so that I report once.
20. As a Driver, I want **Report a problem** for the Truck I am checked in to (my latest check-in today), at any time that day, with a required note, so that a breakdown at 11 AM reaches Dave.
21. As Dave, I want a Truck with an open problem still drivable in the app, so that I decide what happens, not the app.
22. As Dave, I want a **Truck problems** list in Settings under Trucks, open ones first, each with its Truck, note, who reported it and when, so that I see everything open.
23. As Dave, I want **Mark fixed**, with an optional note, so that the problem closes and the Drivers stop seeing it.
24. As Dave, I want fixed problems kept, with when and how they were fixed, so that a Truck's history is never lost.
25. As Dave, I want only Drivers to report problems for now. I mark them fixed, but don't add them.

### The Board (today)

26. As Dave, I want each Driver's lane to show, for today, the Truck he checked in to and when ("Truck 24 · checked in 6:42"), in place of his usual Truck in grey, so that I know who took what.
27. As Dave, I want a lane to say "Not checked in" today until he has, so that I can see who hasn't started.
28. As Dave, I want two Drivers checked in to the same Truck both shown, not refused, so that a real swap is never blocked at 6 AM.
29. As Dave, I want a red mark on today's lane whose Driver's Truck (checked-in, else usual) has an open problem, and on that Truck's chip in the composer on any day, so that I don't plan work on a Truck that needs repair without knowing.
30. As Dave, I want a check-in whose Inspection has any Needs repair item to say so on the lane ("Truck 24 · checked in 6:42 · needs repair"), so that I can tell a clean check from one that found something.

### Errors and safety

31. As a Driver, I want a failed Finish to say so and keep my answers, so that I can try again without starting over, and without the retry saving it twice.
32. As Dave, I want the Worker to refuse a check-in for any day but today (US Eastern), and to refuse changing or deleting an Inspection, so that the record holds whatever the device does.

## Implementation decisions

### Schema (only adds)

From the design doc's phase 2 schema, with the grilling's additions:

```
inspection_items   id, label, optional 0/1, sort_order, active
inspections        id, date, driver_id, truck_id, done_at, other_notes?          append-only
inspection_answers inspection_id, position, item_id, label (copied), answer ok|repair|na, repair_note?
truck_problems     id, truck_id, reported_by_driver_id, reported_at, text,
                   inspection_id? (when it came from an Inspection), fixed_at?, fixed_note?
```

- "Needs repair" for a whole Inspection (any item answered Needs repair) is worked out from the answers, not stored.
- `id` of an Inspection is made by the phone (a UUID), so a retried Finish is recognised: a repeat with the same id answers the stored Inspection and creates nothing.
- `done_at` is the Worker's clock as an exact UTC moment (shown in US Eastern, as other moments are); `date` is the Worker's US Eastern today. **Latest** means the newest `done_at`, ties broken by insertion order. Indexes on `inspections (truck_id, done_at)` for phase 3's "whoever last inspected that Truck" and `(driver_id, date)` for check-ins.
- `truck_problems.reported_by_driver_id` is nullable in the schema, with the Worker requiring a Driver for now, so "Dave adds a problem" later needs no table rebuild (an add-only migration cannot relax NOT NULL).
- The 12 starting items are not synthetic test data, so they live in their own seed file (`INSERT OR IGNORE`, fixed ids, sort order 1–12) that every environment loads, production included, not in the synthetic fixture.
- The Driver's checked-in Truck for a day is his latest Inspection that day.

### API (new routes, same style as today's)

- `inspection-items`: list, add, change and order, like the other ordered lists (`?include=inactive`, `PUT inspection-items/order`).
- `POST inspections`: `{ id, driverId, truckId, answers: [{ itemId, answer, repairNote? }], otherNotes? }`, always for today. A repeat of an id already saved answers 200 with the stored Inspection.
  - Answers 201 with the Inspection and any Truck problems it opened.
  - 400 `{ fields }` for a required item left out, a Needs repair with no note, or an unknown or inactive Driver, Truck or item.
  - The date is the Worker's today; any other is refused. No PATCH or DELETE (405).
- `GET check-ins?date=`: each Driver's latest Inspection that day (Truck, time, needs repair), for the Board and the Driver view. Any date can be read (the phase 4 Truck log needs past days); only adding is limited to today.
- `truck-problems`:
  - `GET truck-problems` lists all, open first, then fixed newest first; `?open=1` gives open only; `&truckId=` narrows to one Truck.
  - `POST truck-problems` `{ driverId, truckId, text }` reports one. The Driver's latest check-in today must be on that Truck; a blank text is 400.
  - `POST truck-problems/:id/fix` `{ note? }` marks it fixed; one already fixed is answered as it is; 404 for an unknown id.

### The page

- **Driver view:** the Check in card and Inspection on Today only, and the one-line summary with Report a problem once checked in.
- **Board:** the lane header's Truck line becomes the check-in line for today ("· needs repair" when its Inspection found something), plus the red open-problem mark. The composer's Truck chips get the same mark on any day.
- **Settings:**
  - An Inspection checklist section, ordered, with optional and remove.
  - Under Trucks, a Truck problems list with Mark fixed.
- Write an ADR when the Inspection is built: the Inspection is the official, append-only record.

## Testing

As in [`tech-stack.md`](tech-stack.md#testing):

- **Worker tests:** today only, required items, the repair note, append-only (405), problems opened from an Inspection, mid-day reports only for the checked-in Truck, fix, and the latest Inspection counting.
- **Page tests:** the Check in card and its states, answering and Finish, open problems shown at the start, Report a problem, the Board's check-in line and red mark, and Settings' checklist and problem list.
- **New: browser end-to-end** (Playwright, phone-sized screen) against the real built app with a local D1. It is a few journeys, not every rule:
  - A Driver checks in with one Needs repair.
  - Dave sees the check-in and the red mark on the Board.
  - The Driver reports a problem.
  - Dave marks it fixed in Settings.
  - It runs in CI next to the existing tests, with its own local D1 state (never the developer's), the clock fixed with `NOW`, the Board at desktop size and the Driver view at phone size. It is set up first, on a phase 1 journey, in its own ticket.

## Out of scope

- Drivers signing in. Until the Hub's sign-in exists, Inspections are tried on staging, not used as the real record.
- A certification statement or signature in the app.
- Asking the Driver for odometer or hours (phase 3 reads them from the Truck).
- **Keys in lockbox** and the end-of-day sign-off (phase 4).
- Dave adding Truck problems himself; photos of problems; grounding a Truck.
- Truck types or a different checklist per Truck.
