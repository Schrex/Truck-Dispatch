# Roadmap

Status: draft, last updated 24 Nov 2026. This is the order of work in very small steps. Each step should be one PR that can be shipped and tried on its own, and should leave staging usable. The detailed decisions for each phase are in `docs/design/dispatch-board-decisions.md`.

Legend: ✅ done · 🟡 in review · ⬜ to do · ⛔ blocked

**Now:** phase 1 is built and on staging, with per-Assignment Assign merged ([PR #42](https://github.com/Schrex/Truck-Dispatch/pull/42)). Phase 2 is built and on staging ([PR #62](https://github.com/Schrex/Truck-Dispatch/pull/62), #48–#54), ready to try. Phase 3's Trip builder and simulation page are on staging too ([PR #21](https://github.com/Schrex/Truck-Dispatch/pull/21), [PR #63](https://github.com/Schrex/Truck-Dispatch/pull/63), [PR #66](https://github.com/Schrex/Truck-Dispatch/pull/66) and [PR #71](https://github.com/Schrex/Truck-Dispatch/pull/71)), on fake and recorded Fleet data only. Every page follows one layout ([PR #68](https://github.com/Schrex/Truck-Dispatch/pull/68), brought up to [`ui-standards.md`](../design/ui-standards.md) in [PR #79](https://github.com/Schrex/Truck-Dispatch/pull/79)). Dave can drop HCSS Fleet exports on a Fleet imports page, which stores their visits ([PR #99](https://github.com/Schrex/Truck-Dispatch/pull/99)). Steps 1.8 and 1.10 are still open.

## Phase 1: Plan (Dave plans, Drivers see it)

1. ✅ Lists in Settings: Drivers, Trucks, Places, Materials, Jobs, Foremen, with Dave's own order
2. ✅ Board lanes and Assignments in order; composer with chips; editing in place
3. ✅ Cancel and Put back; Changed and Added after Send
4. ✅ Days: Working days, Holidays, week strip, arrows, Start from, Copy to
5. ✅ Send per day
6. ✅ Driver view: pick your name, see your Sent day
7. ✅ Fixes from trying it on staging ([PR #40](https://github.com/Schrex/Truck-Dispatch/pull/40), on staging 23 Nov): Driver view reaches any day, Foreman on cards, Send hint, composer folds on Save, no HCSS wording on Trucks
8. ⬜ Decide whether Places keep "On the truck map" in Settings (it comes from the HCSS boundary, like the Truck wording that was removed)
9. ✅ Assign each Assignment on its own, replacing Send per day (spec #44, ADR 0005, [PR #42](https://github.com/Schrex/Truck-Dispatch/pull/42), merged 23 Nov; smoke test follow-up in [PR #56](https://github.com/Schrex/Truck-Dispatch/pull/56))
10. ⬜ Dave uses it for real for one week alongside #trucks, and we fix what he hits (to confirm)
11. ✅ Discard cancelled Assignments from the Board, Dismiss them on the Driver view; Settings drops Bring back, with UI polish ([PR #67](https://github.com/Schrex/Truck-Dispatch/pull/67))
12. ✅ One header and navigation on every page, and UI polish ([PR #68](https://github.com/Schrex/Truck-Dispatch/pull/68)); every page brought up to the UI standards ([PR #79](https://github.com/Schrex/Truck-Dispatch/pull/79))
13. ✅ One Assignment for several Drivers at once ("Who?" in the composer), and every **+** opens a blank composer ([PR #80](https://github.com/Schrex/Truck-Dispatch/pull/80))
14. ✅ Settings saves an entry on **Save**, not as you type, and adding a removed entry's name brings it back ([PR #98](https://github.com/Schrex/Truck-Dispatch/pull/98))

## Phase 2: Check in (which Truck, Inspection, Truck problems)

Spec: [`phase-2-check-in.md`](phase-2-check-in.md), issue [#47](https://github.com/Schrex/Truck-Dispatch/issues/47). Tried on staging; Inspections become the real record only once Drivers sign in through the Hub. Steps 2.1 and 2.2 can be built in parallel; 2.4 and 2.5 can follow 2.3 in parallel. Steps 2.1–2.7 were all built in [PR #62](https://github.com/Schrex/Truck-Dispatch/pull/62), merged 23 Nov (ADR 0006: the Inspection is the official, append-only record).

0. ✅ Planning round and spec ([PR #43](https://github.com/Schrex/Truck-Dispatch/pull/43), merged 23 Nov; "Assigned, not Sent" wording in [PR #57](https://github.com/Schrex/Truck-Dispatch/pull/57))
1. ✅ Inspection checklist in Settings, starting with the paper form's 12 items ([#48](https://github.com/Schrex/Truck-Dispatch/issues/48), stories 1–5)
2. ✅ Browser end-to-end test setup, proved on a phase 1 journey ([#49](https://github.com/Schrex/Truck-Dispatch/issues/49))
3. ✅ Driver checks in on Today: pick the Truck, answer each item, notes, Finish; the ADR for the Inspection record ([#50](https://github.com/Schrex/Truck-Dispatch/issues/50), stories 6–10, 12–18, 31–32). Needs 2.1 and 2.2.
4. ✅ Board shows each Driver's check-in for today, with "needs repair" ([#51](https://github.com/Schrex/Truck-Dispatch/issues/51), stories 26–28, 30). Needs 2.3.
5. ✅ Truck problems from Inspections, with Mark fixed and history in Settings ([#52](https://github.com/Schrex/Truck-Dispatch/issues/52), stories 19, 21–25). Needs 2.3.
6. ✅ Report a problem at any time that day ([#53](https://github.com/Schrex/Truck-Dispatch/issues/53), story 20). Needs 2.5.
7. ✅ Open problems shown on the lane, the composer's Truck chip and the start of an Inspection ([#54](https://github.com/Schrex/Truck-Dispatch/issues/54), stories 11, 29). Needs 2.4 and 2.5.

## Assignments read the way Dave writes (For, At, Haul / Move / Other, Customers)

Spec: issue [#118](https://github.com/Schrex/Truck-Dispatch/issues/118), tickets #119–#128, with the mockups linked there. An Assignment says whom it is for (a Foreman or a Customer), where the Truck works (At), and what kind of work it is (a Haul, a Move or Other), and the Trip builder matches Trips by them. All in review together in [PR #129](https://github.com/Schrex/Truck-Dispatch/pull/129).

0. 🟡 Prefactors: a typed name that resolves into one of several lists ([#126](https://github.com/Schrex/Truck-Dispatch/issues/126)); plain Assignment columns declared once for copy, Changed and handover ([#127](https://github.com/Schrex/Truck-Dispatch/issues/127)); Trip builder routes beyond From and To, and the "nothing fits" rule named ([#128](https://github.com/Schrex/Truck-Dispatch/issues/128))
1. 🟡 Customers list in Settings beside Foremen, each with a usual Place ([#119](https://github.com/Schrex/Truck-Dispatch/issues/119))
2. 🟡 **For** on the Assignment: a Foreman or a Customer ([#120](https://github.com/Schrex/Truck-Dispatch/issues/120)). Needs 0 and 1.
3. 🟡 **At** on the Assignment: where the Truck works, filled from For's usual Place ([#121](https://github.com/Schrex/Truck-Dispatch/issues/121)); the composer is one sentence of chips. Needs 2.
4. 🟡 **Haul** and **Move**: the kind toggle, a Move's machine, From and To ([#122](https://github.com/Schrex/Truck-Dispatch/issues/122))
5. 🟡 **Other**: shop, standby, water truck, its text as its whole content ([#123](https://github.com/Schrex/Truck-Dispatch/issues/123)). Needs 4.
6. 🟡 Trip builder: At fills a missing From or To, At Trips, the Job from At ([#124](https://github.com/Schrex/Truck-Dispatch/issues/124)). Needs 0 and 3.
7. 🟡 Trip builder: Move Trips count no Loads, and an Other's Trips are not a haul ([#125](https://github.com/Schrex/Truck-Dispatch/issues/125)). Needs 5 and 6.

## Phase 3: Trips (from the Truck)

The Trip builder and a simulation page that runs Truck 55's real day (Mon 16 Nov) are on staging: design, Trip builder and simulation in [PR #21](https://github.com/Schrex/Truck-Dispatch/pull/21); Scheduler view, Driver view and Truck log on top of it in [PR #63](https://github.com/Schrex/Truck-Dispatch/pull/63) (which includes #21); the Trip log of every Trip in [PR #66](https://github.com/Schrex/Truck-Dispatch/pull/66); the drives to and from the shop in [PR #71](https://github.com/Schrex/Truck-Dispatch/pull/71); Unplanned work in place of #71's unverified columns, with Dave's answers (Make an Assignment, Link to an Assignment, Not a haul, split, Driver first), in [PR #101](https://github.com/Schrex/Truck-Dispatch/pull/101). Fleet exports dropped by hand are stored as visits, with Truck HCSS codes and Place geofence codes set in Settings ([PR #99](https://github.com/Schrex/Truck-Dispatch/pull/99)). Nothing reads Fleet automatically yet, and Trips are not built from the stored visits yet.

0. ⬜ Ask HCSS for API access to the Fleet report now, alongside phases 1 and 2, since it is the slowest step and nothing before phase 3 depends on it (to confirm)
1. ⛔ Read HCSS Fleet place events automatically. Blocked on API access (403); the other routes are polling live position or Fleet's email alerts.
2. 🟡 Store the raw events; pair them into Trips; clean out pass-throughs and boundary flicker (pairing and clean-up in the Trip builder, [PR #21](https://github.com/Schrex/Truck-Dispatch/pull/21); storing visits from exports dropped by hand in [PR #99](https://github.com/Schrex/Truck-Dispatch/pull/99); storing them automatically waits on 3.1)
3. ⬜ Driver for each Trip = whoever last inspected that Truck
4. ⬜ A Trip from an Assignment's From to its To is a Load
5. ⬜ Now and Done on the Board (started, finished, "since 9:40")
6. ⬜ Daily miles and engine hours from the Fleet meter readings around the day (the last before it and the first after it; the end reading exists from about 22:12 ET that evening). Worked out on the simulation page in [PR #63](https://github.com/Schrex/Truck-Dispatch/pull/63)

## Phase 4: Close the day (Tickets, sign-off, Truck log)

1. ⬜ Driver photographs a Ticket and puts it on its Load (stored in R2)
2. ⬜ End-of-day sign-off: the Driver confirms his Trips and Tickets
3. ⬜ Next morning, Dave answers what is left: Trips with no Assignment, "Who was driving?", Assignments with no Trips
4. ⬜ The Driver's part locks at 9 AM the next day
5. ⬜ Truck log page per Truck per day, plus CSV (header, one column per Assignment, Unplanned work and the drives to and from the shop prototyped on the simulation page, [PR #63](https://github.com/Schrex/Truck-Dispatch/pull/63), [PR #71](https://github.com/Schrex/Truck-Dispatch/pull/71) and [PR #101](https://github.com/Schrex/Truck-Dispatch/pull/101))

## Later (not scheduled)

- Plug into the Hub at `/truck-dispatch/`, with the Hub's sign-in and roles
- Production rollout
- Week view (Drivers by Monday to Friday, read-only, iPad)
- Read Off Work and Drivers from the Daily Schedule
- Push the Truck log to HeavyJob or payroll
- Read Ticket numbers and quantities from the photo, or from the stone-invoice matching
- Drop the unused `orders` table
