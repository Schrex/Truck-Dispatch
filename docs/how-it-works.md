# How it works today

What the app does as built, page by page. Words in capitals are defined in [`GLOSSARY.md`](../GLOSSARY.md); the API behind each action is in [`api.md`](api.md). It is a standalone Cloudflare Worker backed by D1 with **synthetic** Drivers, Trucks, Jobs, Places, Materials and Foremen only, plus the Inspection checklist's starting items (reference data). Inspections made on it are kept (append-only). Hub integration (at `/truck-dispatch/`), sign-in and production are later phases ([roadmap](specs/roadmap.md)).

## Dispatch board (`/`)

### Lanes
- Opens on the next **Working day** (US Eastern; on a Friday, Monday).
- One lane per Driver (name and usual Truck; a removed Driver only on a day he has work), and an Unassigned lane last.
- **Check-ins (today only):** when the day on screen is today, each Driver's lane shows his check-in in place of his usual Truck: "Truck 24 · checked in 6:42" (his latest Inspection; US Eastern, 24-hour clock), adding "· needs repair" when that Inspection had a Needs repair item, or "Not checked in" until he has. Two Drivers checked in to one Truck both show it. The Board reads the check-ins again when the page regains the focus; if they cannot be read, the lanes show the usual Truck. On any other day the lanes show the usual Truck as before.
- **Open Truck problems (today only):** on today a lane gets a red mark beside its Truck line when the Driver's Truck has an open Truck problem: the Truck he checked in to, or his usual Truck before he checks in. Hovering the mark shows the problems' notes; tapping it lists them under the line (tapping again puts them away). The Board reads the open problems again when the page regains the focus, so one marked fixed in Settings loses its mark; if they cannot be read, the marks stay as they were. No lane mark on any other day.
- Each lane shows that day's **Assignments** as blocks in order, reading "From → To" (or the note), marked First (the first that is not cancelled) and Then.
- A block shows the Assignment's Foreman beside its job site ("TIUNY (Brody)"), and the Truck: one the Assignment names shows plainly; with none named ("His own", the Driver takes his usual Truck) his usual Truck shows in grey, or nothing if he has none.
- A **Draft** block has a dashed outline and a small "Draft" tag beside First or Then; an Assigned block looks plain, tagged only once it is Changed or Added (or Cancelled).
- Above the lanes, the day's count leaves cancelled Assignments out.

### Adding (the composer)
- The **+** on a lane (Unassigned included) opens the composer in that lane.
- Pick up and Drop off are rows of Place chips, and "Hauling what?" is Material chips, each with "Or type it" for a name not in the list (found, brought back or added by the Worker).
- A Foreman chip is filled in with the drop-off's usual Foreman if it is a job site, otherwise the pick-up's; Dave can change or clear it.
- "Note or other truck" opens the Truck chips ("His own" first, the default) and the note. A Truck with an open Truck problem has a red mark on its chip (hover for the notes), and so does His own when the lane's Driver's usual Truck has one, on any day the composer opens, since a problem is the Truck's state now. The open problems are read again when the page regains the focus.
- A sentence previews it. Save needs only the day, puts it last in the lane and folds the composer; the next **+** (any lane) starts with the same Places and Material until **Close**.

### Changing an Assignment
- Tapping a block opens it in its lane (one at a time; tapping again closes it) as a sentence of chips, Driver, Material, From, To, Truck and Foreman, with its note.
- Tapping a chip offers that list (Unassigned for the Driver, His own for the Truck, "Leave blank" for the rest; From, To and Material also "Or type it", as in the composer, saved by name on Enter or on leaving the box). Each pick, or the note when left, saves on its own.
- A new Driver puts it last in his lane. A Draft simply moves. An Assigned one is cancelled for the first Driver and a copy is added last in the new lane, where it stays open: Assigned at once to the new Driver (marked Added), or a Draft in Unassigned.
- **Do this first** and **Do this later** move it one place in its lane, each left out at that end.
- **✕** takes it off the day: a Draft is deleted; an Assigned one is cancelled, staying in its place, struck through and greyed, marked Cancelled, and opens only to **Put back**, which restores it (both count as Changed). The button says **Delete** on a Draft and **Cancel** on an Assigned one.

