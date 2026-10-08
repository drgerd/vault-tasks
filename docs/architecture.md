# Architecture

The code deliberately uses small functions and narrow interfaces. Avoid adding
frameworks, a database, a generic query AST, a DI container, or extra layers
unless a concrete new requirement makes one necessary.

```text
src/
  cli/       argument parsing and process exit handling
  config/    JSON configuration loading and validation
  model/     query, task, result, warning, and clock contracts
  vault/     Markdown discovery and task-line parsing
  query/     date resolution, dependencies, filtering, sorting, orchestration
  output/    compact and detailed query-result projection
  archive/   archive planning and application
```

`src/cli/main.ts` is the composition root. Query mode flows from configuration
through scanning, parsing, query execution, and output projection. Archive
mode flows from configuration through scanning, `archive/plan.ts`, and
`archive/service.ts`.

The filesystem abstraction is intentionally narrow and is used where tests
need to simulate archive-write failures without a personal vault. Keep archive
reads and writes scoped to the configured vault; do not introduce a generic
arbitrary-path file API.

Pure functions should remain pure where practical: Markdown parsing, date
handling, filtering, sorting, and archive eligibility are all tested using
synthetic fixtures. Filesystem work and CLI rendering belong at the edge.

Before changing behavior, read the relevant contract:

- [Query mode](query-mode.md)
- [Archive mode](archive-mode.md)
- [Configuration defaults](configuration.md)
- [Configuration schema](../config/vault-tasks.schema.json)
- [Agent maintenance rules](../AGENTS.md)
