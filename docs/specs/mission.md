# Mission

Status: draft, 23 Nov 2026. Drawn from `GLOSSARY.md`, `docs/design/dispatch-board-decisions.md`, `docs/design/system-design.html` and the ADRs. Points marked **(to confirm)** are still open.

## In one sentence

Turn Dave's plan for the day into a finished **Truck log** for every Truck, every day, built from what the Truck, the Driver and Dave already do, so that nobody types it.

## The problem today

- Every evening Dave posts the next day's work for the Drivers in Slack #trucks. The posts are loose: a Driver, a Foreman or site ("Brody at TIUNY"), sometimes a Material, sometimes a truck number. They give no quantities, no job numbers and no order.
- Changes during the day are made by phone, so the written plan is out of date by mid-morning.
- Nobody confirms what was actually done. Which Truck went where, how many Loads, what Material, with which Ticket, and the miles and hours are pieced together afterwards, if at all.
- The Trucks already know where they went (HCSS Fleet), and the plants already hand out Tickets. That record is never joined to the plan.

## What the app is

One pipeline with four steps. Each step fills part of the Truck log:

1. **Plan.** Dave plans each Driver's day as Assignments in order, and Assigns each to its Driver. Drivers see their day on their phone, with every later change marked.
2. **Check in.** The Driver confirms which Truck he took and does the Inspection. Anything that Needs repair becomes a Truck problem that Dave sees.
3. **Trips.** The Truck's own movements become Trips. A Trip that matches an Assignment's pick-up and drop-off is a Load.
4. **Close the day.** The Driver photographs each Ticket and signs off; Dave answers what is left. The result is the Truck log: who drove, the Inspection, the Trips and Loads with their Tickets, miles and hours.

## Who it is for

- **Dave, the dispatcher.** He plans fast, changes plans all day, and sees what is happening without phoning anyone.
- **The Drivers** (about 3 to 4, on about 6 Trucks). They know what to do and in what order, and they answer only what the app cannot work out for itself.
- **Whoever uses the Truck log** (to confirm). The candidates are job costing, payroll, billing, the stone-invoice matching, and DOT inspection records. Evidence: the paper **Daily Truck Log & Inspection** the Drivers fill in today has, per order, Customer name, Job name, Pickup, Dropoff, Material, # of loads, # of tons and Trucking hours, plus total hours, start and end miles, the inspection checklist and the Driver's signature. That points to billing customers and hours, alongside the inspection record. The app's Truck log replaces that paper.

## Principles

- **Nobody types the log.** Trips come from the Truck, quantities come from Tickets, and hours and miles come from the meters. People answer only what is left blank.
- **Faster than the Slack message.** If planning a day takes Dave longer than posting in #trucks, the app has failed.
- **Changes are normal.** Assigned work changes all day. Drivers see every change at once and marked, with no lock and no "Assign again" (ADR 0005, which replaced ADR 0003's day-level Send).
- **Nothing is lost.** Entries are made inactive, never deleted. A cancelled Assignment is kept: the Driver sees it cancelled, and Dave or the Driver only clears it out of view (Discard, Dismiss). An Inspection is never edited, only followed by a newer one.
- **One set of words.** `GLOSSARY.md` is the vocabulary for code, UI and docs.
- **Rules live in the Worker.** Past days, Assign and the US Eastern day are enforced by the server, so they are the same on every device (ADR 0004).
- **Fits the Hub.** It is its own app, with its own Worker and database (ADR 0001), built on the Hub's stack and looks (ADR 0002), so plugging it into the Hub later is one forwarding step.

## Out of scope (for now)

- Billing, rates and invoicing, even though the Hub's old Dispatch page has them.
- Drivers picking their own work: Dave assigns everything.
- Grounding a Truck automatically. The app reports Truck problems but never takes a Truck out of service.
- Slack or text messages.
- Pushing the Truck log to HeavyJob or payroll. That is a later decision.

## How we will know it works (to confirm)

- Dave stops posting the day in #trucks.
- Drivers stop calling to ask what is next.
- Every Truck has a complete Truck log by 9 AM the next day, with no blanks.
