# How it works today

What the app does as built, page by page. Words in capitals are defined in [`GLOSSARY.md`](../GLOSSARY.md); the API behind each action is in [`api.md`](api.md). It is a standalone Cloudflare Worker backed by D1 with **synthetic** Drivers, Trucks, Jobs, Places, Materials and Foremen only. Hub integration (at `/truck-dispatch/`), sign-in and production are later phases ([roadmap](specs/roadmap.md)).

## Dispatch board (`/`)

### Lanes
- Opens on the next **Working day** (US Eastern; on a Friday, Monday).
- One lane per Driver (name and usual Truck; a removed Driver only on a day he has work), and an Unassigned lane last.
- Each lane shows that day's **Assignments** as blocks in order, reading "From → To" (or the note), marked First (the first that is not cancelled) and Then.
- A block shows the Assignment's Foreman beside its job site ("TIUNY (Brody)"), and the Truck: one the Assignment names shows plainly; with none named ("His own", the Driver takes his usual Truck) his usual Truck shows in grey, or nothing if he has none.
- Above the lanes, the day's count leaves cancelled Assignments out.

### Adding (the composer)
- The **+** on a lane (Unassigned included) opens the composer in that lane.
- Pick up and Drop off are rows of Place chips, and "Hauling what?" is Material chips, each with "Or type it" for a name not in the list (found, brought back or added by the Worker).
- A Foreman chip is filled in with the drop-off's usual Foreman if it is a job site, otherwise the pick-up's; Dave can change or clear it.
- "Note or other truck" opens the Truck chips ("His own" first, the default) and the note.
- A sentence previews it. Save needs only the day, puts it last in the lane and folds the composer; the next **+** (any lane) starts with the same Places and Material until **Close**.

### Changing an Assignment
- Tapping a block opens it in its lane (one at a time; tapping again closes it) as a sentence of chips, Driver, Material, From, To, Truck and Foreman, with its note.
- Tapping a chip offers that list (Unassigned for the Driver, His own for the Truck, "Leave blank" for the rest; From, To and Material also "Or type it", as in the composer, saved by name on Enter or on leaving the box). Each pick, or the note when left, saves on its own.
- A new Driver puts it last in his lane. On a Sent day, a new Driver (or Unassigned) cancels it for the first Driver and adds it, marked Added, last in the new lane, where it stays open; on a Draft day it simply moves.
- **Do this first** and **Do this later** move it one place in its lane, each left out at that end.
- **✕** takes it off the day: on a Draft day it says Delete and deletes it; on a Sent day it says Cancel, and the Assignment stays in its place, struck through and greyed, marked Cancelled, and opens only to **Put back**, which restores it (both count as Changed).

### Days
- The header shows the day's short date and its word ("Mon, Nov 23 · Next Monday", with a Holiday's name).
- An arrow each side names the Working day it goes to, skipping weekends and the six Holidays; the left and right arrow keys do the same when no field has the focus. **Back to** returns to the next Working day from any other day.
- A day with no Assignments at all (cancelled ones count) says "Nothing planned for Mon, Nov 23" and saves nothing just for being looked at.
- **Start from**: on today or a later empty day, copies the latest earlier day with Assignments ("Start from Thu, Nov 19"): each Assignment's Driver, order, Places, Material, Foreman and named Truck, without notes or cancelled ones, leaving out removed Places, Materials, Trucks and Foremen; a removed Driver's work goes to Unassigned.
- **Copy to**: a day before today with Assignments offers to copy it to the next Working day while that day is still empty, by the same rules, then shows it.
- Neither is offered once the target day has Assignments.

### Send
- A Draft day says when it was last saved; **Send** gives it to the Drivers (one tap, no warnings; ADR 0003).
- A Draft day with Assignments says "Drivers can't see this day until you Send." beside **Send**.

### Week strip
- A tile for each day Monday to Friday and narrow Saturday and Sunday tiles; today's says Today and the next day's Tomorrow; the day on screen is filled and today outlined.
- Each tile shows the day's state (Sent, Changed, Not sent, "2 unassigned" on a Draft, or "–" for nothing) and a Holiday's name. A day whose Assignments are all cancelled still has them, so it is not "–"; cancelled ones are never counted unassigned, since they are off the day.
- Tapping a tile shows that day; the pager ("Nov 16 to Nov 22") moves a week at a time keeping the weekday.
- The strip reads the states again after any change on the Board and when the page regains the focus (if the week cannot be read, it says so under the tiles, which still show their days), and scrolls sideways on a phone.

## Driver view (`/driver`)

- **Scheduler | Driver** in the header switches to it. The first time it asks "Who are you?" with the active Drivers as large buttons; the device remembers the Driver and the view in its browser storage (nothing is saved in the database), so it opens on his day.
- **← Drivers** (top left) goes back to "Who are you?"; **Scheduler** switches back.
- It shows one of his days at a time, opening on Today: **Yesterday | Today | Tomorrow** are one tap (calendar days, so a Sent Saturday shows on Friday), and **‹ ›** step one calendar day at a time, weekends included.
- When Dave has Sent him work beyond tomorrow, **Next from Dave: Mon, Nov 23 →** goes there.
- A day not Sent says "Dave hasn't sent Monday yet."; a Sent day with nothing for him says so.
- Otherwise his Assignments are large cards in Dave's order with the Material, Pick up, Drop off, the Foreman (when there is one) and the note, and "Take Truck 53 for this one" when a Truck is named.
- Marks: "Changed by Dave" with what each field was when Sent ("was Cobblestone"), "Added by Dave", or struck through and "Cancelled by Dave". Given to another Driver after the Send, it shows Cancelled to the first and Added to the second.
- It reads today, the day shown and his next Sent day again whenever the page regains the focus; Today moves on with the clock, a picked day stays.

## Settings (`/settings`)

- Every list on one page: Drivers, Trucks, Places, Materials, Jobs, Foremen.
- Each entry is a chip with its key detail: a Truck only its number (its HCSS code and id stay in the data for later and are not shown); a Place its kind, and a job site also its usual Foreman, as in "TIUNY · Job site · Brody", set in its panel.
- Tapping one opens a panel that saves as you type; **+ Add** adds one.
- **Remove** makes one inactive after asking (warning how many later days still hold a Driver's Assignments). Removed entries are listed apart and can be brought back; nothing is ever deleted.
- **▲▼** by each Driver, Place and Material put them in Dave's own order, which the lanes and the composer's chips follow; a new or brought-back entry goes last (also one typed in the composer).
