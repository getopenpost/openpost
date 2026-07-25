<p align="center">
  <a href="https://github.com/rodrgds/openpost">
    <img alt="OpenPost Logo" src="./assets/brand/logo.svg" width="280"/>
  </a>
</p>

<p align="center">
  <a href="https://github.com/rodrgds/openpost/releases">
    <img src="https://img.shields.io/github/v/release/rodrgds/openpost?sort=semver&label=Release" alt="Latest Release">
  </a>
  <a href="https://github.com/rodrgds/openpost/pkgs/container/openpost">
    <img src="https://img.shields.io/github/v/release/rodrgds/openpost?sort=semver&label=Image&include_prereleases" alt="Container Image">
  </a>
  <a href="https://github.com/rodrgds/openpost/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/rodrgds/openpost/ci.yml?label=CI" alt="CI Status">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg" alt="License: AGPL-3.0-only">
  </a>
  <a href="SECURITY.md">
    <img src="https://img.shields.io/badge/Security-Security%20Policy-blue" alt="Security Policy">
  </a>
</p>

<div align="center">
  <h2>The publishing layer between AI agents and your social accounts.</h2>
  Let an agent inspect workspace context, prepare a base post, and tailor each destination without receiving provider credentials. Review the result in OpenPost, then schedule it through one visible queue.
</div>

<p align="center">
  <a href="https://app.openpost.social"><strong>Use managed app</strong></a>
  ·
  <a href="https://youtu.be/_mZf3HzQaN8"><strong>Watch demo</strong></a>
  ·
  <a href="https://docs.openpost.social/usage/"><strong>User docs</strong></a>
  ·
  <a href="https://docs.openpost.social/self-hosting/"><strong>Self-hosting</strong></a>
  ·
  <a href="https://github.com/rodrgds/openpost/releases"><strong>Releases</strong></a>
</p>

<p align="center">
  Managed publishing starts at €6/month. There is no automatic hosted free tier or trial. Self-hosted OpenPost has no software subscription.
</p>

<p align="center">
  <img alt="OpenPost main dashboard screenshot" src="./assets/screenshots/main-dark.png" width="960">
</p>

## Agent-assisted, human-reviewed publishing

OpenPost gives MCP clients a compact publishing surface without returning decrypted social-provider tokens. A workspace-scoped `mcp:read` token can inspect accounts, media, drafts, schedules, provider readiness, and outcomes while the server rejects every mutation. Preparing or changing drafts and renditions, uploading media, scheduling, and publishing require `mcp:full`.

The server separates guaranteed read-only operations from mutations and external actions. Access tokens are revocable and can be limited to one workspace. This is a technical boundary, not a mandatory approval workflow: an `mcp:full` token can execute publishing operations when the client allows them, so review content and destinations before approval.

