---
name: query-obsidian-vault-tasks
description: Query a configured Obsidian Tasks vault through a query-only wrapper that exposes vault_tasks_query. Use when an agent needs to find, inspect, sort, or analyze tasks; not for arbitrary vault file access or task mutation.
---

# Query Obsidian Vault Tasks

This is a reference skill for an external query-only wrapper named
`vault_tasks_query`; that wrapper is not bundled in this repository. The
standalone CLI is documented in the repository README. Do not invoke a shell
or supply a vault path when using the wrapper.

This skill does not authorize or implement archive mode. Archive work must use
the CLI's explicit `archive-done --apply` workflow and the business rules in
`docs/archive-mode.md`.

Start with `compact` output. It preserves each original task line while using
fewer tokens. Request `detailed` only when the task requires reliable
field-by-field analysis, dependency resolution, diagnostics, or machine
processing.

Build direct structured filters from the user's request. Do not substitute a
named preset or infer a `home`, `work`, or other category. Omit a filter when
the user did not ask to restrict that field. An empty query means all tasks.

For planning requests, prefer `scheduled`. Use `due` only for hard deadlines
or critical obligations, and use `created` for task-age or recency questions.
Never treat scheduled and due as interchangeable.

Treat the returned Markdown line as the source representation of Obsidian Tasks
metadata. When locating, linking to, or later changing a task, retain both its
vault-relative `path` and 1-based `line`; an Obsidian URI does not replace the
line locator.

If the response is truncated, report that fact and narrow the structured query
when the user's intent permits. Never describe a truncated response as a
complete result.

Read [references/query-guide.md](references/query-guide.md) when constructing a
query, interpreting Tasks metadata, or choosing between output formats.
