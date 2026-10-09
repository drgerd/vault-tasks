# Maintainer instructions

This repository ships the public npm CLI `@gerd/vault-tasks`. Keep it a small,
explicit, sequential, single-user Obsidian tool. Do not add a database, daemon,
watcher, synchronization protocol, generic filesystem service, transaction
layer, rollback mechanism, or concurrency lock without a concrete user
requirement. Read [docs/maintainer-guide.md](docs/maintainer-guide.md) before
changing user-facing behavior or preparing a release.

## Privacy and local data

- Never commit a real vault path, task text, note name, personal URL, token,
  credential, or `config/vault-tasks.local.json`.
- Use only synthetic fixtures in automated tests.
- Do not access or mutate a real vault without explicit user authorization.
- Treat CLI output from `query` and especially `archive-done` as private vault
  data; archive plans deliberately contain copied task blocks.

## Business rules

- Query mode is read-only. Keep vault selection in validated local config, not
  in query JSON or query CLI arguments.
- Archive mode is opt-in through the `archive` config object and applies
  eligible moves by default. Direct `archive-done --vault-root PATH` is the
  supported configuration-free path. `--dry-run` is the only preview-only
  path.
- In file configuration, `archiveRoot` and `sourceRoots` are required. Direct
  mode defaults to `Archive`, whole-vault source root `.`, 30 days, local host
  timezone, and `deleteEmptySourceNotes: true`. Whole-vault scanning must skip
  the archive root.
- Only a root task's terminal status/date and age decide whether its block is
  eligible. Once eligible, copy all indented descendants verbatim without
  evaluating their state or metadata.
- With `deleteEmptySourceNotes`, archive the complete original note and delete
  it when no real checklist task remains, including when the note was already
  task-free. Preserve prose, headings, frontmatter, and observations.
- Write archive content before changing the source. Duplicate archive content
  after interruption is acceptable; do not add complex transactional behavior.

## Change discipline

- Read `docs/query-mode.md` or `docs/archive-mode.md` before changing that
  mode, and update the applicable document with any behavior change.
- Prefer small pure functions and focused tests over abstractions.
- Keep CLI parsing/help, configuration schema, examples, validation, README,
  mode documentation, agent skill, and maintainer guide consistent.
- Public-facing invocation examples use `npx --yes @gerd/vault-tasks`; retain
  `node dist/cli/main.js` only where a checkout-development example is useful.
- A source change is not available through `npx` until a new package version
  has been published. Never publish to npm without explicit authorization.
- Run `npm run check`, `npm run build`, and `git diff --check` before handing
  off a change.
