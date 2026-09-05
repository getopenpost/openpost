# Contributing to OpenPost

OpenPost uses a project-owned Devenv environment so local and CI commands stay aligned.

```bash
git clone https://github.com/getopenpost/openpost.git
cd openpost
direnv allow
devenv shell -- setup
bun run verify
```

Use [Conventional Commits](https://www.conventionalcommits.org/) because release versions are derived from commit intent:

- `fix:` and maintenance changes produce a patch release.
- `feat:` produces a minor release.
- `!` or a `BREAKING CHANGE:` footer produces a major release.

Before opening a pull request:

- Run the smallest relevant root gate while working. The pre-push hook checks changed-file syntax and formatting; use `bun run release -- check` for a bounded broad check and reserve `bun run verify` for high-risk changes that need local production builds.
- Add notable behavior, migration, and operator changes to the canonical `CHANGELOG.md` under `Unreleased`; the public changelog and release notes are generated from it.
- Reuse the shared Shadcn-svelte form controls across app and marketing UI. `bun run check -- ui-consistency` rejects visible native form controls outside those primitives.
- Include migration notes for database changes and screenshots for visible UI changes.
- Never commit credentials, provider tokens, local dotenv files, or production data.

Read the [full development setup](https://docs.openpo.st/development/setup), [architecture guide](https://docs.openpo.st/development/architecture), [testing guide](https://docs.openpo.st/development/testing), and [release policy](https://docs.openpo.st/development/releases). Repository-specific rules live in [AGENTS.md](../AGENTS.md).
