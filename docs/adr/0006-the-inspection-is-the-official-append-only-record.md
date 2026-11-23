# The Inspection is the official, append-only record

An **Inspection** replaces the paper Daily Truck Log & Inspection, so it is the official record of a Truck's condition before it went out, and phase 3 reads it to say who drove each Truck ("whoever last inspected that Truck before it"). A record that can be edited afterwards proves nothing, so an Inspection is only ever added: the Worker has no route that changes or deletes one (405), and the database itself refuses an update to `inspections` or `inspection_answers`. A Driver who got something wrong, swaps Trucks or re-inspects after a repair **checks in again**; the newer Inspection counts (newest `done_at`, ties by insertion order) and the earlier one stays. Each answer copies its item's wording, so renaming or removing a checklist item never rewrites a past Inspection.

What the record says is fixed by the Worker, not the phone: the date is the Worker's US Eastern today (any other is refused, as past days are in ADR 0004), and `done_at` is the Worker's clock as an exact UTC moment. The phone makes the Inspection's id (a UUID) when the Driver starts it, so a Finish retried after a lost reply answers the Inspection already saved and never saves it twice.

**It is not used as the real record until Drivers sign in through the Hub.** Until then the Driver view trusts whichever name was picked on the phone, so anyone could check in as anyone. Phase 2 is built and tried on staging; the paper form stays the record until sign-in exists. The Driver comes from the request body (`driverId`) for now, and the Inspection stores only that Driver's id, so sign-in can supply it later (and the Worker can refuse a body that disagrees) without a migration.

## Considered Options

- **Let the Driver edit or delete an Inspection the same day.** Rejected: an editable record is not evidence, and phase 3's "who drove it" would change after the fact. Checking in again covers every mistake.
- **One check-in per Driver per day, replaced when he checks in again.** Rejected: it loses the morning's Inspection of the first Truck, which is exactly what a swap or a repair needs kept.
- **Date and time sent by the phone.** Rejected: a phone's clock and time zone vary, and a tab left open overnight would date this morning's Inspection yesterday.
- **The Worker makes the id.** Rejected: a Finish whose reply is lost would be saved again on retry.
- **Wait for sign-in before building check-in.** Rejected: the Inspection, the Board's check-in line and Truck problems can be tried on staging now; only who is checking in is trusted for the time being.
