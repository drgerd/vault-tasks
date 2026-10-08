# Query guide

## Choosing output

- Use `compact` for listing, locating, summarizing, or handing task lines back
  to a capable agent.
- Use `detailed` for deterministic status/date comparisons, structured sorting,
  recurrence inspection, dependency graphs, and diagnosing parsed metadata.

Both modes require `path` and `line`. Keep them together with any selected task.

## Filter semantics

All filter families are optional and combine with AND. Multi-value `anyOf`
fields use OR, `allOf` requires every value, and `noneOf` excludes matching
values. Use the bounded root `anyOf` only when the request truly contains an OR
across different fields.

Available filters:

- arbitrary nearest headings: exact, substring, or missing;
- status types `TODO`, `IN_PROGRESS`, `DONE`, and `CANCELLED`;
- tags using `anyOf`, `allOf`, and `noneOf`;
- independent ranges over scheduled, due, created, start, done, or cancelled;
- priority values and stable multi-key sorting;
- recurring only, non-recurring only, or recurrence text;
- vault-relative files, path prefixes, and filenames;
- Tasks IDs and direct dependency properties.

Do not send a vault root, absolute path, parent traversal, regex, JavaScript, or
textual Obsidian Tasks query syntax.

Relative dates are ISO dates, `today`, `yesterday`, `tomorrow`, or signed day
offsets such as `-30d`. They resolve against the returned `asOf` in the
configured timezone.

## Date semantics

Use `scheduled` first for planning: it means when work is intended to happen.
Use `due` only for a hard deadline or critical obligation. Use `created` when
the user asks when tasks were added or wants recently created work. Do not
merge or substitute these fields.

Each date filter supports `from`, `to`, inclusive endpoint controls, and
`missing`. Use `{ "missing": true }` to select tasks without that exact date
type. Separate root date fields combine with AND. Put alternatives into the
single root `anyOf` array; do not nest additional Boolean groups.

## Tasks line cues

Common metadata cues include:

```text
[ ] TODO
[/] IN_PROGRESS
[x] DONE
[-] CANCELLED
📅 due
🛫 start
⏳ scheduled
➕ created
✅ done
❌ cancelled
🔁 recurrence
🆔 task ID
⛔ dependency IDs
```

Priority is encoded with Tasks priority emoji. In compact output, preserve and
interpret the returned line rather than reconstructing it.

`blockedBy` and `blocks` are direct resolved relationships. A missing or
duplicate task ID produces a warning. Do not guess the intended target.

## Examples

Open tasks under either of two headings:

```json
{
  "heading": {"anyOf": ["Home ToDo", "Personal Todo"]},
  "status": {"anyOf": ["TODO", "IN_PROGRESS"]}
}
```

Open tasks scheduled for the next seven days:

```json
{
  "scheduled": {"from": "today", "to": "+7d"},
  "status": {"anyOf": ["TODO", "IN_PROGRESS"]}
}
```

Hard deadlines in the same period:

```json
{
  "due": {"from": "today", "to": "+7d"},
  "status": {"anyOf": ["TODO", "IN_PROGRESS"]}
}
```

Open tasks whose planned date or hard deadline has arrived:

```json
{
  "anyOf": [
    {"scheduled": {"to": "today"}},
    {"due": {"to": "today"}}
  ],
  "status": {"anyOf": ["TODO", "IN_PROGRESS"]}
}
```

Tasks created recently but not yet scheduled:

```json
{
  "created": {"from": "-30d", "to": "today"},
  "scheduled": {"missing": true}
}
```

Currently blocked tasks:

```json
{
  "dependencies": {"blocked": true}
}
```

If no filter is intended, send `{}` rather than inventing constraints.
