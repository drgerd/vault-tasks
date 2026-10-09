# Maintainer guide

This document is the handoff for a new maintainer or coding agent. It records
the product choices that are easy to lose while changing a small CLI.

## Distribution and entry points

The public distribution is [`@gerd/vault-tasks`](https://www.npmjs.com/package/@gerd/vault-tasks).
The source repository is [drgerd/vault-tasks](https://github.com/drgerd/vault-tasks).

Users should run the published CLI with:

```bash
npx --yes @gerd/vault-tasks <command>
```

The package exposes the `vault-tasks` binary through `package.json` `bin`.
The entry point must work when npm invokes it through a `.bin` symlink; do not
replace the resolved-path entrypoint check with a literal `process.argv[1]`
comparison. A source commit alone does not change `npx`: release a new npm
version before documenting behavior as available to npm users.

Use `node dist/cli/main.js` only for developing from a local checkout. It is
not the normal end-user installation path.

## Supported command shapes

| Need | Command and configuration |
| --- | --- |
| Inspect the public query schema | `npx --yes @gerd/vault-tasks schema` |
| Query or explain tasks | Set `VAULT_TASKS_CONFIG` in the same command; query JSON never contains a vault path. |
| Preview archive cleanup with no config file | `npx --yes @gerd/vault-tasks archive-done --vault-root "/absolute/vault" --dry-run` |
| Apply archive cleanup | The same archive command without `--dry-run`; this mutates the vault and requires explicit user approval. |
| Use a non-default archive scope | Add `--archive-root`, repeated `--source-root`, `--min-age-days`, `--timezone`, or `--keep-source-notes` together with `--vault-root`. |

The direct archive defaults are intentionally part of the interface:

- archive folder: `Archive`;
- source scope: `.` (whole vault), while excluding `Archive` itself;
- minimum age: 30 days;
- timezone: the local IANA timezone of the host;
- delete empty source notes: `true`.

Configuration remains the reusable path for query mode and for named archive
settings. In a configuration file, `archiveRoot` and `sourceRoots` stay
explicit; `["."]` is the supported whole-vault source scope.

## Product invariants

- Query mode is read-only.
- `archive-done` applies by default; `--dry-run` is the sole preview switch.
- Only an eligible root task is evaluated. Once eligible, all indented child
  lines move verbatim regardless of their own checkbox state, dates, or text.
- A completed root requires its matching terminal marker/date and must be old
  enough. Do not reintroduce child-task warnings.
- When a source note has no real checklist tasks left, or was task-free from
  the start, copy the complete original note to the archive and remove the
  source if `deleteEmptySourceNotes` is true. Keep prose, headings,
  frontmatter, and observations.
- Write the archive destination before changing the source. Duplicate archive
  content after interruption is acceptable; do not add transactions, locks,
  rollback, or deduplication without a concrete requirement.
- Prune only empty parents below a configured source root. Never delete a
  source root, archive root, non-empty directory, or content outside the vault.
- Archive JSON intentionally contains task text for local diagnosis. It must
  not be redacted by default, but must not be copied into public logs or docs.

## Change checklist

When changing behavior, update the matching pieces instead of only the code:

1. Read the relevant mode document: `docs/query-mode.md` or
   `docs/archive-mode.md`.
2. Change the smallest implementation surface and add a synthetic-fixture
   regression test.
3. If flags or defaults changed, update `src/cli/arguments.ts`, help text,
   README, configuration documentation/schema/examples as applicable, and
   `agent-skill/SKILL.md`.
4. Keep public examples on the `npx --yes @gerd/vault-tasks` path. Link the npm
   package and repository rather than embedding machine-specific paths.
5. Run `npm run check`, `npm run build`, and `git diff --check`.
6. Review the publish set with `npm pack --dry-run`; it must not contain a real
   vault, local config, credentials, personal task content, or `node_modules`.

## Release checklist

Publishing is an external action and always needs explicit user authorization.
It requires an npm account permitted to publish `@gerd/vault-tasks`; npm may
require a security key/passkey or a narrowly scoped token with bypass enabled.
Never put a token in the repository, a command transcript, or an agent prompt.

1. Choose the semantic version: patch for a compatible fix, minor for a
   compatible feature, major for a breaking interface change.
2. Update the version with `npm version patch`, `npm version minor`, or
   `npm version major` unless the release version is already committed.
3. Run `npm run check`, `npm run build`, `git diff --check`, and
   `npm pack --dry-run`.
4. Commit and push the release commit/tag to GitHub, then run `npm publish`.
5. Confirm the exact registry version and its executable before announcing it:

   ```bash
   npm view @gerd/vault-tasks version
   npx --yes @gerd/vault-tasks@<published-version> schema
   ```

6. State clearly whether GitHub and npm now contain the same version. If npm
   publication did not happen, do not claim that `npx` includes the change.
