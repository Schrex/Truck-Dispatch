# Answering Unplanned work is allowed on a past day

Amends [ADR 0004](0004-past-days-are-enforced-by-the-worker.md).

Unplanned work only shows up once the Truck's Trips are in, so Dave answers it the next morning, when its day is already past and ADR 0004 makes that day read-only. Answering it records what happened, not a plan, so the Worker accepts the three answers on a past day: **make an Assignment** for it (Assigned at once, never Added, marked "From the Truck", with no notice to the Driver), **link it to an Assignment** (recorded as a change to that Assignment's route from the time of the work's first Trip, so the matching rules count its Loads), or **not a haul**. Each answer may only touch that Unplanned work's own Driver, Truck and day. Every other add, move, change or delete on a past day is still refused.

## Considered Options

- **Answer it on today instead, pointing back at the day.** Rejected: the Truck log is per Truck per day, and its Orders must be that day's Assignments.
- **Unlock the past day for Dave.** Rejected: it would undo ADR 0004 for every kind of change, not just recording what the Truck did.
- **Keep the answers on the Unplanned work itself, never as an Assignment.** Rejected: the Truck log, Loads, Job and Trucking hours would all need a second kind of Order.
