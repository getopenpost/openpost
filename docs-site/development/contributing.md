# Contributing

This page is for contributors preparing a change to OpenPost.

Start with the [development setup](/development/setup), then run the smallest relevant root gates while working and `bun run verify` before a pull request.

## Project rules

- Use [Conventional Commits](https://www.conventionalcommits.org/). Release versions follow the commit impact described in [Releases and Versioning](/development/releases).
- Keep provider API behavior in `backend/internal/platform/` and preserve the shared adapter contract.
- Regenerate OpenAPI, TypeScript, CLI, and translation artifacts from their sources instead of editing generated files.
- Preserve the static SvelteKit build embedded in the Go binary.
- Add notable behavior, configuration, compatibility, migration, and operator changes to `CHANGELOG.md` under `Unreleased`. It is the canonical source for the public changelog and release notes.
- Use the shared Shadcn-svelte form primitives in both the app and marketing site. `bun run check -- ui-consistency` rejects visible native form controls outside the shared implementations.
- Never commit credentials, provider tokens, local dotenv files, or production data.

Repository-specific architecture and agent guidance live in [`AGENTS.md`](https://github.com/getopenpost/openpost/blob/main/AGENTS.md). The root [contributor guide](https://github.com/getopenpost/openpost/blob/main/CONTRIBUTING.md) contains the short setup and pull-request checklist.

## Public source and artifact contract

Marketing pages and maintained documentation are the canonical sources for public content. Their production builds invoke `scripts/generate-agent-surfaces.mjs` to add one explicit Markdown representation per eligible route, the host's `llms.txt`, and the documentation-only `llms-full.txt`. Generated public artifacts stay in ignored build output. Edit the owning page or catalogue instead of a generated file.

The marketing route manifest and generated documentation catalogue own route identity and policy. See [production readiness](/development/production-readiness#agent-readable-public-content) for the complete artifact contract, CI behavior, and root verification commands.
