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
  <a href="https://github.com/rodrgds/openpost">
    <img src="https://img.shields.io/github/stars/rodrgds/openpost?label=Stars" alt="GitHub Stars">
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
  <img alt="OpenPost main dashboard screenshot" src="./assets/screenshots/main-dark.png" width="960">
</p>

## Why OpenPost

OpenPost keeps one source post, account-specific renditions, reusable media, schedules, and publishing outcomes in one workspace.

- Prepare one post, then adapt text, media, format, and settings for each account.
- Review every destination in the web app before it enters the queue.
- Plan with a calendar, workspace timezones, reusable posting slots, and durable jobs.
- Create reusable media and multi-page social images in OpenPost Studio.
- Automate through the HTTP API, CLI, or MCP without giving clients provider credentials.
- Run one Go binary or container with SQLite and local media by default. PostgreSQL and S3-compatible storage are optional.

## Platforms

OpenPost supports X, Mastodon, Bluesky, LinkedIn, and Threads. Preview integrations are available for Facebook Pages, Instagram professional accounts, TikTok, and YouTube, where provider review or live-account verification can still limit production use.

See the [current provider matrix](https://docs.openpost.social/providers/platform-limits) for formats, media limits, setup requirements, and verification notes.

## Run OpenPost

Use the [managed app](https://app.openpost.social), or self-host the same AGPL product:

```bash
cp .env.example .env
# Set OPENPOST_APP_URL and replace the two example secrets.
docker compose up -d
```

The container listens on `8080` and stores its SQLite database and media in the `openpost_data` volume. Read the [self-hosting quickstart](https://docs.openpost.social/guide/quickstart) before a production setup. Releases also include server binaries, CLI and MCP binaries, and an Android APK.

## Automation

The `openpost` CLI, `openpost-mcp` stdio proxy, authenticated remote MCP endpoint, and typed `/api/v1` API share the app's authorization, workspace, validation, quota, and queue rules.

Start with the [agent-assisted publishing guide](https://docs.openpost.social/usage/agent-assisted-publishing), [CLI guide](https://docs.openpost.social/cli/), [MCP guide](https://docs.openpost.social/mcp/), or [API reference](https://docs.openpost.social/reference/api).

## Development

```bash
direnv allow
devenv shell -- setup
devenv shell -- verify
```

See the [development setup](https://docs.openpost.social/development/setup) and [contributing guide](CONTRIBUTING.md).

## Star history

[![OpenPost stars](https://img.shields.io/github/stars/rodrgds/openpost?style=for-the-badge&label=OpenPost%20stars)](https://www.star-history.com/?repos=rodrgds%2Fopenpost&type=date&legend=top-left)

[View OpenPost on Star History](https://www.star-history.com/?repos=rodrgds%2Fopenpost&type=date&legend=top-left).

## License

OpenPost is available under [AGPL-3.0-only](LICENSE). Report vulnerabilities privately through the [security policy](SECURITY.md).
