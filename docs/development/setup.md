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
setup
```

`setup` installs locked Bun dependencies and the pinned Playwright Chromium,
then copies `apps/server/.env.example` to `apps/server/.env` only when that
file is missing, so rerunning it never overwrites local credentials. Go, Bun
and Playwright keep their caches in their usual per-user locations, so every
worktree shares them.

The same shell works on macOS and Linux. On Linux it adds the Nix Chromium for
Playwright and exposes Nix's libstdc++ to prebuilt npm addons such as `sharp`.
On NixOS, also enable `programs.nix-ld` so downloaded executables such as
esbuild can start.

The backend reads `apps/server/.env` with its non-executing dotenv loader. Do not
`source` or `eval` dotenv files, and do not put credentials in Nix expressions.

Run repository commands from the root:

```bash
bun run dev
```

For concurrent checkouts, first run `bun run build -- frontend` in each checkout
to prepare the backend's frontend artifact. Then use `devenv up -d`. The frontend
hostname is available from `devenv eval processes.frontend.proxy.hostname`.
Each checkout gets its own hostname, allocated ports, SQLite database and media
under `.devenv/state/dev/`. Stop it with `devenv down`. This isolated
data is separate from the database used by `bun run dev`. The proxy requires
devenv 2.4 or newer; on Linux it may request sudo to bind port 80. Provider
OAuth callbacks must be registered for the displayed URL.

`devenv up --profile hosted -d postgres rustfs` starts the Hosted data plane,
PostgreSQL and S3-compatible storage, on ports allocated per checkout. Run
`devenv --profile hosted shell -- bash scripts/test-hosted-data-plane.sh` for the
same migration, queue and object-storage tests CI runs, then `devenv down`.

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
complete repository gate. Use `bun run test -- e2e` or `e2e-app`
for browser suites. Focused repository policies use
`bun run check -- <policy>`, such as `bun run check -- contracts`.
The release subcommands are `plan`, `preflight`, `check`, `check-full`, `status`,
`prepare`, `promote`, and `prod`; see [Releases and Versioning](releases.md).

Turbo keeps its task cache in `.turbo/cache` inside each checkout. Finite root
tasks delete entries untouched for 14 days.

Frontend Turbo entries omit the immutable editor model and audio trees. A cache
restore links the current tracked files into the complete frontend artifact
before Go packaging, and generated SvelteKit, Go embed, and Android trees share
those files when the filesystem supports hard links. CI keeps its Turbo cache
ephemeral because exact-run source-map uploads must still execute, and jobs that
do not build the application omit the large editor trees from their partial
checkout. Use `docker-cache-status` and `docker-cache-prune` to inspect Docker
storage and bound unused BuildKit cache without deleting images, containers, or
volumes. Local backend builds reuse the content-addressed Go cache; clean CI
runners still compile the release candidate from their exact checkout.
Development runs, tests, vulnerability scans, and lint use the `dev` build tag
so embedded frontend assets do not accumulate there.
On a 16 GiB Mac, set Docker Desktop to 10 GB memory and 4 GB swap before local
release-image builds; release preflight rejects a macOS Docker VM below the
verified memory floor.

Entering Devenv installs tracked pre-commit and pre-push gates. They check the
relevant changed files for whitespace, conflict markers, formatting, Svelte
parse errors, Go formatting, shell syntax, and Nix syntax. They do not run
tests or production builds. Run `bun run preflight` before a release.
Use `bun run verify` for a high-risk change that needs local production builds,
and rely on tag CI for the complete qualification.

`bun run build` prepares generated documentation inputs, builds the app and
sites, packages the frontend for the Go embed, and builds the backend and CLI.
Use a scope when you need only one part, such as
`bun run build -- frontend`.

Oxfmt owns frontend formatting and Oxlint owns JavaScript and TypeScript lint.
ESLint remains in the frontend gate for Svelte template rules that Oxlint cannot
evaluate. Turbo caches these independent checks, frontend type checks, tests,
and builds by content, so an unchanged repeat restores the prior result while a
relevant source or configuration change runs the full owning tool.
