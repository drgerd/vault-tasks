---
name: obsidian-vault-tasks
description: Find, prioritize, summarize, and safely archive completed Obsidian Markdown tasks with vault-tasks-cli. Use when an agent needs task-aware answers or a reviewed archive-cleanup workflow; do not use for arbitrary vault file access.
---

# Obsidian Vault Tasks

Use the public npm CLI
[`@gerd/vault-tasks`](https://www.npmjs.com/package/@gerd/vault-tasks) as the
structured interface to a configured Obsidian vault. Invoke it as
`npx --yes @gerd/vault-tasks ...`. It recognizes Markdown checklist tasks and
returns their source path, line, original Markdown, and (when requested)
parsed metadata. Do not search or modify arbitrary vault files directly when
this tool can answer the request.

## Configure the command once

The hosting agent must provide a trusted local configuration path. Never ask
the end user for a vault path in a task query, and never include a real path,
task text, or command output in persistent public logs.

For queries, use a trusted configuration path supplied by the host:

```bash
VAULT_TASKS_CONFIG="/trusted/path/vault-tasks.local.json" \
  npx --yes @gerd/vault-tasks query --json '{}'
```

Keep `VAULT_TASKS_CONFIG=...` in the same command as the CLI invocation, or
export it before invoking the tool. The configuration selects the one allowed
vault; query JSON never selects a filesystem path.

Unless the configuration overrides it, the CLI uses the local timezone of the
machine that runs it. It defines the current date used by omitted `--as-of`
values and relative dates such as `today` or `+7d`.

## Find and assemble relevant work

Start with `compact` output. It preserves the original Markdown task line and
is sufficient for listings, summaries, and locating a task. Request `detailed`
only for reliable metadata, date, recurrence, or dependency analysis.

```bash
VAULT_TASKS_CONFIG="/trusted/path/vault-tasks.local.json" \
  npx --yes @gerd/vault-tasks query --format compact --json '{
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
Consult `npx --yes @gerd/vault-tasks schema` when constructing an unfamiliar
query. To validate a query without scanning task content, use
`VAULT_TASKS_CONFIG="/trusted/path/vault-tasks.local.json" npx --yes @gerd/vault-tasks explain --json '...'`.

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
npx --yes @gerd/vault-tasks archive-done --vault-root "/absolute/path/to/vault" --dry-run
```

Use the host's scheduler syntax and timezone settings; do not invent a cron
schedule unless the user specifies the desired time and timezone. Return the
preview summary to the user or the configured private report channel.

## Archive completed work

`archive-done` can use a local configuration or `--vault-root PATH` directly.
It applies all eligible moves by default. Pass `--dry-run` to produce a plan
and make no changes.

With configuration, `archiveRoot` and `sourceRoots` are explicit values. With
`--vault-root`, defaults are `Archive`, whole-vault source scope (excluding
`Archive`), 30 days, the host's local timezone, and
`deleteEmptySourceNotes: true`. Use repeated `--source-root` to narrow direct
scope. An agent must not change these values as a side effect of a task.

```bash
npx --yes @gerd/vault-tasks archive-done --vault-root "/absolute/path/to/vault" --dry-run --as-of 2026-10-08 | jq
```

Run `archive-done` without `--dry-run` only after the user explicitly approves
that cleanup, or after the user has granted clear ongoing authorization for the
named scheduled cleanup. Never treat a general request to "organize tasks" as
permission to delete or move source content.

```bash
npx --yes @gerd/vault-tasks archive-done --vault-root "/absolute/path/to/vault" --as-of 2026-10-08 | jq
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
prose, headings, and frontmatter) and then deleted from the source. This also
cleans a source note that was already task-free when the archive command ran.
Empty parent folders are pruned, but the configured source root itself remains.

Archive application writes the archive destination before changing the source.
It is not transactional: an interrupted run can leave duplicate archive
content. Do not run two archive jobs at once. If the result says `partial` or
contains `error` items, report the paths and stop; do not retry blindly.

## Output and privacy

CLI responses are JSON. Use `| jq` for a readable result; on macOS, `| jq |
pbcopy` copies it to the clipboard. Archive plans intentionally include task
content so failures can be inspected. Keep that output local and do not post it
to public issue trackers, repositories, or shared logs.
