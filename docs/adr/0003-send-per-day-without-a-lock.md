# Send per day, with no lock after Send

**Superseded by [ADR 0005](0005-assign-each-assignment-on-its-own.md)** (23 Nov 2026): each Assignment is Assigned on its own; there is no day-level Send. Its "no lock after" still holds for an Assigned Assignment.

A day's plan is a Draft, invisible to Drivers ("Dave hasn't sent Monday yet."), until Dave taps Send. After Send there is no lock and no Send again: every change Dave makes reaches the Driver at once, marked "Changed by Dave" or "Added by Dave" (a cancelled Assignment is shown as "Cancelled by Dave"). Trucking changes a Sent day all day long, by phone call after phone call, so a Driver's view must follow Dave's board without extra steps.

This differs from the Daily Schedule, which locks a Sent day behind "Change this schedule" and needs "Send again" to publish edits. We take its Send and its marks, not its lock.

## Considered Options

- **The Daily Schedule's lock, with "Change this schedule" and "Send again".** Rejected: Sent days change all day in trucking, so Dave would unlock and resend again and again, and a Driver would work from a stale day whenever he forgot.
- **Hold changes in the browser until Dave sends them.** Rejected: unsent changes are lost when the page closes, and a second device (phone and iPad) would not see them.
