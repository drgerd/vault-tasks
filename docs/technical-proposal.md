# Product contract

This document is retained as a stable entry point for earlier links. The
implemented public contract is now split into focused documents:

- [README](../README.md): setup, configuration, and CLI quickstart.
- [Query mode](query-mode.md): read-only query behavior.
- [Archive mode](archive-mode.md): eligibility, copying, deletion, and failure
  behavior.
- [Architecture](architecture.md): module boundaries and extension guidance.

The configuration schema at
[`config/vault-tasks.schema.json`](../config/vault-tasks.schema.json) is the
authoritative machine-readable configuration contract. Source code and tests
are authoritative when a document conflicts with implementation.
