# Publishing to npm

This package is published publicly as
[`@gerd/vault-tasks`](https://www.npmjs.com/package/@gerd/vault-tasks). The
source repository is [drgerd/vault-tasks](https://github.com/drgerd/vault-tasks).
The next release prepared in this repository is `0.1.1`.

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
access flag is required. npm may require a passkey/security key or a granular,
package-scoped access token authorized to bypass two-factor authentication.
Treat a token as a secret: never commit, print, or paste it into an agent chat.

For each later release, choose the appropriate semantic-version increment,
commit it, tag it, and then publish:

```bash
npm version patch
npm run check
npm pack --dry-run
git push --follow-tags
npm publish
npm view @gerd/vault-tasks version
npx --yes @gerd/vault-tasks@<published-version> schema
```

Use `minor` instead of `patch` for backwards-compatible new functionality, or
`major` for a breaking CLI/configuration change.

Do not announce a GitHub-only commit as an npm release. `npx` downloads the
registry package, so it receives a change only after the matching version was
published successfully.
