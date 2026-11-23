# One real Truck's data on staging

Amends the "synthetic data only" line of [`../specs/tech-stack.md`](../specs/tech-stack.md).

Trips can only be judged on real movements, and HCSS Fleet's API refuses access, so Dave imports Fleet exports for one real Truck into **staging**. Staging may therefore hold that Truck's real data: the Truck and its HCSS code, the Drivers who drive it, the real Places with their geofence codes, the Fleet exports' visits, and the Assignments Dave plans for it. Dave enters all of it through the app (Settings, the board, Fleet imports); none of it is written into the repository, which is public. Previews and local stay synthetic. Imports are accepted only where `ENVIRONMENT` is `local`, `preview`, `staging` or `test`, so production takes none until sign-in exists. Staging stays behind Cloudflare Access (Schrex Dev members only).

## Considered Options

- **A seed file with the real Truck, Driver and Places.** Rejected: the repository is public, and the fixture's rule is that nothing in it is real.
- **Keep staging synthetic; test real exports only locally.** Rejected: Dave and the Drivers review on staging, and the point is to see a real day on the real screens.
- **Use production.** Rejected: it is not set up, and the Worker has no sign-in.

## Consequences

- Settings gains a Truck's HCSS code and a Place's geofence code, so the setup can be done without a seed.
- When a second real Truck comes on, it is set up the same way; this ADR covers one Truck and should be revisited before more.
