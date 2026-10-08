# Configuration defaults

The CLI loads one JSON configuration file. It uses the path in
`VAULT_TASKS_CONFIG`; when that variable is absent, it reads
`/etc/vault-tasks/config.json`. The CLI has no `--config` or `--vault-root`
flag. This keeps vault selection outside query JSON and command arguments.

`vaultRoot` is the only required top-level setting. It must be an absolute
path. All other non-archive settings have the defaults below.

| Setting | Default |
| --- | --- |
| `timezone` | `Europe/Warsaw`. It determines the current calendar date for omitted `--as-of` values and relative query dates such as `today` or `+7d`. |
| `statuses` | `[ ]` TODO, `[/]` IN_PROGRESS, `[x]` DONE, `[-]` CANCELLED |
| `scan.excludedDirectories` | `.obsidian`, `.trash` |
| `scan.maxFiles` | `10,000` |
| `scan.maxFileBytes` | `1,048,576` bytes (1 MiB) |
| `scan.maxTotalBytes` | `52,428,800` bytes (50 MiB) |
| `limits.maxReturnedTasks` | `5,000` |
| `limits.maxOutputBytes` | `2,097,152` bytes (2 MiB) |
| `limits.maxAnyOfClauses` | `20` |
| `limits.maxSortFields` | `5` |
| `output.defaultFormat` | `compact` |

## Archive configuration

Archive mode is disabled unless an `archive` object is present. Its directory
scope is deliberately explicit:

| Setting | Default / requirement |
| --- | --- |
| `archive.archiveRoot` | **Required; no built-in default.** `Archive` is the value used in the example files. The directory is created when an archive run needs it. |
| `archive.sourceRoots` | **Required; no built-in default.** `Income` is an example only. Choose every vault-relative root that may be archived. |
| `archive.minAgeDays` | `30` days. A root task's matching `✅` or `❌` date must be at least this old. |
| `archive.deleteEmptySourceNotes` | `true`. A note with no checklist tasks left is archived whole and then removed from the source tree. Set it to `false` to retain a source note after eligible blocks are removed. |

`archiveRoot` and `sourceRoots` must be vault-relative, non-overlapping paths.
The archive root is automatically excluded from query and archive scans. The
example configuration is a starting point, not a source of implicit defaults.