See the [agent-assisted publishing guide](https://docs.openpost.social/usage/agent-assisted-publishing) and clone the repository's [OpenPost Launch Kit](./launch-kit/) for a worked campaign brief, sample prompt, five distinct renditions, review checklist, and evidence templates.

## What OpenPost includes

OpenPost keeps the publishing workflow in one place without hiding provider differences or operational state.

- **Provider-aware preparation:** draft a base post, then customize text, media, format, and settings per account.
- **Eight publication profiles:** short text, threads, links, images, carousels, Stories, short video, and long video.
- **Reliable scheduling:** calendar planning, workspace timezones, reusable posting slots, next-slot scheduling, and a durable database-backed job queue.
- **Visible outcomes:** inspect drafts, scheduled work, destination renditions, published posts, failures, and retry state.
- **Studio and reusable media:** build editable multi-page social images with original templates and workspace brand assets, then export ordered pages directly to Media or a composer.
- **Shared operations:** workspaces, role-based team access, connected accounts, reusable media, prompts, billing, and usage limits.
- **Controlled automation:** the web app, HTTP API, CLI, and MCP server use the same authorization, workspace, account, validation, quota, and queue boundaries.
- **Portable deployment:** one Go binary or container with the SvelteKit app embedded; SQLite and local media are the defaults, with PostgreSQL and S3-compatible storage available.
- **Android:** every GitHub release includes a Capacitor APK built from the same responsive web app.

OAuth tokens are encrypted at rest. OpenPost also supports revocable sessions, passkeys, TOTP two-factor authentication, password recovery, account exports and deletion, and workspace roles.

## Platform support

This table describes OpenPost publishing code paths, not every feature offered by each provider. The queue and account-specific variant flows cover every listed provider, but provider approval, app configuration, quotas, and live-account verification still determine whether a destination can publish in production.

| Platform           | Implemented publishing profiles                              | Threads / replies           | Maturity and main caveat                                                          |
| ------------------ | ------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------- |
| X                  | Text, links, up to 4 images, short video                     | Reply chains                | Implemented; video, API quota, and account tier need live verification            |
| Mastodon           | Text, links, up to 4 image/video attachments                 | Reply chains                | Implemented; limits and OAuth vary by instance, and video needs live verification |
| Bluesky            | Text, links, up to 4 images, one MP4 video                   | AT Protocol reply chains    | Implemented; video still needs live-account verification                          |
| LinkedIn           | Text, links, image, document, short and long video           | Child posts become comments | Implemented; permissions, app review, and video need live verification            |
| Threads            | Text, image, video, and 2-10 item mixed carousels            | Reply chains                | Implemented; public media and approved Meta app access are required               |
| Facebook Pages     | Text, links, image, multi-photo, Story, short and long video | Comment operations          | Preview; Page permissions, app review, and public media URLs apply                |
| Instagram Business | Feed image, carousel, Story, and Reel                        | Comment operations          | Preview; requires a Page-backed professional account and public media URLs        |
| TikTok             | Video and 1-35 image photo posts                             | No                          | Preview; Content Posting API review or audit is required                          |
| YouTube            | Shorts and long-form video                                   | No                          | Preview; title required, with Google audit and quota constraints                  |

“Implemented” means the code path and validation exist. Provider approval, deployment configuration, quotas, and live-account verification can still affect production access. See the [provider matrix](https://docs.openpost.social/providers/platform-limits) for current limits.

## Run OpenPost

The managed app is available at [app.openpost.social](https://app.openpost.social). Registration can create one bootstrap workspace before checkout, but connecting accounts, uploading media, scheduling, publishing, and other provider writes require an active or Polar-trialing subscription. There is no automatic hosted trial or free tier; managed publishing starts at €6/month.

Self-hosted OpenPost has no software subscription. Copy the environment template, replace the two example secrets, set the public app URL, and start the container:

```bash
cp .env.example .env
# Edit .env: set OPENPOST_APP_URL and generate unique 32+ character secrets.
docker compose up -d
```

The container listens on port `8080` and stores its SQLite database and media in the `openpost_data` volume. Put production instances behind HTTPS and back up the database, media, and secrets together.

Other supported installation paths:

- [Single binary](https://docs.openpost.social/installation/binary)
- [Docker Compose](https://docs.openpost.social/installation/docker-compose)
- [NixOS module](https://docs.openpost.social/installation/nix-module)
- [Android APK](https://docs.openpost.social/installation/android)
- [Build from source](https://docs.openpost.social/installation/build-from-source)

## Automation surfaces

- `openpost`: command-line client for authentication, workspaces, accounts, media, posts, publications, jobs, billing, and instance administration.
- `openpost-mcp`: stdio MCP server for local clients; the web service also exposes authenticated Streamable HTTP MCP.
- `/api/v1`: typed HTTP API used by the app and CLI.
- OpenAPI and generated CLI reference: [docs.openpost.social/reference](https://docs.openpost.social/reference/api).

Release binaries are available for Linux, macOS, and Windows where supported by each artifact. The Android APK is attached to the same GitHub release.

## Repository layout

| Path              | Purpose                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `backend/`        | Go API, embedded frontend, database, jobs, billing, and provider adapters     |
| `frontend/`       | SvelteKit web app and Capacitor Android shell                                 |
| `cli/`            | CLI and MCP binaries                                                          |
| `marketing-site/` | Public OpenPost website                                                       |
| `docs-site/`      | User, self-hosting, provider, CLI, MCP, and development documentation         |
| `scripts/`        | Contract checks, asset synchronization, release tooling, and repository gates |

## Development

OpenPost uses the committed Devenv and pnpm lockfiles. After cloning:

```bash
direnv allow
devenv shell -- install
devenv shell -- setup
devenv shell -- verify
```

`verify` runs checks, linting, backend/frontend/CLI tests, contract checks, and production builds. See the [development setup](https://docs.openpost.social/development/setup) and [contributing guide](https://docs.openpost.social/development/contributing) before sending changes.

## Current limits

- Provider capabilities are intentionally not flattened into one promise; formats, media limits, review requirements, and quota behavior differ.
- Some video, Story, comment, and newer provider paths still need recent live-account verification before production use.
- Advanced engagement analytics and enterprise approval workflows are not the current focus.
- Self-hosted OAuth providers require correctly configured developer applications and exact HTTPS callback URLs.

## Documentation

- [Documentation home](https://docs.openpost.social/)
- [Quickstart](https://docs.openpost.social/guide/quickstart)
- [Using OpenPost](https://docs.openpost.social/usage/)
- [Self-hosting](https://docs.openpost.social/self-hosting/)
- [Provider setup](https://docs.openpost.social/providers/overview)
- [CLI](https://docs.openpost.social/cli/)
- [MCP](https://docs.openpost.social/mcp/)
- [Configuration](https://docs.openpost.social/configuration/environment-variables)
- [Operations](https://docs.openpost.social/operations/troubleshooting)
- [Development](https://docs.openpost.social/development/setup)

## Contributing

Use the development docs, the repository guidance in `AGENTS.md`, and the existing patterns in `frontend/`, `backend/`, and `cli/`.

## Security

Report security issues through [SECURITY.md](SECURITY.md).

## License

OpenPost is available under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). If you offer a modified version over a network, you must make its corresponding source code available to its users.