### Days
- The header shows the day's short date and its word ("Mon, Nov 23 · Next Monday", with a Holiday's name).
- An arrow each side names the Working day it goes to, skipping weekends and the six Holidays; the left and right arrow keys do the same when no field has the focus. **Back to** returns to the next Working day from any other day.
- A day with no Assignments at all (cancelled ones count) says "Nothing planned for Mon, Nov 23" and saves nothing just for being looked at.
- **Start from**: on today or a later empty day, copies the latest earlier day with Assignments ("Start from Thu, Nov 19"): each Assignment's Driver, order, Places, Material, Foreman and named Truck, without notes or cancelled ones, leaving out removed Places, Materials, Trucks and Foremen; a removed Driver's work goes to Unassigned. Every copy is a Draft.
- **Copy to**: a day before today with Assignments offers to copy it to the next Working day while that day is still empty, by the same rules, then shows it.
- Neither is offered once the target day has Assignments.

### Assign
- Each Assignment is a **Draft** until Dave **Assigns** it on its own (ADR 0005); its Driver sees nothing of a Draft. There is no Send for the day and no "Assign all".
- On today and later days a Draft block with a Driver (not a removed one, whom no one would reach) has an **Assign** button in its corner: one tap, no confirm. The block then loses its dashed outline and Draft tag, and the week strip reads its states again. If the Worker refuses (a day now past, say) its message shows and the block stays a Draft.
- An Unassigned Draft has no Assign button; the Unassigned lane says "Pick a Driver to Assign" while it holds Drafts. Days before today show their Drafts but no Assign.
- Once Assigned, every change reaches the Driver at once, marked Changed (measured from when it was Assigned); one Assigned on its own day is Added. Days Sent before the change were carried over: their Assignments with a Driver are Assigned.

### Week strip
- A tile for each day Monday to Friday and narrow Saturday and Sunday tiles; today's says Today and the next day's Tomorrow; the day on screen is filled and today outlined.
- Each tile shows the day's state and a Holiday's name: "2 drafts" while it holds Drafts that are not cancelled (Unassigned ones included), otherwise Assigned, or Changed once any Assigned one is Changed, cancelled or Added, or "–" for nothing.
- Tapping a tile shows that day; the pager ("Nov 16 to Nov 22") moves a week at a time keeping the weekday.
- The strip reads the states again after any change on the Board and when the page regains the focus (if the week cannot be read, it says so under the tiles, which still show their days), and scrolls sideways on a phone.

## Driver view (`/driver`)

- **Scheduler | Driver** in the header switches to it. The first time it asks "Who are you?" with the active Drivers as large buttons; the device remembers the Driver and the view in its browser storage (nothing is saved in the database), so it opens on his day.
- **← Drivers** (top left) goes back to "Who are you?"; **Scheduler** switches back.
- It shows one of his days at a time, opening on Today: **Yesterday | Today | Tomorrow** are one tap (calendar days, so on a Friday, Tomorrow is Saturday), and **‹ ›** step one calendar day at a time, weekends included.
- When Dave has Assigned him work beyond tomorrow (not cancelled), **Next from Dave: Mon, Nov 23 →** goes there.
- He sees only his Assigned Assignments, never his Drafts; a day with none says "Nothing from Dave yet for Monday."
- Otherwise his Assignments are large cards in Dave's order with the Material, Pick up, Drop off, the Foreman (when there is one) and the note, and "Take Truck 53 for this one" when a Truck is named.
- Marks: "Changed by Dave" with what each field was when it was Assigned ("was Cobblestone"), "Added by Dave" (Assigned on its own day, or handed over from another Driver), or struck through and "Cancelled by Dave". Given to another Driver after it was Assigned, it shows Cancelled to the first and Added to the second.
- It reads today, the day shown and his next Assigned day again whenever the page regains the focus; Today moves on with the clock, a picked day stays.

