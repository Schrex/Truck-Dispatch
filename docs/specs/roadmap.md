# Roadmap

Status: draft, last updated 23 Nov 2026. This is the order of work in very small steps. Each step should be one PR that can be shipped and tried on its own, and should leave staging usable. The detailed decisions for each phase are in `docs/design/dispatch-board-decisions.md`.

Legend: ✅ done · 🟡 in review · ⬜ to do · ⛔ blocked

**Now:** phase 1 is built and on staging. Phase 2 is specified; building starts with step 2.1. Steps 1.8 and 1.9 are still open.

## Phase 1: Plan (Dave plans, Drivers see it)

1. ✅ Lists in Settings: Drivers, Trucks, Places, Materials, Jobs, Foremen, with Dave's own order
2. ✅ Board lanes and Assignments in order; composer with chips; editing in place
3. ✅ Cancel and Put back; Changed and Added after Send
4. ✅ Days: Working days, Holidays, week strip, arrows, Start from, Copy to
5. ✅ Send per day
6. ✅ Driver view: pick your name, see your Sent day
7. ✅ Fixes from trying it on staging ([PR #40](https://github.com/Schrex/Truck-Dispatch/pull/40), on staging 23 Nov): Driver view reaches any day, Foreman on cards, Send hint, composer folds on Save, no HCSS wording on Trucks
8. ⬜ Decide whether Places keep "On the truck map" in Settings (it comes from the HCSS boundary, like the Truck wording that was removed)
9. ⬜ Dave uses it for real for one week alongside #trucks, and we fix what he hits (to confirm)

## Phase 2: Check in (which Truck, Inspection, Truck problems)

Spec: [`phase-2-check-in.md`](phase-2-check-in.md). Tried on staging; Inspections become the real record only once Drivers sign in through the Hub.

0. ✅ Planning round and spec (23 Nov)
1. ⬜ Inspection checklist in Settings, starting with the paper form's 12 items (stories 1–5)
2. ⬜ Driver checks in on Today: pick the Truck, answer each item, notes, Finish. Needs repair opens a Truck problem. Write the ADR for the Inspection as the official, append-only record. (stories 6–19, 30–32)
3. ⬜ Board shows each Driver's check-in for today, or "Not checked in" (stories 26–28)
4. ⬜ Report a problem at any time that day (story 20)
5. ⬜ Truck problems list in Settings, with Mark fixed and history (stories 21–25)
6. ⬜ Open problems: red mark on the lane and the composer's Truck chip, and shown at the start of an Inspection (stories 11, 29)

## Phase 3: Trips (from the Truck)

0. ⬜ Ask HCSS for API access to the Fleet report now, alongside phases 1 and 2, since it is the slowest step and nothing before phase 3 depends on it (to confirm)
1. ⛔ Read HCSS Fleet place events automatically. Blocked on API access (403); the other routes are polling live position or Fleet's email alerts.
2. ⬜ Store the raw events; pair them into Trips; clean out pass-throughs and boundary flicker
3. ⬜ Driver for each Trip = whoever last inspected that Truck
4. ⬜ A Trip from an Assignment's From to its To is a Load
5. ⬜ Now and Done on the Board (started, finished, "since 9:40")
6. ⬜ Daily miles and engine hours from the 4 AM readings

## Phase 4: Close the day (Tickets, sign-off, Truck log)

1. ⬜ Driver photographs a Ticket and puts it on its Load (stored in R2)
2. ⬜ End-of-day sign-off: the Driver confirms his Trips and Tickets
3. ⬜ Next morning, Dave answers what is left: Trips with no Assignment, "Who was driving?", Assignments with no Trips
4. ⬜ The Driver's part locks at 9 AM the next day
5. ⬜ Truck log page per Truck per day, plus CSV

## Later (not scheduled)

- Plug into the Hub at `/truck-dispatch/`, with the Hub's sign-in and roles
- Production rollout
- Week view (Drivers by Monday to Friday, read-only, iPad)
- Read Off Work and Drivers from the Daily Schedule
- Push the Truck log to HeavyJob or payroll
- Read Ticket numbers and quantities from the photo, or from the stone-invoice matching
- Drop the unused `orders` table
