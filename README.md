# vault-tasks-cli

A small local TypeScript CLI for querying and archiving completed tasks in one
configured Obsidian Markdown vault. It is designed for a single user's vault:
there is no database, daemon, synchronization service, or background index.

The tool has two independent modes:

- **Query mode** is read-only and returns recognized Markdown checklist tasks.
- **Archive mode** is opt-in and moves eligible task blocks into an archive
  tree by default. Pass `--dry-run` to inspect its plan without writing.

## Install from npm

After the first public release, install the CLI globally:

```bash
npm install --global @gerd/vault-tasks
vault-tasks schema
```

Or run it without a global installation:

```bash
npx --yes @gerd/vault-tasks schema
```

Queries need a local configuration file. `archive-done` can instead receive a
vault path directly; see [Archive completed tasks](#archive-completed-tasks).

## Install and build

Node.js 22 or newer is required.

```bash
npm ci
npm run check
npm run build
```

Create a local configuration file from the template. It is ignored by Git and
must contain the absolute path to your vault.

```bash
cp config/vault-tasks.local.example.json config/vault-tasks.local.json
# Edit config/vault-tasks.local.json.
```

Keep the configuration variable and command in the **same shell command**:

```bash
VAULT_TASKS_CONFIG="$PWD/config/vault-tasks.local.json" \
  node dist/cli/main.js schema
```

Exporting the variable on its own line does not make it available to a later
command unless you use `export VAULT_TASKS_CONFIG=...`.

## Commands

```text
vault-tasks query --json '<QUERY_JSON>' [--format compact|detailed] [--as-of YYYY-MM-DD]
vault-tasks schema
vault-tasks explain --json '<QUERY_JSON>' [--as-of YYYY-MM-DD]
vault-tasks archive-done [--vault-root PATH] [--archive-root PATH] [--source-root PATH]... [--min-age-days DAYS] [--timezone IANA_ZONE] [--keep-source-notes] [--dry-run] [--as-of YYYY-MM-DD]
```

When running from a checkout before global installation, substitute
`node dist/cli/main.js` for `vault-tasks`.

### Query mode

```bash
VAULT_TASKS_CONFIG="$PWD/config/vault-tasks.local.json" \
  node dist/cli/main.js query --format compact \
  --json '{"status":{"anyOf":["TODO","IN_PROGRESS"]}}'
```

`query` scans the configured vault and writes one JSON object to stdout.
`compact` preserves the original task line; `detailed` exposes parsed fields.
`schema` prints the public query contract without opening the vault. `explain`
validates and normalizes a query without scanning task content.

For a readable terminal result, pipe the JSON through `jq`. On macOS, add
`| pbcopy` to copy the formatted result to the clipboard:

```bash
VAULT_TASKS_CONFIG="$PWD/config/vault-tasks.local.json" \
  node dist/cli/main.js query --json '{}' | jq | pbcopy
```

See [docs/query-mode.md](docs/query-mode.md) for the query language and
execution path.

### Archive mode

Archive mode is enabled only when the local configuration contains an
`archive` section. It applies eligible moves by default. Use `--dry-run` when
you want a read-only preview:

Run directly, without creating a configuration file:

```bash
npx --yes @gerd/vault-tasks archive-done \
  --vault-root "/absolute/path/to/your-vault" --dry-run | jq
```

This scans the whole vault except `Archive`, archives into `Archive`, waits 30
days after completion, and deletes source notes once they contain no checklist
tasks. Omit `--dry-run` to apply the plan. Optional flags customize the direct
mode: `--archive-root`, repeated `--source-root`, `--min-age-days`,
`--timezone`, and `--keep-source-notes`.

Alternatively, retain a reusable configuration file:

```bash
VAULT_TASKS_CONFIG="$PWD/config/vault-tasks.local.json" \
  vault-tasks archive-done --dry-run --as-of 2026-10-08 | jq
```

The configured `archiveRoot` directory is created automatically. Archive paths
mirror the source path below each configured `sourceRoots` entry, for example
`Income/Daily/note.md` becomes `Archive/Income/Daily/note.md`.

The JSON plan intentionally includes copied task blocks so a failed move can be
identified. Do not send archive output to logs or services you do not trust.
See [docs/archive-mode.md](docs/archive-mode.md) for the exact business rules
and failure semantics.

## Configuration

`config/vault-tasks.schema.json` is the complete configuration contract.
`config/vault-tasks.example.json` is a generic example. See
[docs/configuration.md](docs/configuration.md) for every actual default.
Important archive values:

- `vaultRoot`: required absolute vault path.
- `timezone`: defaults to the local timezone of the machine running the CLI;
  it determines the calendar date for omitted `--as-of` values and relative
  dates such as `today`. Set it explicitly only for a fixed-timezone workflow.
- `statuses`: maps Obsidian checkbox symbols to task states.
- `scan` and `limits`: traversal and output bounds for query mode.
- `archive.archiveRoot`: required vault-relative archive folder in file
  configuration. Direct `--vault-root` mode defaults it to `Archive`.
- `archive.sourceRoots`: required vault-relative folders in file configuration.
  Direct mode scans the whole vault except its archive folder; `["."]` has the
  same meaning in a config file.
- `archive.minAgeDays`: minimum age after a root task's terminal date;
  defaults to 30 days.
- `archive.deleteEmptySourceNotes`: archive the complete note and delete its
  source copy when no real checklist task remains, including a note that was
  already task-free; defaults to `true`. Empty child folders are pruned up to
  the configured source root.

Keep real paths and task data only in `config/vault-tasks.local.json`; it is
Git-ignored. Never commit it.

## Development and maintenance

```bash
npm run check
npm run build
```

The automated tests use synthetic fixtures only. Project layout and extension
guidance are in [docs/architecture.md](docs/architecture.md). The durable
business rules and coding constraints for future agents are in
[AGENTS.md](AGENTS.md).

## Agent skill

[`agent-skill/SKILL.md`](agent-skill/SKILL.md) is a self-contained English
instruction file for an Obsidian-capable agent. Copy that file into the
agent's skill mechanism and provide the agent with a trusted local
`VAULT_TASKS_CONFIG` path plus permission to execute the CLI. It covers
structured task search, relevant to-do summaries, daily planning, archive
previews, and the authorization boundary for a mutating `archive-done` call.
