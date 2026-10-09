# Archive mode

`archive-done` moves completed task content from configured source folders to a
parallel archive tree. It is intentionally a small, sequential, single-user
workflow rather than a synchronization system.

## Enable and run

Archive mode uses either an `archive` object in configuration or the direct
`--vault-root PATH` command. The archive root and every source root are
vault-relative paths. They must be disjoint, except that source root `.` means
the whole vault and automatically excludes the archive root.

In configuration, `archiveRoot` and `sourceRoots` are required. The direct
mode defaults to `Archive` and source root `.`, respectively, so it scans the
whole vault apart from `Archive`. `minAgeDays` defaults to 30; see
[configuration defaults](configuration.md) for the complete table.

Run `archive-done` to apply eligible moves. Add `--dry-run` to generate a plan
without writing files.

```bash
npx --yes @gerd/vault-tasks archive-done --vault-root "/absolute/path/to/vault" --dry-run | jq

VAULT_TASKS_CONFIG="$PWD/config/vault-tasks.local.json" \
  node dist/cli/main.js archive-done --dry-run --as-of 2026-10-08 | jq

VAULT_TASKS_CONFIG="$PWD/config/vault-tasks.local.json" \
  node dist/cli/main.js archive-done --as-of 2026-10-08 | jq
```

`archiveRoot` is created automatically. Destination paths preserve the source
path below the vault: `Income/Daily/note.md` becomes
`Archive/Income/Daily/note.md` when `archiveRoot` is `Archive`.

## Eligibility rules

Only a **root checklist task** is evaluated for eligibility. It is eligible
when all of the following are true:

1. Its status is `DONE` or `CANCELLED` according to `statuses`.
2. It has a valid matching terminal date: `✅ YYYY-MM-DD` for `DONE`, or
   `❌ YYYY-MM-DD` for `CANCELLED`.
3. The terminal date is no later than `asOf - minAgeDays` (30 days by default).

When an eligible root is moved, every indented descendant line is moved with
it verbatim. Descendants may be unfinished checklist tasks, ordinary text,
lists, or any other child content. They are not evaluated independently and
never cause a warning.

Task-looking lines inside fenced code blocks are ignored. Archive mode also
leaves non-task text outside the moved block in the source note unless the
whole-note rule below applies.

## Whole-note archive and source deletion

With `deleteEmptySourceNotes: true` (the default), if removing eligible blocks leaves no
real Markdown checklist task anywhere in the note, the tool instead writes the
complete original note to the archive and removes the source note. This
preserves frontmatter, headings, observations, prose, and all other content.
The result item has `deleteSourceNote: true`.

The same setting also handles a note that already has no real checklist task:
the complete note is copied to the archive and then removed from its configured
source root. Checklist-looking lines inside fenced code blocks do not prevent
this cleanup.

After deleting a source note, the tool also removes its empty parent folders up
to, but never including, the configured `sourceRoot`. It never removes a
non-empty directory or an archive directory.

With `deleteEmptySourceNotes: false`, the tool removes only eligible task
blocks from source notes. A source note stays in place.

## Apply order and failures

For each note, the tool writes its archive destination before changing the
source. Destination writes use a temporary file and rename. This prevents a
partially written destination note from being treated as complete.

There is deliberately no transaction, rollback, deduplication, or concurrency
lock. If a run stops after writing a destination but before removing a source,
the next run may leave duplicate archived content. Review the JSON output and
resolve duplicates manually if that happens. Do not run two archive commands
at once.

An archive result can be `partial` when some notes succeeded and others failed.
Items use `planned`, `archived`, `skipped`, or `error` status. Archive output
contains task text by design so it can be inspected; treat that output as local
vault content.