### Check-in (Today only)
- On **Today**, until he has checked in, a **Check in** card sits at the top, above his Assignments (which still show below it). It is offered whether or not Dave has Assigned him anything, and never on Yesterday, Tomorrow or any other day. If his check-in today cannot be read, the page says "Could not load your check-in. It tries again when you come back to the page." and still offers the card, so he can always check in (the latest check-in counts).
- **Truck**: every active Truck as a large button, his usual one pre-selected (none when he has none or it was removed). **Start Inspection** then lists the Truck's open problems first, before the items, so he knows them before driving and does not report them twice: "Mud flap torn · reported Fri by Sample Driver B" (the day: "today", the weekday within the last week, or the date further back); none listed when it has none. Then the checklist in Dave's order. Picking another Truck once started starts a fresh Inspection for it: its open problems, no answers or notes yet, and a new Inspection id, so a Finish for the first Truck can never be saved, or retried, as this one.
- Each item is answered with one tap: **OK**, **Needs repair** or **N/A** (an optional item says "(optional)"). Needs repair asks "What needs repair?" for a short note. An optional **Other notes** box follows.
- Each Needs repair becomes a **Truck problem** on that Truck, with his note, his name and the time, saved together with the Inspection (a refused or retried Finish opens none twice). A Truck with an open problem can still be checked in to and driven: the app reports, it never grounds.
- **Finish** is allowed once every item that is not optional is answered and every Needs repair has its note. The Worker records the time (its clock) and today's date. A failed Finish says "Could not finish the check-in. Your answers are kept: try Finish again."; trying again sends the same Inspection id, so it is never saved twice.
- Once checked in, the card becomes one line: "Truck 24 · checked in 6:42 · **Report a problem** · **Check in again**" (time in US Eastern, 24-hour clock). Check in again opens the card again (with **Cancel** back to the line) for another Truck or the same one after a repair; the latest check-in counts and the earlier Inspections stay.
- **Report a problem**, at any time that day, asks "What is the problem?" (required: **Send to Dave** waits for a note) and reports a Truck problem on the Truck of his latest check-in today; **Cancel** puts it away. Once sent the line says "Sent to Dave: Hydraulics leaking". A failed send says so and keeps the note to send again. It is offered only on Today, once he has checked in; after Check in again to another Truck, reports go on that one.
- An Inspection is never changed or deleted (ADR 0006). Until Drivers sign in through the Hub, whoever picked the name on the phone is trusted, so Inspections are tried on staging, not used as the real record.

## Settings (`/settings`)

- Every list on one page: Drivers, Trucks, Places, Materials, Jobs, Foremen, and the Inspection checklist; and, under Trucks, **Truck problems**.
- Each entry is a chip with its key detail: a Truck only its number (its HCSS code and id stay in the data for later and are not shown); a Place its kind, and a job site also its usual Foreman, as in "TIUNY · Job site · Brody", set in its panel.
- Tapping one opens a panel that saves as you type; **+ Add** adds one.
- **Remove** makes one inactive after asking (warning how many later days still hold a Driver's Assignments). Removed entries are listed apart and can be brought back; nothing is ever deleted.
- **▲▼** by each Driver, Place, Material and Inspection item put them in Dave's own order, which the lanes and the composer's chips (and later the Inspection) follow; a new or brought-back entry goes last (also one typed in the composer).
- **Truck problems**: what Drivers reported wrong with a Truck (each Needs repair in an Inspection, and each Report a problem during the day). Open ones first, then fixed ones, each newest first; each shows its Truck, note, who reported it and when ("Sample Driver B · Mon, Nov 23 9:00", US Eastern), with "· reported during the day" on one that came from Report a problem rather than an Inspection. **Mark fixed** asks "How it was fixed (optional)", then **Save** closes it; it stays listed under Fixed with when and the note ("Fixed Mon, Nov 23 10:15 · New flap fitted"), so a Truck's history is never lost. Only Drivers report problems: there is no Add.
- **Inspection checklist**: the items a Driver answers in an Inspection, starting with the paper Daily Truck Log & Inspection's 12 in its order (Dump box clean … Suspension). Each item's panel has its wording and an **Optional** switch (saved at once; the chip then says "Optional"), meaning a Driver may finish without answering it. New wording is used from the next Inspection on. The starting items are reference data loaded in every environment (`seed/inspection-items.sql`); loading it again never undoes Dave's changes. Drivers answer it when they check in (Driver view); each Inspection keeps the wording as it was.
