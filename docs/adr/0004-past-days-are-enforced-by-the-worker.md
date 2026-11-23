# Past days are enforced by the Worker, in US Eastern time

Days before today are read-only, and the Worker is what refuses the change: it works out today in US Eastern time from its own clock and rejects adds, moves, changes and deletes that touch a past day (see `docs/api.md` for the refusals). The page may grey out past days, but that is only a courtesy.

This differs from the Daily Schedule, which locks a day in the page by the Scheduler's computer clock. A rule held in the page depends on that device's clock and time zone and is bypassed by a stale tab or another device. Held in the Worker, the rule is the same on every device.

## Considered Options

- **Lock in the page by the device's clock, as the Daily Schedule does.** Rejected: the rule would vary with each device's clock and time zone, and an open tab could keep editing after midnight.
- **Lock by UTC date.** Rejected: UTC midnight falls in the Eastern evening, when Dave plans the next day, so "today" would roll over too early.
