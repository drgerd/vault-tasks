# Query execution guide

This legacy filename is kept for existing links. The maintained English guide
is [Query mode](query-mode.md).

At a high level, `query` parses CLI arguments, validates local configuration,
scans configured Markdown files, parses task lines, resolves dependencies,
filters and sorts results, then projects one JSON response. `explain` stops
after query validation and date resolution; `schema` does not read the vault.
