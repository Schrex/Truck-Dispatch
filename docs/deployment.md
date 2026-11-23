# Previews and staging

| | Pull request preview | Staging |
|---|---|---|
| Trigger | Every push to a PR (`.github/workflows/pr.yml`) | Every merge to `main` (`.github/workflows/deploy.yml`) |
| Worker | `truck-dispatch-preview`, one version per PR | `truck-dispatch-staging` |
| Address | `https://pr-<n>-truck-dispatch-preview.schrex-dev.workers.dev/truck-dispatch/` | `https://truck-dispatch-staging.schrex-dev.workers.dev/truck-dispatch/` |
| D1 | `truck-dispatch-preview`, shared by open PRs | `truck-dispatch-staging` |
| Data | Synthetic drivers + orders added while reviewing | Synthetic drivers + orders added while testing (kept across deploys) |
| Protection | Cloudflare Access: Schrex Dev members only | Cloudflare Access: Schrex Dev members, plus the CI service token |

Both run typecheck, tests and build as parallel jobs, build once, and then deploy that build. A pull request also runs the browser end-to-end journeys (`e2e` job, see below). Neither touches the Hub or production Supabase.

## Accounts and access

| Where | What lives there | Who |
|---|---|---|
| Cloudflare account **Schrex Dev** | Truck Dispatch preview and staging Workers and D1 databases, Access (team `schrex-dev`) | Sumanth (Super Administrator), Prasad (Administrator) |
| Cloudflare production account | Hub, Daily Schedule, telematics; later Truck Dispatch production | Truck Dispatch CI has **no** token here |
| GitHub `Schrex/Truck-Dispatch` (public) | Code, PRs, secrets, the "Protect main" ruleset | Admins bypass the ruleset; writers need a PR, 1 approval and passing checks |

Cloudflare API tokens can only be limited per account, not per Worker or database. That is why Truck Dispatch has its own account: its CI token cannot reach Daily Schedule.

**GitHub secrets:** `CLOUDFLARE_API_TOKEN` (Schrex Dev only: Workers Scripts Edit, D1 Edit, Account Settings Read, 1-year expiry), `CLOUDFLARE_ACCOUNT_ID` (Schrex Dev), `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (service token `github-smoke-test`).

## One-time Cloudflare setup

Already done; kept here to rebuild it or to set up production later. Make sure the account picker says **Schrex Dev**.

1. **Databases.** Create them and put each id in `wrangler.jsonc` (replacing `REPLACE_WITH_DATABASE_ID`). When Wrangler asks *"add it on your behalf?"*, answer **n**: it would add the database to the top (laptop) section, not to `env.preview` or `env.staging`.
   ```bash
   bunx wrangler d1 create truck-dispatch-preview
   bunx wrangler d1 create truck-dispatch-staging
   ```
2. **API token** (My Profile → API Tokens → Create Token). Account Resources: **Schrex Dev** only, never "All accounts". Permissions: Workers Scripts Edit, D1 Edit, Account Settings Read. Remove the Zone row. Expiry: 1 year.
3. **GitHub secrets** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Until both are set, PR previews are skipped with a notice.
4. **Cloudflare Access.** Workers & Pages → each Worker → Settings → Domains & Routes → **Enable Access**. Scope **All traffic**, policy **Cloudflare account** (members of Schrex Dev). To give someone access, invite them to Schrex Dev.
5. **Smoke-test token.** Zero Trust → Access controls → Service credentials → Service Tokens → create `github-smoke-test`. On the **staging** application → Policies, add a policy with Action **Service Auth** (not Allow), Include → Service Token → `github-smoke-test`, then **Save** the application. Store the token as `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
   - Smoke test says **302 / redirected to sign-in**: the secrets are missing or empty.
   - **401**: Access does not know the token (wrong ID or secret).
   - **403**: the token is valid, but no policy on this application lets it in.
