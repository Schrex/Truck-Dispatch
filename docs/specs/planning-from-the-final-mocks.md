# Spec: planning from the final mocks (phase 1)

Status: agreed in a design grilling on 2026-11-21. Words in capitals (Assignment, Driver, Truck, Place, Job, Foreman, Material, Unassigned, Send, Draft, Changed, Working day, Inspection, Trip, Load) are the ones in `GLOSSARY.md`. The full set of decisions, including phases 2 to 4 and the target schema, is in `docs/design/dispatch-board-decisions.md` ("Final mocks").

## Problem Statement

Dave plans the Drivers' days on a board that does not match how the work happens. One dialog with dropdowns per Assignment is slow when a call comes in mid-morning. The board cannot say in what order a Driver should do his Assignments, cannot take one off a Driver's day without deleting it, and shows every half-made change to the Drivers the moment it is saved, so planning Monday on Friday afternoon puts drafts on their phones. Moving between days means arrows and a date field with no sense of which days are planned, sent or still empty; Copy today only ever copies today, which is wrong on a Monday. The Drivers have no screen of their own: there is nowhere for Randy to open his phone and see what he is doing tomorrow and in what order. Settings is a set of tabs whose lists have no order of their own, so the chips and lanes come out alphabetical rather than in the order Dave thinks in.

The design mocks (F1 scheduler, F2 driver, F3 settings) and the Daily Schedule app's week strip show the intended answer.

## Solution

The board becomes the F1 scheduler: one lane per Driver and an Unassigned lane, each Assignment a block in the order Dave wants it done, a **+** on each lane that opens a composer of large chips (Pick up, Drop off, Hauling what, Truck, Note), and a **✕** on each Assignment. Typing a Place or Material that is not in the lists adds it. An Assignment names a Truck only when the work needs a certain one; otherwise the Driver takes his own.

Days work as they do in the Daily Schedule: a week strip in the header with Today and Tomorrow on its tiles and each day's state, arrows that skip weekends and Holidays, and the board opening on the next Working day. A day is a Draft that the Drivers cannot see until Dave taps **Send**; after that, every change reaches them at once and is marked "Changed by Dave". An empty day offers **Start from** the latest earlier day that has Assignments.

A **Scheduler | Driver** switch in the header gives each Driver his own view until the Hub's sign-in exists: he picks his name once, his phone remembers it, and he sees his Sent Assignments in order, with any Changed or cancelled ones marked.

Settings becomes the F3 single page with sections for Drivers, Trucks, Places, Materials, Jobs and Foremen, each list in an order Dave sets, and a usual Foreman on a job-site Place.

Trips, Inspections, Tickets and sign-off are later phases and change nothing here, except that the schema leaves room for them.

## User Stories

### The scheduler's lanes

1. As Dave, I want one lane per active Driver, in the order I set in Settings, so that the board reads the way I think about my Drivers.
2. As Dave, I want each lane to show the Driver's name and his usual Truck, so that I know what he is driving without opening anything.
3. As Dave, I want an Unassigned lane at the bottom, so that I can plan work before I know who will do it.
4. As Dave, I want each Assignment drawn as a block reading "From → To" (or its note when it has no Places), so that a lane reads as a Driver's day at a glance.
5. As Dave, I want a lane's blocks in the order I set, marked First and Then, so that the Driver knows what to do first.
6. As Dave, I want no Now, "since 7:05", Busy or Free on the board yet, so that the board never claims to know progress it cannot see.
7. As Dave, I want an empty lane to say "Nothing planned yet", so that I can tell an empty day from one still loading.
8. As Dave, I want a block for a job site to show its Foreman, as in "TIUNY (Brody)", so that I know who is running the work.
9. As Dave, I want a cancelled Assignment to leave the lane, so that the lane shows only what the Driver will do.
10. As Dave, I want the board to fit an iPad in portrait and a phone, so that I can plan from either.

### Adding an Assignment

