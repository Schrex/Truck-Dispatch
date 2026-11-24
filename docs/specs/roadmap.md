# Roadmap

Status: draft, last updated 24 Nov 2026 (after PR #129). This is the order of work in very small steps. Each step should be one PR that can be shipped and tried on its own, and should leave staging usable. The detailed decisions for each phase are in `docs/design/dispatch-board-decisions.md`.

Legend: ✅ done · 🟡 in review · ⬜ to do · ⛔ blocked

**Now:** phases 1 and 2 are built and on staging ([PR #42](https://github.com/Schrex/Truck-Dispatch/pull/42), [PR #62](https://github.com/Schrex/Truck-Dispatch/pull/62)). Assignments now read the way Dave writes them: For, At, and Haul, Move or Other, with Customers in Settings ([PR #129](https://github.com/Schrex/Truck-Dispatch/pull/129)). Phase 3 runs on Fleet exports Dave drops by hand: the Fleet imports page stores their visits ([PR #99](https://github.com/Schrex/Truck-Dispatch/pull/99)), and the board, the Driver page and the Fleet imports page build real Trips, Loads, Unplanned work and the Truck log from them on every read ([PR #102](https://github.com/Schrex/Truck-Dispatch/pull/102)). Geofences in Settings, each with a Not considered toggle, replace the 2-minute drive-through rule ([PR #105](https://github.com/Schrex/Truck-Dispatch/pull/105), [PR #107](https://github.com/Schrex/Truck-Dispatch/pull/107), ADR 0009). A Truck's day with no Trips has the Paper log as its backup ([PR #110](https://github.com/Schrex/Truck-Dispatch/pull/110)). Nothing reads Fleet automatically (HCSS 403), and Trips, Dave's answers, Tickets and sign-off are not stored yet. The [data map](../design/data-map.html) ([PR #111](https://github.com/Schrex/Truck-Dispatch/pull/111)) lists the gaps; **Next** below follows its order. Steps 1.8 and 1.10 are still open.

## Next (from the data map)

The order to finish the Truck log. Steps 1 to 3 need nothing from HCSS: they work with the Fleet exports Dave drops today.

1. ⬜ Store Trips and take Dave's answers to Unplanned work and "Who was driving?" (data map gaps 4, 5; phase 4.3)
2. ⬜ Ticket photos on Loads, in R2 (gap 6; phase 4.1)
3. ⬜ Sign-off, the 9 AM lock, the Truck log page and CSV (gaps 7, 10; phase 4.2, 4.4, 4.5)
4. ⬜ Engine hours and meter readings (gaps 2, 3; phase 3.6)
5. ⛔ Automatic Fleet pull (gap 1; phase 3.0, 3.1). Blocked on HCSS access (403)
6. ⬜ Sign-in through the Hub (gap 8; Later). Gap 9, Customer, is closed by [PR #129](https://github.com/Schrex/Truck-Dispatch/pull/129)

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
15. ✅ A lane's **+** turns to × and closes the composer when tapped again ([PR #108](https://github.com/Schrex/Truck-Dispatch/pull/108))

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

Spec: issue [#118](https://github.com/Schrex/Truck-Dispatch/issues/118), tickets #119–#128, with the mockups linked there. An Assignment says whom it is for (a Foreman or a Customer), where the Truck works (At), and what kind of work it is (a Haul, a Move or Other), and the Trip builder matches Trips by them. All built together in [PR #129](https://github.com/Schrex/Truck-Dispatch/pull/129), merged 24 Nov and on staging.

0. ✅ Prefactors: a typed name that resolves into one of several lists ([#126](https://github.com/Schrex/Truck-Dispatch/issues/126)); plain Assignment columns declared once for copy, Changed and handover ([#127](https://github.com/Schrex/Truck-Dispatch/issues/127)); Trip builder routes beyond From and To, and the "nothing fits" rule named ([#128](https://github.com/Schrex/Truck-Dispatch/issues/128))
1. ✅ Customers list in Settings beside Foremen, each with a usual Place ([#119](https://github.com/Schrex/Truck-Dispatch/issues/119))
2. ✅ **For** on the Assignment: a Foreman or a Customer ([#120](https://github.com/Schrex/Truck-Dispatch/issues/120)). Needs 0 and 1.
3. ✅ **At** on the Assignment: where the Truck works, filled from For's usual Place ([#121](https://github.com/Schrex/Truck-Dispatch/issues/121)); the composer is one sentence of chips. Needs 2.
4. ✅ **Haul** and **Move**: the kind toggle, a Move's machine, From and To ([#122](https://github.com/Schrex/Truck-Dispatch/issues/122))
5. ✅ **Other**: shop, standby, water truck, its text as its whole content ([#123](https://github.com/Schrex/Truck-Dispatch/issues/123)). Needs 4.
6. ✅ Trip builder: At fills a missing From or To, At Trips, the Job from At ([#124](https://github.com/Schrex/Truck-Dispatch/issues/124)). Needs 0 and 3.
7. ✅ Trip builder: Move Trips count no Loads, and an Other's Trips are not a haul ([#125](https://github.com/Schrex/Truck-Dispatch/issues/125)). Needs 5 and 6.

## Phase 3: Trips (from the Truck)

The Trip builder and a simulation page that runs Truck 55's real day (Mon 16 Nov) are on staging ([PR #21](https://github.com/Schrex/Truck-Dispatch/pull/21), [PR #63](https://github.com/Schrex/Truck-Dispatch/pull/63), [PR #66](https://github.com/Schrex/Truck-Dispatch/pull/66), [PR #71](https://github.com/Schrex/Truck-Dispatch/pull/71); Unplanned work and Dave's answers to it in [PR #101](https://github.com/Schrex/Truck-Dispatch/pull/101)). Real days come from Fleet exports Dave drops by hand (spec [#81](https://github.com/Schrex/Truck-Dispatch/issues/81), ADR 0008: one real Truck's data on staging): [PR #99](https://github.com/Schrex/Truck-Dispatch/pull/99) stores the visits, with Truck HCSS codes and Place geofence codes in Settings; [PR #102](https://github.com/Schrex/Truck-Dispatch/pull/102) builds Trips from them on every read for the board, the Driver page and the Fleet imports page. Trips are built, not stored; storing them is **Next** step 1.

0. ⬜ Ask HCSS for API access to the Fleet report now, since it is the slowest step (to confirm)
1. ⛔ Read HCSS Fleet place events automatically. Blocked on API access (403); the other routes are polling live position or Fleet's email alerts.
2. ✅ Store the raw events; pair them into Trips; clean out pass-throughs. Pairing in the Trip builder ([PR #21](https://github.com/Schrex/Truck-Dispatch/pull/21)); visits stored from dropped exports ([PR #99](https://github.com/Schrex/Truck-Dispatch/pull/99)), an xlsx row with a blank Exit Time stored as open ([PR #103](https://github.com/Schrex/Truck-Dispatch/pull/103)); pass-throughs are Geofences turned off as Not considered, in place of the 2-minute rule ([PR #105](https://github.com/Schrex/Truck-Dispatch/pull/105), [PR #107](https://github.com/Schrex/Truck-Dispatch/pull/107), ADR 0009). Storing them automatically waits on 3.1
3. ✅ Driver for each Trip = the Truck's latest check-in ([#95](https://github.com/Schrex/Truck-Dispatch/issues/95), [PR #102](https://github.com/Schrex/Truck-Dispatch/pull/102))
4. ✅ A Trip from an Assignment's From to its To is a Load; At, Move and Other rules added in [PR #129](https://github.com/Schrex/Truck-Dispatch/pull/129) ([#94](https://github.com/Schrex/Truck-Dispatch/issues/94), [PR #102](https://github.com/Schrex/Truck-Dispatch/pull/102))
5. ✅ Now and Done on the Board, and Unplanned work on the lane, shown not answered ([#93](https://github.com/Schrex/Truck-Dispatch/issues/93), [#96](https://github.com/Schrex/Truck-Dispatch/issues/96), [PR #102](https://github.com/Schrex/Truck-Dispatch/pull/102))
6. ⬜ Daily miles and engine hours from the Fleet meter readings around the day (the end reading exists from about 22:12 ET). Worked out on the simulation page in [PR #63](https://github.com/Schrex/Truck-Dispatch/pull/63); xlsx exports carry no odometers, so their Trip miles are blank. **Next** step 4
7. ✅ Clear Fleet imports (and optionally Geofences) to start over on staging ([PR #109](https://github.com/Schrex/Truck-Dispatch/pull/109))
8. ⬜ Dave Imports through a real planned day on staging, and we fix what he hits (to confirm)

## Phase 4: Close the day (Tickets, sign-off, Truck log)

**Paper log** (spec [#112](https://github.com/Schrex/Truck-Dispatch/issues/112)), a backup for any Truck's day its Trips are missing: a photo of the paper Daily Truck Log, never typed, on today or a past day, kept in R2. All built in [PR #110](https://github.com/Schrex/Truck-Dispatch/pull/110), merged 24 Nov, and on staging.

- ✅ The preview and staging photo buckets and the CI token's R2 permission ([#113](https://github.com/Schrex/Truck-Dispatch/issues/113))
- ✅ A Driver attaches a Paper log photo and sees it, the same for every Truck ([#114](https://github.com/Schrex/Truck-Dispatch/issues/114))
- ✅ Dave sees, opens and attaches Paper logs on each Driver's Board lane ([#116](https://github.com/Schrex/Truck-Dispatch/issues/116))
- ✅ Dave takes a wrong photo off, hidden and kept ([#117](https://github.com/Schrex/Truck-Dispatch/issues/117))
- ⬜ Scott attaches Monday 23 Nov's paper log on staging, and we fix what he hits (to confirm)

1. ⬜ Driver photographs a Ticket and puts it on its Load (stored in R2, the same `PHOTOS` bucket as the Paper log)
2. ⬜ End-of-day sign-off: the Driver confirms his Trips and Tickets
3. ⬜ Next morning, Dave answers what is left (answered on the simulation page only, [PR #101](https://github.com/Schrex/Truck-Dispatch/pull/101); real answers need stored Trips): Trips with no Assignment, "Who was driving?", Assignments with no Trips
4. ⬜ The Driver's part locks at 9 AM the next day
5. ⬜ Truck log page per Truck per day, plus CSV. The real Truck log is shown on the Fleet imports page and under the Driver's Today ([#91](https://github.com/Schrex/Truck-Dispatch/issues/91), [#97](https://github.com/Schrex/Truck-Dispatch/issues/97), [PR #102](https://github.com/Schrex/Truck-Dispatch/pull/102)); its own page and the CSV are still to do (header, one column per Assignment, Unplanned work and the drives to and from the shop prototyped on the simulation page, [PR #63](https://github.com/Schrex/Truck-Dispatch/pull/63), [PR #71](https://github.com/Schrex/Truck-Dispatch/pull/71) and [PR #101](https://github.com/Schrex/Truck-Dispatch/pull/101))

## Later (not scheduled)

- Plug into the Hub at `/truck-dispatch/`, with the Hub's sign-in and roles
- Production rollout
- Week view (Drivers by Monday to Friday, read-only, iPad)
- Read Off Work and Drivers from the Daily Schedule
- Push the Truck log to HeavyJob or payroll
- Read Ticket numbers and quantities from the photo, or from the stone-invoice matching
- Drop the unused `orders`, `day_sends` and `not_considered` tables (see the data map)
