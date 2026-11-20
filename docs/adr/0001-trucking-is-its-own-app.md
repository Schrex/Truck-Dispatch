# Trucking is its own app, not an extension of the hub's Dispatch

The hub (schreiber-hub-central) already has a Dispatch page and a `dispatch_orders` table, which carry billing, status and quantity fields Dave doesn't use. We are building trucking as a fresh app with its own Cloudflare Worker and D1 database, the way daily-schedule is built. It starts empty and keeps only the fields Dave needs. It will be joined to the hub (login and routing) only once staging works fully. The hub's Dispatch page and its data are parked as they are, and nothing is migrated.

## Considered Options

- **Extend `dispatch_orders` in the hub's Supabase.** Rejected: it would inherit the old fields and the hub's change process, and it breaks the hub-integration rule that each app has its own Worker and database.
