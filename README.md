<p align="center">
  <a href="https://openpost.social">
    <img alt="OpenPost" src="./assets/brand/logo.svg" width="280">
  </a>
</p>

<p align="center">
  <strong>A lightweight, self-hosted social media scheduler.</strong>
  <br>
  Draft once, tailor each destination, and publish from one clear calendar.
</p>

<p align="center">
  <a href="https://github.com/rodrgds/openpost/releases">
    <img src="https://img.shields.io/github/v/release/rodrgds/openpost?sort=semver&label=release" alt="Latest release">
  </a>
  <a href="https://github.com/rodrgds/openpost/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/rodrgds/openpost/ci.yml?label=build" alt="Build status">
  </a>
  <a href="https://github.com/rodrgds/openpost">
    <img src="https://img.shields.io/github/stars/rodrgds/openpost?style=flat&label=stars" alt="GitHub stars">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0-only">
  </a>
</p>

<p align="center">
  <a href="https://app.openpost.social"><strong>Try OpenPost</strong></a>
  ·
  <a href="https://youtu.be/_mZf3HzQaN8"><strong>Watch the demo</strong></a>
  ·
  <a href="https://docs.openpost.social/guide/quickstart"><strong>Quickstart</strong></a>
  ·
  <a href="https://docs.openpost.social/self-hosting/"><strong>Self-hosting docs</strong></a>
</p>

<p align="center">
  <img alt="OpenPost composer with account destinations and scheduling controls" src="./assets/screenshots/main-dark.png" width="100%">
</p>

## A focused scheduler, not another marketing suite

OpenPost handles the part that should be simple: preparing, adapting, scheduling, and publishing social posts.

- **Write once, publish properly everywhere.** Keep one source post and adjust the text, media, format, and settings for each destination.
- **See the whole schedule.** Plan posts in a calendar, reuse posting slots, and inspect queued, published, and failed work.
- **Create the media you need.** Store reusable assets and build still images, carousels, and slideshow pages in OpenPost Studio.
- **Keep brands separate.** Workspaces isolate accounts, media, schedules, members, and automation access.
- **Automate without sharing social credentials.** Use the API, CLI, or MCP with revocable, workspace-scoped OpenPost tokens.
- **Run it without an infrastructure project.** One container or binary, SQLite and local media by default, and a built-in durable job queue. Redis is not required.

OpenPost stays deliberately narrower than an all-in-one social marketing platform. It does not try to bundle a CRM, ad manager, social listening suite, or enterprise analytics product into the scheduler.

<table>
  <tr>
    <td width="50%">
      <img alt="Connected social accounts in OpenPost" src="./assets/screenshots/accounts-dark.png">
    </td>
    <td width="50%">
      <img alt="Reusable social assets in the OpenPost media library" src="./assets/screenshots/media-dark.png">
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Connect each workspace to the channels it owns</strong></td>
    <td align="center"><strong>Reuse assets and see where each file is used</strong></td>
  </tr>
</table>

## Supported platforms

| Status        | Platforms                                                        |
| ------------- | ---------------------------------------------------------------- |
| **Supported** | X, Mastodon, Bluesky, LinkedIn, Threads                          |
| **Preview**   | Facebook Pages, Instagram professional accounts, TikTok, YouTube |

Preview integrations have working publishing paths, but provider review, app configuration, account eligibility, or live-account verification may still limit production use. Check the [provider matrix](https://docs.openpost.social/providers/platform-limits) for current formats, media limits, and setup notes.

## Self-host in a few minutes

```bash
git clone https://github.com/rodrgds/openpost.git
cd openpost
cp .env.example .env
# Set OPENPOST_APP_URL and replace the two example secrets in .env.
docker compose up -d
```

Open `http://localhost:8080`, create the first account, and connect a provider. Bluesky is the fastest first test because it only needs a handle and app password.

The default Compose setup stores the SQLite database and uploaded media in one Docker volume. For a public instance, put OpenPost behind HTTPS and set the public URL before configuring OAuth providers.

[Read the self-hosting quickstart →](https://docs.openpost.social/guide/quickstart)

Prefer not to operate it yourself? [Use the managed app](https://app.openpost.social).

## Built for reliable publishing

A scheduled post should not disappear because a process restarted. OpenPost stores publishing work in its database-backed queue and keeps the outcome visible in the app.

The self-hosted defaults stay small:

| Part              | Default                                       |
| ----------------- | --------------------------------------------- |
| Application       | One Go binary with the SvelteKit app embedded |
| Database          | SQLite                                        |
| Media             | Local storage                                 |
| Queue             | Built into the database                       |
| Optional scale-up | PostgreSQL and S3-compatible storage          |

Provider credentials are encrypted at rest with AES-256-GCM. API and MCP tokens can be scoped to one workspace and revoked without reconnecting its social accounts.

## Automation when you need it

The web app is the main place to review and control publishing. The same authorization, validation, quotas, and queue rules also cover:

- the typed HTTP API;
- the `openpost` CLI for scripts, cron, and CI;
- the local and remote MCP interfaces for assistants and coding agents.

This lets an agent inspect workspace context, prepare destination-specific drafts, and hand the result back for review without receiving the underlying provider tokens.

[CLI guide](https://docs.openpost.social/cli/) · [MCP guide](https://docs.openpost.social/mcp/) · [API reference](https://docs.openpost.social/reference/api)

## Install another way

Releases include:

- Linux, macOS, and Windows server binaries;
- CLI and MCP binaries;
- the container image at `ghcr.io/rodrgds/openpost`;
- an Android APK.

See the [installation docs](https://docs.openpost.social/self-hosting/) for binary installs, reverse proxies, storage, backups, and upgrades.

## Contributing

OpenPost uses Go, Svelte 5, SvelteKit, and pnpm. The repository includes a Devenv shell so local commands match CI.

```bash
direnv allow
devenv shell -- setup
devenv shell -- verify
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [development docs](https://docs.openpost.social/development/setup) before opening a pull request. Bug reports, focused feature proposals, documentation fixes, and tested provider improvements are welcome.

## Help OpenPost grow

If OpenPost is useful to you, **star the repository**. It helps other self-hosters find the project and tells us which work is worth continuing.

<p align="center">
  <a href="https://github.com/rodrgds/openpost">
    <img src="https://img.shields.io/github/stars/rodrgds/openpost?style=for-the-badge&logo=github&label=Star%20OpenPost&color=c9612f" alt="Star OpenPost on GitHub">
  </a>
</p>

## License and security

OpenPost is licensed under [AGPL-3.0-only](LICENSE). Report vulnerabilities privately through the [security policy](SECURITY.md).
