---
name: obsidian-vault-tasks
description: Find, prioritize, summarize, and safely archive completed Obsidian Markdown tasks with vault-tasks-cli. Use when an agent needs task-aware answers or a reviewed archive-cleanup workflow; do not use for arbitrary vault file access.
---

# Obsidian Vault Tasks

Use `vault-tasks-cli` as the structured interface to a configured Obsidian
vault. It recognizes Markdown checklist tasks and returns their source path,
line, original Markdown, and (when requested) parsed metadata. Do not search
or modify arbitrary vault files directly when this tool can answer the request.

## Configure the command once

The hosting agent must provide a trusted local configuration path. Never ask
the end user for a vault path in a task query, and never include a real path,
task text, or command output in persistent public logs.

Use the installed command when available:

```bash
VAULT_TASKS_CONFIG="/trusted/path/vault-tasks.local.json" \
  vault-tasks query --json '{}'
```

For a checkout that has not been installed, use its built executable:

```bash
VAULT_TASKS_CONFIG="/trusted/path/vault-tasks.local.json" \
  node /trusted/path/vault-tasks/dist/cli/main.js query --json '{}'
```

Keep `VAULT_TASKS_CONFIG=...` in the same command as the CLI invocation, or
export it before invoking the tool. The configuration selects the one allowed
vault; query JSON never selects a filesystem path.

Unless the configuration overrides it, the timezone is `Europe/Warsaw`. It
defines the current date used by omitted `--as-of` values and relative dates
such as `today` or `+7d`.

## Find and assemble relevant work

Start with `compact` output. It preserves the original Markdown task line and
is sufficient for listings, summaries, and locating a task. Request `detailed`
only for reliable metadata, date, recurrence, or dependency analysis.

```bash
vault-tasks query --format compact --json '{
  "status": {"anyOf": ["TODO", "IN_PROGRESS"]},
  "scheduled": {"from": "today", "to": "+7d"},
  "sort": [{"field": "priority", "direction": "desc"}]
}'
```

Use structured filters rather than guessing from prose:

- `status`: `TODO`, `IN_PROGRESS`, `DONE`, or `CANCELLED`.
- `scheduled`: intended work date; use it first for planning.
- `due`: a hard deadline, not a synonym for `scheduled`.
- `created`, `start`, `done`, and `cancelled`: independent date fields.
- `tags`, `heading`, and `source`: narrow work by context.
- `priority`, `recurrence`, `id`, and `dependencies`: prioritize and diagnose.
- `anyOf`: a bounded OR across filters; top-level fields otherwise combine with
  AND.

Date values can be ISO dates, `today`, `yesterday`, `tomorrow`, `-30d`, or
`+7d`. Use `--as-of YYYY-MM-DD` when a repeatable date boundary matters.
Consult `vault-tasks schema` when constructing an unfamiliar query and
`vault-tasks explain --json '...'` when validating a query without scanning
the vault.

When reporting tasks, preserve `path` and `line` with each selected item. Say
when results are truncated or when a query returned no matches; do not invent
tasks or silently broaden the filters.

## Daily and evening planning

For a daily plan, query open tasks scheduled through today and separately call
out overdue hard deadlines. For a weekly plan, widen the `scheduled` range and
sort by priority and date. Ask before treating an undated task as an active
commitment.

The CLI itself does not schedule jobs. If the host platform supports schedules,
it may run an evening archive cleanup only after the user has explicitly
authorized that recurring mutation. Use a **preview** job when the schedule is
for reporting only:

```bash
vault-tasks archive-done --dry-run
```

Use the host's scheduler syntax and timezone settings; do not invent a cron
schedule unless the user specifies the desired time and timezone. Return the
preview summary to the user or the configured private report channel.

## Archive completed work

`archive-done` is available only when the local configuration has an `archive`
section. It applies all eligible moves by default. Pass `--dry-run` to produce
a plan and make no changes.

Archive scope is not guessed: `archiveRoot` and `sourceRoots` are required
configuration values with no built-in folder defaults. The repository examples
use `Archive` and `Income`, but an agent must treat those as examples only.
`minAgeDays` defaults to 30; `deleteEmptySourceNotes` defaults to `true`.
An agent must not change these configuration values as a side effect of a task.

```bash
vault-tasks archive-done --dry-run --as-of 2026-10-08 | jq
```

Run `archive-done` without `--dry-run` only after the user explicitly approves
that cleanup, or after the user has granted clear ongoing authorization for the
named scheduled cleanup. Never treat a general request to "organize tasks" as
permission to delete or move source content.

```bash
vault-tasks archive-done --as-of 2026-10-08 | jq
```

Archive eligibility is deliberately simple:

1. Only a root task is evaluated.
2. It must be `DONE` with `✅ YYYY-MM-DD`, or `CANCELLED` with `❌ YYYY-MM-DD`.
3. Its matching terminal date must be at least `minAgeDays` old.
4. Once eligible, the root and every indented child line are moved verbatim.
   Children may be open tasks, lists, or ordinary text; do not warn about or
   evaluate them independently.

The archive root is created automatically. The destination mirrors the source
path below the vault. With `deleteEmptySourceNotes: true`, a note with no
remaining real checklist tasks is copied in full to the archive (including
prose, headings, and frontmatter) and then deleted from the source.

Archive application writes the archive destination before changing the source.
It is not transactional: an interrupted run can leave duplicate archive
content. Do not run two archive jobs at once. If the result says `partial` or
contains `error` items, report the paths and stop; do not retry blindly.

## Output and privacy

CLI responses are JSON. Use `| jq` for a readable result; on macOS, `| jq |
pbcopy` copies it to the clipboard. Archive plans intentionally include task
content so failures can be inspected. Keep that output local and do not post it
to public issue trackers, repositories, or shared logs.
