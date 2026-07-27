# Contributing

Start with the [development setup](/development/setup), then run the smallest relevant checks while working and `devenv shell -- verify` before a pull request.

## Project rules

- Use [Conventional Commits](https://www.conventionalcommits.org/). Release versions follow the commit impact described in [Releases and Versioning](/development/releases).
- Keep provider API behavior in `backend/internal/platform/` and preserve the shared adapter contract.
- Regenerate OpenAPI, TypeScript, CLI, and translation artifacts from their sources instead of editing generated files.
- Preserve the static SvelteKit build embedded in the Go binary.
- Update the changelog and public docs when behavior, configuration, or compatibility changes.
- Never commit credentials, provider tokens, local dotenv files, or production data.

Repository-specific architecture and agent guidance live in [`AGENTS.md`](https://github.com/rodrgds/openpost/blob/main/AGENTS.md). The root [contributor guide](https://github.com/rodrgds/openpost/blob/main/CONTRIBUTING.md) contains the short setup and pull-request checklist.
