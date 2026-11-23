# Phase 1 spec: planning (user stories)

Status: **built**. Agreed in a design grilling on 21 Nov 2026 and revised after an independent review the same day and after trying it on staging on 22 Nov. Words in capitals are the ones in [`GLOSSARY.md`](../../GLOSSARY.md).

These stories record what phase 1 had to do and why ("so that…"). They are kept as written: the day-level **Send** in them (stories 32, 38, 44, 50, 53–56, 68, 71, 73, 74) was replaced on 23 Nov 2026 by Assigning each Assignment on its own ([ADR 0005](../adr/0005-assign-each-assignment-on-its-own.md)); [`how-it-works.md`](../how-it-works.md) has the behaviour as built now. Other docs cover the rest:
- What the app does now: [`../how-it-works.md`](../how-it-works.md). The API: [`../api.md`](../api.md). The schema: `migrations/`.
- The reasons behind the design: [`../design/dispatch-board-decisions.md`](../design/dispatch-board-decisions.md).
- What is out of scope: [`mission.md`](mission.md) and [`roadmap.md`](roadmap.md). How we test: [`tech-stack.md`](tech-stack.md#testing).

## User Stories

### The scheduler's lanes

1. As Dave, I want one lane per active Driver, in the order I set in Settings, plus a lane marked removed for any removed Driver who has Assignments that day, so that the board reads the way I think about my Drivers and no planned work is hidden.
2. As Dave, I want each lane to show the Driver's name and his usual Truck, so that I know what he is driving without opening anything.
3. As Dave, I want an Unassigned lane at the bottom, so that I can plan work before I know who will do it.
4. As Dave, I want each Assignment drawn as a block reading "From → To" (or its note when it has no Places), so that a lane reads as a Driver's day at a glance.
5. As Dave, I want a lane's blocks in the order I set, marked First and Then (a cancelled one neither, as it is off the day), so that the Driver knows what to do first.
6. As Dave, I want no Now, "since 7:05", Busy or Free on the board yet, so that the board never claims to know progress it cannot see.
7. As Dave, I want an empty lane to say "Nothing planned yet", so that I can tell an empty day from one still loading.
8. As Dave, I want a block for a job site to show its Foreman, as in "TIUNY (Brody)", so that I know who is running the work.
9. As Dave, I want a cancelled Assignment to stay in its place, struck through and greyed, so that I see what the Driver sees and can put it back.
10. As Dave, I want the board to fit an iPad in portrait and a phone, so that I can plan from either.

### Adding an Assignment

11. As Dave, I want a **+** on every lane, Unassigned included, so that adding work starts from who will do it.
12. As Dave, I want the composer to open inside the lane, under the Driver, so that I can see the rest of his day while I add to it.
13. As Dave, I want Pick up and Drop off as rows of Place chips in my Settings order, so that the usual Places are one tap.
14. As Dave, I want the same Place allowed for Pick up and Drop off, so that work inside one site can still be planned.
15. As Dave, I want "Hauling what?" as a row of Material chips, so that the usual Materials are one tap.
16. As Dave, I want to type a Place or Material that is not in the list, so that a new pit or a new material does not stop me.
17. As Dave, I want a typed name to become a new list entry when I save, placed last in the list's order, so that every Assignment stays linked and the new entry shows up in Settings.
18. As Dave, I want a typed name that matches an existing entry, ignoring case, to use that entry, and one that matches a removed entry to bring it back, so that I do not create "villager" next to "Villager".
19. As Dave, I want a new Place made this way to be marked "Not on the truck map yet" in Settings, so that I remember it needs its HCSS boundary.
20. As Dave, I want "Note or other truck" to show the Truck chips and the note, so that the common case stays short.
21. As Dave, I want the Truck to default to "His own", so that I only pick a Truck when the work needs a certain one.
22. As Dave, I want the Foreman filled from the drop-off's usual Foreman if it is a job site, otherwise the pick-up's, and changeable, so that I do not pick Brody every time, hauling out of TIUNY still names him, and I can still name Mike on Tuesday.
23. As Dave, I want a sentence preview ("Randy hauls 2" minus from Villager to TIUNY (Brody)"), so that I can check what I am about to save.
24. As Dave, I want Save allowed with only the day, so that I can jot down work before I know the details.
25. As Dave, I want the new Assignment placed last in its lane, so that adding work never reshuffles the day.
26. As Dave, I want the composer to fold when I Save and the next **+** to start with the last Places and Material I picked, until I close it, so that the lane is tidy and giving the same haul to a second Driver is a few taps.
27. As Dave, I want "Close" to drop what I typed without saving, so that I can back out.

### Changing an Assignment

28. As Dave, I want to tap a block to open it as a sentence of chips (Driver, Material, From, To, Truck, Foreman) with its note, so that I change one part without re-entering the rest.
29. As Dave, I want to tap the Driver chip and pick another Driver or Unassigned, so that moving work between Drivers is one change.
30. As Dave, I want a moved Assignment placed last in its new lane, so that the other Driver's day keeps its order.
31. As Dave, I want "Do this first" and "Do this later" on an open block, each moving it one place and hidden at the ends of the lane, so that I can reorder a Driver's day when a call changes priorities.
32. As Dave, I want giving work to another Driver on a Sent day to cancel it for the first Driver and add it for the other, so that the first Driver is told it is off his day.
33. As Dave, I want an Assignment's day fixed once it exists, so that work never disappears from a day without a trace; I use Start from, Copy to and ✕ to move work between days.
34. As Dave, I want "Leave blank" on every chip row, so that I can clear a part.
35. As Dave, I want each chip saved on its own as I change it, so that nothing is lost if the iPad sleeps and a change from my phone does not wipe one from my iPad.

### Taking an Assignment off

36. As Dave, I want a **✕** on an open Assignment, so that taking work off a Driver's day is one tap.
37. As Dave, I want ✕ on a Draft day to delete the Assignment, so that planning mistakes leave nothing behind.
38. As Dave, I want ✕ on a Sent day to cancel it rather than delete it, so that a Driver who has seen it is told it is off and the trip log can later explain why it has no Trips.
39. As Dave, I want to open a cancelled Assignment and tap "Put back", so that a call-off that is called back on is one tap.

### Days

40. As Dave, I want the board to open on the next Working day, so that the evening routine starts on the right day, and on a Friday that is Monday.
41. As Dave, I want a week strip with a tile for Monday to Friday and narrow tiles for Saturday and Sunday, so that any day of the week is one tap.
42. As Dave, I want today's tile to say "Today" and the next day's "Tomorrow", so that I always know which day I am planning.
43. As Dave, I want the chosen day's tile filled and today's outlined, so that I can tell them apart.
44. As Dave, I want each tile to show the day's state, as Sent, Changed, Not sent, "2 unassigned" (on a Draft) or "–", so that I know what is left to do this week.
45. As Dave, I want an arrow each side that names the day it goes to and skips weekends and Holidays, so that one tap goes to the next day anyone works.
46. As Dave, I want the left and right arrow keys to do the same when no field has the focus, so that I can step through days from a keyboard.
47. As Dave, I want a week pager, so that I can reach a day several weeks back.
48. As Dave, I want "Back to (next Working day)" whenever I am on another day, so that one tap returns me to the day I am here to plan.
49. As Dave, I want New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving and Christmas named on their tiles, so that an empty Holiday is not a surprise; I can still plan and Send them.
50. As Dave, I want a short date in the header ("Mon, Nov 23") with a state line ("Draft · not sent yet · saved 4:12 PM"), so that I know the day's state and that my work is saved.
51. As Dave, I want days before today to be read-only, so that I cannot change what the Drivers already did.

### Sending

> Replaced by per-Assignment Assign, with no day-level Send ([ADR 0005](../adr/0005-assign-each-assignment-on-its-own.md)).

52. As Dave, I want a new day to be a Draft that no Driver can see, so that I can plan Monday on Friday without my drafts landing on their phones.
53. As Dave, I want one **Send** button for the day, so that the Drivers get the day when it is ready.
54. As Dave, I want no lock and no "Send again" once a day is Sent, so that a mid-morning change reaches the Driver at once.
55. As Dave, I want the tile to say Changed once I have changed, cancelled, put back, moved or added anything after the Send, so that I know the Drivers have seen changes since.
56. As Dave, I want Send to refuse an empty day, so that the Drivers are never sent nothing.

### Starting a day

57. As Dave, I want a day with no Assignments at all (cancelled ones count) to say "Nothing planned for Mon, Nov 23" and save nothing, so that looking at a day never creates anything.
58. As Dave, I want "Start from (the latest earlier day with Assignments)" on an empty day, so that a week on the same work takes one tap.
59. As Dave, I want Start from to keep each Assignment's Driver, order, Places, Material, Foreman and named Truck, so that the copy is the same day again.
60. As Dave, I want Start from to drop notes and cancelled Assignments, so that yesterday's words and call-offs are not sent again.
61. As Dave, I want Start from to leave out Places, Materials, Trucks and Foremen that have been removed, so that the copy holds only what exists now. An Assignment whose Driver was removed goes to Unassigned.
62. As Dave, I want "Copy to (next Working day)" on a past day while that day is still empty, so that I can repeat a good day in one tap.
63. As Dave, I want neither offered once the day has Assignments, so that a copy never adds to or replaces work.

### The Driver view

64. As a Driver, I want a **Scheduler | Driver** switch in the header, so that I can get to my own view.
65. As a Driver, I want to be asked "Who are you?" once with the active Drivers as large buttons, so that I can pick myself with gloves on.
66. As a Driver, I want my phone to remember my name and the Driver view, so that it opens on my day every morning.
67. As a Driver, I want a way back to the list of Drivers (**Change**, beside my name under the title), so that a shared phone can change hands.
68. As a Driver, I want Yesterday, Today and Tomorrow one tap away, ‹ › to step to any other day, weekends included, and "Next from Dave" to take me to the next day he has Sent me beyond tomorrow, so that I know what I am doing now and next even on a weekend before a Monday.
69. As a Driver, I want my Assignments as large cards in Dave's order, each with Material, Pick up and Drop off, and the note, so that I can read them from the cab.
70. As a Driver, I want a card to say "Take Truck 53 for this one" when Dave named a Truck, so that I know when to switch.
71. As a Driver, I want a card Dave changed after Sending marked "Changed by Dave", with what it was before ("was Cobblestone"), and one he added after Sending marked "Added by Dave", so that I notice what is different.
72. As a Driver, I want a cancelled card struck through and marked "Cancelled by Dave", so that I know not to go.
73. As a Driver, I want a day Dave has not Sent to say "Dave hasn't sent Monday yet.", so that I do not mistake it for a day off.
74. As a Driver, I want a Sent day with nothing for me to say so, so that I know I have no Assignments.
75. As a Driver, I want the view to refresh, today included, when I come back to it, so that I see Dave's latest changes and a phone left overnight moves on to the new day.
76. As Dave, I want to switch back to Scheduler from the same toggle, so that my iPad is not stuck in a Driver's view.

### Settings

77. As Dave, I want Settings as one page with sections for Drivers, Trucks, Places, Materials, Jobs and Foremen, so that I can see every list at once.
78. As Dave, I want each entry shown as a chip with its key detail (a Driver's usual Truck, a Place's kind and usual Foreman, a Truck's HCSS link), so that I can check the lists without opening them.
79. As Dave, I want to tap a chip to edit it in a panel, saving as I go, so that changes are quick.
80. As Dave, I want "+ Add" on each section, so that I can add entries here as well as from the composer.
81. As Dave, I want to put Drivers, Places and Materials in my own order with ▲▼ (or drag), so that lanes and chips follow it.
82. As Dave, I want a Place's kind offered as Job site, Plant and Shop or yard, so that the choice is simple; a yard already saved keeps showing as Shop or yard.
83. As Dave, I want a usual Foreman on a job-site Place, so that new Assignments there fill him in.
84. As Dave, I want Settings to say nothing about HCSS on a Truck, so that the panel holds only what I manage; its HCSS code and id stay in the data and come from HCSS when Trips are counted later.
85. As Dave, I want a Place's panel to say "On the truck map" or "Not on the truck map yet", so that I know which Places will match Trips later.
86. As Dave, I want "Remove" to make an entry inactive after asking, and to warn when a Driver still has Assignments on later days, so that old Assignments keep its name and I know what is still planned for him; nothing is ever deleted.
87. As Dave, I want inactive entries listed apart and able to come back, so that a returning Driver or a reopened pit is one tap.

### Errors and safety

88. As Dave, I want a clear message when a list or a day cannot load, so that I never plan on a half-loaded board.
89. As Dave, I want a save that fails to say so and keep what I typed, so that I can try again.
90. As Dave, I want the Worker to refuse changes to a past day, so that the rule holds whichever device I use.
