# Development Setup

This page is for contributors setting up the OpenPost repository.

OpenPost's root Devenv configuration pins Go, Bun, Node, and the supporting
tools used by the repository. On Hermes, provision Nix, Devenv, direnv, and the
direnv shell hook through the durable host configuration so they return after a
reboot; do not install project tools globally.

## Enter the project environment

```bash
git clone https://github.com/getopenpost/openpost.git
cd openpost
direnv allow
devenv shell -- setup
```

`setup` runs the frozen `install`, then creates local environment state.
`install` runs `bun install --frozen-lockfile` and downloads the backend and
CLI Go modules. Dependency and build caches live under the ignored
`.devenv/state/` directory in the checkout, so a NAS-hosted clone does not
depend on `/tmp` state. It copies `backend/.env.example` only when
`backend/.env` is missing; rerunning it never overwrites local credentials.

The backend reads `backend/.env` with its non-executing dotenv loader. Do not
`source` or `eval` dotenv files, and do not put credentials in Nix expressions.

Use Devenv only to enter or repair the environment:

```bash
devenv shell -- setup
```

After direnv loads at the next shell prompt, run repository commands from the
root:

```bash
bun run dev
```

## Commands

```bash
bun run format
bun run format:check
bun run lint
bun run check
bun run test
bun run build
bun run verify
bun run release -- plan
```

The `format`, `format:check`, `lint`, `check`, `test`, and `build` commands
accept one optional scope after `--`: `frontend`, `backend`, `cli`, `marketing`,
or `docs`. For example, use
`bun run check -- frontend` while changing the app. Omit the scope for the
complete repository gate. Use `bun run test -- e2e`, `e2e-app`, or `e2e-docs`
for browser suites. Focused repository policies use
`bun run check -- <policy>`, such as `bun run check -- contracts`.
The release subcommands are `plan`, `preflight`, `check`, `check-full`, `status`,
`prepare`, `promote`, and `prod`; see [Releases and Versioning](/development/releases).

Use `cache-status` and `cache-prune` to inspect and enforce the daily 4 GiB
default cap on the shared Go build cache. Use `docker-cache-status` and
`docker-cache-prune` to inspect Docker storage and bound unused BuildKit cache
without deleting images, containers, or volumes. Local backend builds reuse the
content-addressed Go cache; clean CI runners still compile the release candidate
from their exact checkout. Development runs, tests, vulnerability scans, and
lint use the `dev` build tag so embedded frontend assets do not accumulate there.
On a 16 GiB Mac, set Docker Desktop to 10 GB memory and 4 GB swap before local
release-image builds; release preflight rejects a macOS Docker VM below the
verified memory floor.

Entering Devenv installs tracked pre-commit and pre-push gates. They check the
relevant changed files for whitespace, conflict markers, formatting, Svelte
parse errors, Go formatting, shell syntax, and Nix syntax. They do not run
tests or production builds. Run `bun run release -- check` before a release.
Use `bun run verify` for a high-risk change that needs local production builds,
or `bun run release -- check-full` for the complete CI-style rehearsal.

`bun run build` prepares generated documentation inputs, builds the app and
sites, packages the frontend for the Go embed, and builds the backend and CLI.
Use a scope when you need only one part, such as
`bun run build -- frontend`.

Oxfmt owns frontend formatting and Oxlint owns JavaScript and TypeScript lint.
ESLint remains in the frontend gate for Svelte template rules that Oxlint cannot
evaluate. Turbo caches these independent checks, frontend type checks, tests,
and builds by content, so an unchanged repeat restores the prior result while a
relevant source or configuration change runs the full owning tool.
