# Maintainer instructions

This repository is a small local CLI for one configured Obsidian vault. Keep
the implementation simple, explicit, and sequential. Do not add a database,
daemon, watcher, synchronization protocol, generic filesystem service,
transaction layer, rollback mechanism, or concurrency lock without a concrete
user requirement.

## Privacy and local data

- Never commit a real vault path, task text, note name, personal URL, token,
  credential, or `config/vault-tasks.local.json`.
- Use only synthetic fixtures in automated tests.
- Do not access or mutate a real vault without explicit user authorization.
- Treat CLI output from `query` and especially `archive-done` as private vault
  data; archive plans deliberately contain copied task blocks.

## Business rules

- Query mode is read-only. Keep vault selection in validated local config, not
  in query JSON.
- Archive mode is opt-in through the `archive` config object and applies
  eligible moves by default. `--dry-run` is the only preview-only path.
- Only a root task's terminal status/date and age decide whether its block is
  eligible. Once eligible, copy all indented descendants verbatim without
  evaluating their state or metadata.
- With `deleteEmptySourceNotes`, archive the complete original note and delete
  it only when no real checklist task remains after planning. Preserve prose,
  headings, frontmatter, and observations.
- Write archive content before changing the source. Duplicate archive content
  after interruption is acceptable; do not add complex transactional behavior.

## Change discipline

- Read `docs/query-mode.md` or `docs/archive-mode.md` before changing that
  mode, and update the applicable document with any behavior change.
- Prefer small pure functions and focused tests over abstractions.
- Keep configuration schema, examples, validation, and README consistent.
- Run `npm run check`, `npm run build`, and `git diff --check` before handing
  off a change.
