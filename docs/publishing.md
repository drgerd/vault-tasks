# Publishing to npm

This package is published publicly as `@gerd/vault-tasks`. The initial public
release is version `0.1.0`.

Before publishing, use an npm account that owns the `@gerd` scope. Publishing
is intentionally a maintainer action; do not run it from an automated agent
without explicit authorization.

```bash
cd /path/to/vault-tasks
npm login
npm whoami
npm run check
npm pack --dry-run
npm publish
```

`prepack` builds `dist/` automatically and `prepublishOnly` reruns the test
suite immediately before npm accepts the package. `npm pack --dry-run` is the
last chance to inspect the public file list. It must not contain a local
configuration file, vault contents, credentials, or build dependencies.

The package declares public access through `publishConfig`, so no additional
access flag is required. npm may require two-factor authentication during the
publish step.

For each later release, choose the appropriate semantic-version increment,
commit it, tag it, and then publish:

```bash
npm version patch
git push --follow-tags
npm publish
```

Use `minor` instead of `patch` for backwards-compatible new functionality, or
`major` for a breaking CLI/configuration change.
