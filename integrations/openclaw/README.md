# OpenClaw adapter boundary

This directory is reserved for the phase-two `vault_tasks_query` adapter.
There is intentionally no adapter implementation in the pre-approval scaffold.

The approved implementation must accept only a validated query object,
`compact` or `detailed` output selection, and an optional ISO `asOf` date. It
must invoke a fixed executable with a fixed administrator-controlled config,
without a shell and without exposing `vaultRoot` or arbitrary command options.

