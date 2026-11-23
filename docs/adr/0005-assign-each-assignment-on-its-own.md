# Assign each Assignment on its own, not Send a day

Supersedes [ADR 0003](0003-send-per-day-without-a-lock.md).

Dave found one Send for a whole day awkward: he plans a day piece by piece, and work without a Driver held the rest of the day back or went out half planned. So each Assignment is given to its Driver on its own: a Draft block (with a Driver) has an **Assign** button, and only an Assigned Assignment is seen by its Driver. An Unassigned one stays a Draft until Dave gives it a Driver and Assigns it. There is no Send, and no "Assign all".

What ADR 0003 decided about a Sent day now holds for each Assigned Assignment: no lock and no Assign again; every change Dave makes to it reaches the Driver at once, marked Changed (measured from when it was Assigned); ✕ cancels it rather than deleting it. A Draft is deleted by ✕ and marks nothing when changed.

Giving an Assigned Assignment to another Driver cancels it for the first and Assigns the copy straight to the new one (Added), since picking the Driver is already Dave's decision; giving it to Unassigned leaves a Draft copy there. **Added** now means Assigned on its own day (or handed over from another Driver), since there is no Send to measure from. Start from and Copy to make only Drafts.

## Considered Options

- **Keep Send per day.** Rejected: the reason for this change.
- **Picking a Driver releases it (Draft = Unassigned).** Rejected: Start from copies a day with its Drivers, and Dave adds work in a Driver's lane while still planning, so Drivers would see half-made days.
- **Added = Assigned after the Driver already had Assigned work that day.** Rejected: Assigning a day's blocks one after another ahead of time would mark all but the first.
- **Drivers take Unassigned work themselves.** Rejected for now: Dave sets every Driver's work and order.