11. As Dave, I want a **+** on every lane, Unassigned included, so that adding work starts from who will do it.
12. As Dave, I want the composer to open inside the lane, under the Driver, so that I can see the rest of his day while I add to it.
13. As Dave, I want Pick up and Drop off as rows of Place chips in my Settings order, so that the usual Places are one tap.
14. As Dave, I want the same Place allowed for Pick up and Drop off, so that work inside one site can still be planned.
15. As Dave, I want "Hauling what?" as a row of Material chips, so that the usual Materials are one tap.
16. As Dave, I want to type a Place or Material that is not in the list, so that a new pit or a new material does not stop me.
17. As Dave, I want a typed name to become a new list entry when I save, so that every Assignment stays linked and the new entry shows up in Settings.
18. As Dave, I want a typed name that matches an existing entry, ignoring case, to use that entry, so that I do not create "villager" next to "Villager".
19. As Dave, I want a new Place made this way to be marked "Not on the truck map yet" in Settings, so that I remember it needs its HCSS boundary.
20. As Dave, I want "Note or other truck" to show the Truck chips and the note, so that the common case stays short.
21. As Dave, I want the Truck to default to "His own", so that I only pick a Truck when the work needs a certain one.
22. As Dave, I want the Foreman filled from the drop-off job site's usual Foreman, and changeable, so that I do not pick Brody every time and can still name Mike on Tuesday.
23. As Dave, I want a sentence preview ("Randy hauls 2" minus from Villager to TIUNY (Brody)"), so that I can check what I am about to save.
24. As Dave, I want Save allowed with only the day, so that I can jot down work before I know the details.
25. As Dave, I want the new Assignment placed last in its lane, so that adding work never reshuffles the day.
26. As Dave, I want the composer to remember the last Places and Material I picked until I close it, so that giving the same haul to a second Driver is a few taps.
27. As Dave, I want "Close" to drop what I typed without saving, so that I can back out.

### Changing an Assignment

28. As Dave, I want to tap a block to open it as a sentence of chips (Driver, Material, From, To, Truck, Foreman) with its note, so that I change one part without re-entering the rest.
29. As Dave, I want to tap the Driver chip and pick another Driver or Unassigned, so that moving work between Drivers is one change.
30. As Dave, I want a moved Assignment placed last in its new lane, so that the other Driver's day keeps its order.
31. As Dave, I want "Do this first" and "Do this later" on an open block, so that I can reorder a Driver's day when a call changes priorities.
32. As Dave, I want "Leave blank" on every chip row, so that I can clear a part.
33. As Dave, I want changes saved as I make them, so that nothing is lost if the iPad sleeps.

### Taking an Assignment off

34. As Dave, I want a **✕** on an open Assignment, so that taking work off a Driver's day is one tap.
35. As Dave, I want ✕ on a Draft day to delete the Assignment, so that planning mistakes leave nothing behind.
36. As Dave, I want ✕ on a Sent day to cancel it rather than delete it, so that a Driver who has seen it is told it is off and the trip log can later explain why it has no Trips.
37. As Dave, I want "Put back" on a cancelled Assignment, so that a call-off that is called back on is one tap.

### Days

38. As Dave, I want the board to open on the next Working day, so that the evening routine starts on the right day, and on a Friday that is Monday.
39. As Dave, I want a week strip with a tile for Monday to Friday and narrow tiles for Saturday and Sunday, so that any day of the week is one tap.
40. As Dave, I want today's tile to say "Today" and the next day's "Tomorrow", so that I always know which day I am planning.
41. As Dave, I want the chosen day's tile filled and today's outlined, so that I can tell them apart.
42. As Dave, I want each tile to show the day's state, as Sent, Changed, Not sent, "2 unassigned" or "–", so that I know what is left to do this week.
43. As Dave, I want an arrow each side that names the day it goes to and skips weekends and Holidays, so that one tap goes to the next day anyone works.
44. As Dave, I want the left and right arrow keys to do the same when no field has the focus, so that I can step through days from a keyboard.
45. As Dave, I want a week pager, so that I can reach a day several weeks back.
46. As Dave, I want "Back to (next Working day)" whenever I am on another day, so that one tap returns me to the day I am here to plan.
47. As Dave, I want New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving and Christmas named on their tiles, so that an empty Holiday is not a surprise; I can still plan and Send them.
48. As Dave, I want a short date in the header ("Mon, Nov 23") with a state line ("Draft · not sent yet · saved 4:12 PM"), so that I know the day's state and that my work is saved.
49. As Dave, I want days before today to be read-only, so that I cannot change what the Drivers already did.

### Sending

50. As Dave, I want a new day to be a Draft that no Driver can see, so that I can plan Monday on Friday without my drafts landing on their phones.
51. As Dave, I want one **Send** button for the day, so that the Drivers get the day when it is ready.
52. As Dave, I want Send to ask before sending a day later than the next Working day, so that I do not put Wednesday on their phones in place of Tuesday by accident.
53. As Dave, I want no lock and no "Send again" once a day is Sent, so that a mid-morning change reaches the Driver at once.
54. As Dave, I want the tile to say Changed once I have changed or cancelled anything after the Send, so that I know the Drivers have seen changes since.
55. As Dave, I want Send to refuse an empty day, so that the Drivers are never sent nothing.

### Starting a day

56. As Dave, I want an empty day to say "Nothing planned for Mon, Nov 23" and save nothing, so that looking at a day never creates anything.
57. As Dave, I want "Start from (the latest earlier day with Assignments)" on an empty day, so that a week on the same work takes one tap.
58. As Dave, I want Start from to keep each Assignment's Driver, order, Places, Material, Foreman and named Truck, so that the copy is the same day again.
59. As Dave, I want Start from to drop notes and cancelled Assignments, so that yesterday's words and call-offs are not sent again.
60. As Dave, I want Start from to skip Drivers, Places and Materials that have been made inactive, so that the copy holds only what exists now. An Assignment whose Driver is inactive goes to Unassigned.
61. As Dave, I want "Copy to (next Working day)" on a past day while that day is still empty, so that I can repeat a good day in one tap.
62. As Dave, I want neither offered once the day has Assignments, so that a copy never adds to or replaces work.

### The Driver view

63. As a Driver, I want a **Scheduler | Driver** switch in the header, so that I can get to my own view.
64. As a Driver, I want to be asked "Who are you?" once with the active Drivers as large buttons, so that I can pick myself with gloves on.
65. As a Driver, I want my phone to remember my name and the Driver view, so that it opens on my day every morning.
66. As a Driver, I want "Not you?" to pick again, so that a shared phone can change hands.
67. As a Driver, I want to see today and the next Working day, so that I know what I am doing now and tomorrow.
68. As a Driver, I want my Assignments as large cards in Dave's order, each with Material, Pick up and Drop off, and the note, so that I can read them from the cab.
69. As a Driver, I want a card to say "Take Truck 53 for this one" when Dave named a Truck, so that I know when to switch.
70. As a Driver, I want a card Dave changed after Sending marked "Changed by Dave", so that I notice what is different.
71. As a Driver, I want a cancelled card struck through and marked "Cancelled by Dave", so that I know not to go.
72. As a Driver, I want a day Dave has not Sent to say "Dave hasn't sent Monday yet.", so that I do not mistake it for a day off.
73. As a Driver, I want a Sent day with nothing for me to say so, so that I know I have no Assignments.
74. As a Driver, I want the view to refresh when I come back to it, so that I see Dave's latest changes.
75. As Dave, I want to switch back to Scheduler from the same toggle, so that my iPad is not stuck in a Driver's view.

### Settings

76. As Dave, I want Settings as one page with sections for Drivers, Trucks, Places, Materials, Jobs and Foremen, so that I can see every list at once.
77. As Dave, I want each entry shown as a chip with its key detail (a Driver's usual Truck, a Place's kind and usual Foreman, a Truck's HCSS link), so that I can check the lists without opening them.
78. As Dave, I want to tap a chip to edit it in a panel, saving as I go, so that changes are quick.
79. As Dave, I want "+ Add" on each section, so that I can add entries here as well as from the composer.
80. As Dave, I want to put Drivers, Places and Materials in my own order with ▲▼ (or drag), so that lanes and chips follow it.
81. As Dave, I want a Place's kind offered as Job site, Plant and Shop or yard, so that the choice is simple; a yard already saved keeps showing as Shop or yard.
82. As Dave, I want a usual Foreman on a job-site Place, so that new Assignments there fill him in.
83. As Dave, I want a Truck's panel to say "Linked to HCSS Fleet" or "Not linked yet", so that I know which Trucks will have Trips counted later.
84. As Dave, I want a Place's panel to say "On the truck map" or "Not on the truck map yet", so that I know which Places will match Trips later.
85. As Dave, I want "Remove" to make an entry inactive after asking, so that old Assignments keep its name; nothing is ever deleted.
86. As Dave, I want inactive entries listed apart and able to come back, so that a returning Driver or a reopened pit is one tap.

### Errors and safety

87. As Dave, I want a clear message when a list or a day cannot load, so that I never plan on a half-loaded board.
88. As Dave, I want a save that fails to say so and keep what I typed, so that I can try again.
89. As Dave, I want the Worker to refuse changes to a past day, so that the rule holds whichever device I use.

## Implementation Decisions

### Schema (one migration; only adds)

- Assignments gain a **position** (integer, the order within its date and Driver, Unassigned counted as one lane) and a **cancelled time** (set by ✕ on a Sent day; a cancelled Assignment is kept).
- An Assignment's Truck now means "a certain truck"; no Truck means the Driver's own. Existing rows keep their Truck. Picking a Driver no longer fills a Truck in.
- A new **day sends** table, one row per Sent day with the time it was first Sent. A day with no row is a Draft.
- Drivers, Places and Materials gain a **sort order**. Places gain a **usual Foreman**.
- The target schema for phases 2 to 4 is in the design doc and is not migrated now. The unused orders table stays until a later release.

From the design doc, the phase 1 part:

```
assignments   + position INTEGER NOT NULL DEFAULT 0
              + cancelled_at TEXT
day_sends     date PRIMARY KEY, sent_at
drivers       + sort_order INTEGER
places        + sort_order INTEGER, + usual_foreman_id -> foremen
materials     + sort_order INTEGER
```

### Day rules (new pure module shared by the Worker and the page)

- Today in US Eastern from the Worker's clock, as now.
- **Working day**: a weekday that is not one of the six Holidays, worked out by rule (fixed dates, last Monday of May, first Monday of September, fourth Thursday of November); a weekend Holiday is not moved. Next and previous Working day pass over both.
- The word for a date relative to today (Today, Tomorrow, Yesterday, "This Thursday", …), arrow targets and labels, the week heading, and a Holiday's name. This follows the Daily Schedule's day navigation and its tests.
- **Day state** for a date from its Assignments and its send: none ("–"), Draft (with the count Unassigned), Sent, Changed. Changed means an Assignment on the day was changed, cancelled or added after the send.
- **Changed by Dave** for one Assignment: its last change or cancellation is after its day's send.

### API changes

- A day's Assignments answer with each Assignment's position and cancelled time and whether it is Changed, ordered by lane (Driver sort order, Unassigned last), then position. The day's answer also carries its sent time, or none.
- A new read of a week's day states, asked by its Monday, answering seven entries (state, count Unassigned, Holiday name) for the strip.
- Adding an Assignment puts it last in its lane. Changing its Driver puts it last in the new lane. A move within a lane takes the new position and renumbers the lane.
- Adding or changing an Assignment may give a new Place or Material by name instead of an id; the Worker finds an entry with that name ignoring case or creates it (a Place with no kind), in the same request.
- **✕**: delete on a Draft day; on a Sent day it sets the cancelled time instead. **Put back** clears it.
- **Send** a day: records the send; refused (400) for a day with no Assignments or a day before today; sending again does nothing.
- **Start from**: copies the latest earlier day that has Assignments onto an empty day, per the stories above; refused (409) when the target day has Assignments. Copy today's route is replaced by it; Duplicate's use is removed from the page.
- **Driver view read**: one Driver's Assignments for a date, only if the day is Sent, otherwise an answer that says the day is a Draft; cancelled ones included and marked.
- The list routes accept and return the sort order, and a Place's usual Foreman. A reorder sets the sort order of a whole list in one request.
- Past days stay read-only in the Worker by US Eastern time, as now. Unlike the Daily Schedule, there is no lock on a Sent day.

### The page

- The board, the composer, the open-block editor, the week strip, the Driver view and Settings are new or rewritten components on the existing stack (React 18, Tailwind 3, shadcn/ui, the Hub's tokens; ADR-0002). The Daily Schedule's CSS is not copied, only its behaviour.
- The view (Scheduler or Driver) and the chosen Driver are kept in the device's browser storage; nothing about them is saved in the database.
- The Driver view refreshes on focus.
- The word "job" is used only for a Job; an Assignment is always called an assignment, even where the mocks say "job".

## Testing Decisions

A good test says what Dave or a Driver would see, or what the API answers, for a situation described in the glossary's words, and does not depend on how a rule is written. New tests follow the existing ones in reading that way.

Three seams, two of which exist:

- **The Worker's API, called as a request** against a real local D1 migrated from the migrations and reseeded for each test (prior art: the Worker's app tests). Covers: position on add, move and reorder; ✕ deleting on a Draft day and cancelling on a Sent day; Put back; Send and its refusals; Changed after a send; Start from and Copy to, every row of the copy rules, and their refusals; typed Place and Material names found or created; the Driver view read for a Draft and a Sent day; the week read; sort order and usual Foreman on the lists; past days still refused.
- **The page in jsdom with a fake API** (prior art: the App, Driver cards and Settings page tests). Covers: lanes in Settings order with Unassigned last; adding from a lane's **+** with chips and typed names; opening a block and changing a chip; moving to another Driver; ✕ and Put back; the strip's words and states and the arrows' labels; Send and its warning; Start from on an empty day; the Driver view's first-time pick, remembered choice, Draft message, Changed and cancelled marks; Settings sections, ordering and panels; load and save failures.
- **New: the day rules as pure functions** (prior art: the Daily Schedule's day navigation and schedule-rules tests). Covers: Working days across weekends and each Holiday in several years, the words and arrow targets across a week boundary and a Friday, day states for each case, and Changed.

The smoke test against staging gains read-only checks of the week read and the Driver view read.

## Out of Scope

- Phases 2 to 4: truck check-in, Inspections, Truck problems, Trips from HCSS Fleet, Now and Done on the board, Tickets, sign-off and the Truck log. Their decisions and schema are recorded in the design doc.
- Sign-in and roles; Hub integration; real per-Driver access. Anyone can open the Scheduler view.
- A Week view (Drivers by Monday to Friday).
- Reading the Daily Schedule's Off Work to grey out Drivers.
- Slack, texts or notifications to Drivers.
- Dropping the old orders table.
- Two people changing the same day at once: last save wins.

## Further Notes

- The mocks show Start now / Finished buttons; they are deliberately not built. Progress will come only from the Truck (phase 3).
- ✕ deleting only on a Draft day refines the grilling's "deletes on later days", so that a Driver who has seen an Assignment always sees it cancelled rather than gone.
- For Drivers to use the Driver view on staging, their emails have to be allowed by a Cloudflare Access policy on the staging Worker; that is a dashboard step.
- Two decisions may deserve an ADR: Send per day without a lock (unlike the Daily Schedule), and the Inspection as the official, append-only record (phase 2).
