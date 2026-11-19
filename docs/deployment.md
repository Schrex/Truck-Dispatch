# Previews and staging

| | Pull request preview | Staging |
|---|---|---|
| Trigger | Every push to a PR (`.github/workflows/pr.yml`) | Every merge to `main` (`.github/workflows/deploy.yml`) |
| Worker | `truck-dispatch-preview`, one version per PR | `truck-dispatch-staging` |
| Address | `https://pr-<n>-truck-dispatch-preview.<account>.workers.dev/truck-dispatch/` | `https://truck-dispatch-staging.<account>.workers.dev/truck-dispatch/` |
| D1 | `truck-dispatch-preview`, shared by open PRs | `truck-dispatch-staging` |
| Data | Synthetic drivers + orders added while reviewing | Synthetic drivers + orders added while testing (kept across deploys) |
| Protection | Cloudflare Access | Cloudflare Access |

Both run typecheck, tests and build as parallel jobs, build once, and then deploy that build. Neither touches the Hub or production Supabase.

## One-time Cloudflare setup

Done once by whoever owns the Cloudflare account.

1. **Create the databases** and put each id in `wrangler.jsonc` (replacing `REPLACE_WITH_DATABASE_ID`), then commit:
   ```bash
   bunx wrangler d1 create truck-dispatch-preview
   bunx wrangler d1 create truck-dispatch-staging
   ```
   Until then, CI fails the deploy step with a message pointing here.
2. **API token** (Cloudflare dashboard → My Profile → API Tokens): start from the "Edit Cloudflare Workers" template and add **Account → D1 → Edit**. Limit it to this account.
3. **GitHub secrets** (repo → Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Until both are set, PR previews are skipped with a notice.
4. **Cloudflare Access.** In Workers & Pages → each Worker → Settings → Domains & Routes, enable Cloudflare Access on the `workers.dev` address and on Preview URLs. Allow only your two emails.
5. **Smoke-test token.** In Zero Trust → Access → Service Auth, create a service token. Add a *Service Auth* policy for it on the staging Access application. Store it as GitHub secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. Without it the smoke test fails with "redirected to Cloudflare Access sign-in".
6. **Protect `main`** (repo → Settings → Branches): require a pull request, 1 approval, and the checks `typecheck`, `test`, `build`.

## Reviewing a preview

1. Open the PR. The bot comment has the preview link; it is also in the run summary under the **Checks** tab.
2. Sign in through Cloudflare Access with your email.
3. Try the change, e.g. add an order with **New Order** and check it shows on that day. Leave feedback on the PR.
4. A README or typo change only needs a diff review.

The comment updates on every push. Each PR keeps its own address, so two open PRs don't overwrite each other's page. They do share the preview database (see the database rules in the README).

## Staging

- **URL:** shown on the deploy run (Actions → *Deploy staging* → the run → `staging` environment link), and in the repo's **Environments** list.
- **Logs:** Actions → *Deploy staging*. The run summary records the deployed commit and each smoke-test check. Worker logs: Cloudflare dashboard → `truck-dispatch-staging` → Observability.
- **Order:** migrate → seed → deploy → smoke test. A failed migration stops before the new version goes live. One deploy runs at a time, and later merges wait.

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