6. **Protect `main`** (Settings → Rules → Rulesets → "Protect main"): pull request with 1 approval, checks `typecheck`, `test`, `e2e`, `build`, no force push or deletion; Repository admin may bypass.

## Browser end-to-end job

The `e2e` job in `pr.yml` runs `bun run e2e` on every pull request: it builds the app, starts the built Worker with its own fresh local D1 (`.wrangler/e2e`, migrated and seeded) and the clock fixed with `NOW`, and drives a few whole journeys in headless Chromium. Any failing journey fails the job. It needs no secrets and touches no Cloudflare database.

- **Chromium** is installed by `bunx playwright install --with-deps chromium`; the download is cached in `~/.cache/ms-playwright` (keyed on `bun.lock`, so a Playwright upgrade downloads afresh).
- **No traces, screenshots or videos** are recorded. To look into a failure, run `bun run e2e` locally (add `--trace on` after `bunx playwright test` for a one-off trace, opened with `bunx playwright show-trace`).
- **Required check:** a repo admin adds `e2e` to the "Protect main" ruleset (step 6 above). Code cannot do this; until then a failing journey does not block a merge.

## Reviewing a preview

1. Open the PR. The bot comment has the preview link; it is also in the run summary under the **Checks** tab.
2. Sign in through Cloudflare Access with your email and the emailed code. Only members of Schrex Dev get in.
3. Try the change, e.g. add an order with **New Order** and check it shows on that day. Leave feedback on the PR.
4. A README or typo change only needs a diff review.

The comment updates on every push. Each PR keeps its own address, so two open PRs don't overwrite each other's page. They do share the preview database (see the database rules in the README).

## Staging

- **URL:** shown on the deploy run (Actions → *Deploy staging* → the run → `staging` environment link), and in the repo's **Environments** list.
- **Logs:** Actions → *Deploy staging*. The run summary records the deployed commit and each smoke-test check. Worker logs: Cloudflare dashboard → `truck-dispatch-staging` → Observability.
- **Order:** migrate → seed → deploy → smoke test. A failed migration stops before the new version goes live. One deploy runs at a time, and later merges wait.
- **Smoke test** (`scripts/smoke.mjs`): waits up to ~30 s for `/api/health` to report the new commit, then checks the page and API at `/` and `/truck-dispatch/`. Read-only: it never adds orders.
  - While Cloudflare spreads a version, some requests still reach the old one after health already reports the new one (the old Worker answers routes it doesn't know with 404 `not_found`). So every API answer carries an `X-Commit` header, and a check that gets an answer from another commit (or with no header) is retried for up to ~30 s. Any other failure fails the check at once.
  - A check that fails with *"still the old version after N tries"* means the new version never reached it: re-run the job, or look at the deployment in the Cloudflare dashboard.

### Redeploy a known-good commit

Actions → *Deploy staging* → **Run workflow** → paste the commit SHA. It runs the same checks and smoke test. Or roll back instantly to the previous version: `bunx wrangler rollback --name truck-dispatch-staging`.

Rolling back code **does not roll back D1**. An older version runs on the newer schema, so it only works because migrations only add.

### Recover from a migration failure

1. The deploy stopped, so the previous version is still live. Read the error in the *Migrate the staging database* step.
2. Check which migrations were applied: `bunx wrangler d1 migrations list truck-dispatch-staging --remote --env staging`.
3. Fix it **with a new migration** in a new PR. Never edit a migration that has run anywhere.
4. If data was damaged, restore the database to a point before the deploy (D1 Time Travel, last 30 days):
   ```bash
   bunx wrangler d1 time-travel info truck-dispatch-staging --env staging
   bunx wrangler d1 time-travel restore truck-dispatch-staging --env staging --timestamp=<before the deploy, RFC3339>
   ```
   This also removes anything added since that time.
5. If the preview database gets stuck on a broken PR's schema, it holds only test data. Delete it, create it again and update its id: `bunx wrangler d1 delete truck-dispatch-preview`.
