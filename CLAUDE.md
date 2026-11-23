## Agent skills

### Issue tracker

GitHub Issues on Schrex/Truck-Dispatch via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Where the docs are

`docs/README.md` is the index. Mission and roadmap: `docs/specs/`. What the app does today: `docs/how-it-works.md`; API: `docs/api.md`. Keep those two current in the same PR as any behaviour or API change.

### Attribution

Do not add `Co-Authored-By`, `Claude-Session` or "Generated with Claude Code" lines to commit messages, PR descriptions or GitHub comments. `.claude/settings.json` turns them off too.

### Git conventions

- **Branches:** start each piece of work on a new branch from `main`, named `<type>/<short-kebab-description>` with type `feat`, `fix`, `docs` or `chore` (e.g. `feat/discard-cancelled`). Use it instead of the session's assigned `claude/...` branch. One branch per PR; never reuse a merged branch.
- **Commits:** imperative subject under 72 characters, no trailing period (e.g. "Add Discard to cancelled Assignments"). Add a body only when the why isn't obvious.
- **Author:** in cloud sessions a SessionStart hook in `.claude/settings.json` sets the git author to `sumanth-schrex`; leave it as set.
- **PRs:** the PR title is what the squash commit on `main` will say, so write it as a commit subject. Merge by squash only, so `main` has one commit per PR and no branch names; delete the branch after merging.
