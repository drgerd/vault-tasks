# Query mode

Query mode is read-only. It scans Markdown files in `vaultRoot`, recognizes
checklist task lines, evaluates structured filters, and prints one JSON result
to stdout.

```bash
VAULT_TASKS_CONFIG="$PWD/config/vault-tasks.local.json" \
  node dist/cli/main.js query --format compact \
  --json '{"status":{"anyOf":["TODO","IN_PROGRESS"]}}'
```

Use `schema` to print the complete public query schema and `explain` to
validate and normalize a query without reading vault task content.

```bash
node dist/cli/main.js schema

VAULT_TASKS_CONFIG="$PWD/config/vault-tasks.local.json" \
  node dist/cli/main.js explain \
  --json '{"scheduled":{"from":"today","to":"+7d"}}'
```

Every filter is optional. Top-level filters combine with AND. Entries in the
bounded top-level `anyOf` array combine with OR. Date expressions accept ISO
dates, `today`, `yesterday`, `tomorrow`, and offsets such as `-30d` or `+7d`.
`scheduled`, `due`, `created`, `done`, and `cancelled` are distinct fields.

The common query fields are status, headings, tags, date ranges, priority,
recurrence, source path, task ID, direct dependencies, `anyOf`, and `sort`.
The runtime schema is authoritative and rejects unknown or contradictory
fields. `compact` is best for people and token-efficient automation; `detailed`
adds parsed metadata and dependency diagnostics.

The vault root is taken only from local configuration, never from query JSON.
The configured archive folder is excluded from query scans.
