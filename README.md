<p align="center">
  <a href="https://openpost.social">
    <img alt="OpenPost" src="./assets/brand/logo.svg" width="280">
  </a>
</p>

<p align="center">
  <strong>Turn what you are building into content. Publish it everywhere.</strong>
  <br>
  The all-in-one content team for solo founders.
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
  <a href="https://app.openpost.social/register?plan=creator"><strong>Start a 14-day trial</strong></a>
  ·
  <a href="https://youtu.be/_mZf3HzQaN8"><strong>Watch the demo</strong></a>
  ·
  <a href="https://docs.openpost.social/guide/quickstart"><strong>Quickstart</strong></a>
  ·
  <a href="https://discord.gg/u2QwukmY4W"><strong>Discord community</strong></a>
</p>

<p align="center">
  <img alt="OpenPost composer with account versions and scheduling controls" src="./assets/screenshots/main-dark.png" width="100%">
</p>

## One content team for companies of one

OpenPost helps solo founders turn launches, product updates, lessons, and ideas into content, then adapt, schedule, and track it from one workspace.

- **Write one shared post.** Change the text, media, format, and settings for each account.
- **See the full schedule.** Plan posts in a calendar, reuse posting times, and check scheduled, published, and failed posts.
- **Track real platform numbers.** Keep account growth and post results while treating views, impressions, and reach as different metrics.
- **Make still images.** Use OpenPost Studio without an account for local exports with no watermark, or save designs with workspace media and brand items.
- **Make social videos locally.** Video Studio can stream-copy combined or per-section cuts without transcoding, or open the complete desktop or touch editor for four social formats, local transcript editing, effects, recording, proxies, and watermark-free export.
- **Keep brands separate.** Workspaces isolate accounts, media, schedules, members, and automation access.
- **Manage replies and messages.** Read and reply to comments, get personal alerts, and turn on inbox collection for supported accounts.
- **Choose how users sign in.** Require email confirmation, enable Google login, link methods explicitly, or configure organization SSO.
- **Configure optional services in the app.** Instance admins can add encrypted billing, email, identity, stock media, feedback, and social provider credentials while deployment environment values remain authoritative.
- **Automate without sharing social account keys.** Use the API, CLI, or MCP with OpenPost tokens that you can limit to one workspace and remove.
- **Run a small server.** Use one container or binary, SQLite, local media, and saved background jobs. Redis is not required.

OpenPost does not include a CRM, ad manager, social listening, or large-company benchmarks.

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
    <td align="center"><strong>Connect social accounts to each workspace</strong></td>
    <td align="center"><strong>Reuse files and see where each one is used</strong></td>
  </tr>
</table>

## Supported platforms

OpenPost supports X, Mastodon, Bluesky, LinkedIn profiles and Organization Pages, Threads, Facebook Pages, Instagram Business and Creator accounts, TikTok, YouTube, and Discord webhooks.

App review, setup, account access, API limits, public media links, or a failed live test can still block an account or format. Check the [platform table](https://docs.openpost.social/providers/platform-limits) for current formats, media limits, and setup notes.

## Self-host in a few minutes

```bash
git clone https://github.com/rodrgds/openpost.git
cd openpost
cp .env.example .env
# Set OPENPOST_APP_URL and replace the two example secrets in .env.
docker compose up -d
```

Open `http://localhost:8080`, create the first account, and connect a social account. Bluesky is the fastest first test because it only needs a handle and app password.

The default Compose setup stores the SQLite database and uploaded media in one Docker volume. For a public server, put OpenPost behind HTTPS and set the public URL before you set up OAuth.

[Read the self-hosting quickstart →](https://docs.openpost.social/guide/quickstart)

Prefer not to operate it yourself? [Use the managed app](https://app.openpost.social).

## Scheduled posts survive restarts

OpenPost saves scheduled work in its database. A server restart does not remove it, and the app shows the result.

The self-hosted defaults stay small:

| Part              | Default                                       |
| ----------------- | --------------------------------------------- |
| Application       | One Go binary with the SvelteKit app embedded |
| Database          | SQLite                                        |
| Media             | Local storage                                 |
| Scheduled jobs    | Built into the database                       |
| Optional scale-up | PostgreSQL and S3-compatible storage          |

OpenPost encrypts social account keys with AES-256-GCM. You can limit API and MCP tokens to one workspace and remove them without reconnecting social accounts.

## Automation when you need it

The web app is the main place to review and control posts. The same access rules, checks, plan limits, and saved jobs also cover:

- the typed HTTP API;
- the `openpost` CLI for scripts, cron, and CI;
- the local and remote MCP interfaces for assistants and coding agents.

This lets an AI tool read workspace data, prepare account versions, and return them for review without seeing social account tokens.

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

For setup questions, ideas, and general discussion, join the [OpenPost Discord community](https://discord.gg/u2QwukmY4W).

## Help OpenPost grow

If OpenPost is useful to you, **star the repository**. It helps other self-hosters find the project and tells us which work is worth continuing.

<p align="center">
  <a href="https://github.com/rodrgds/openpost">
    <img src="https://img.shields.io/github/stars/rodrgds/openpost?style=for-the-badge&logo=github&label=Star%20OpenPost&color=c9612f" alt="Star OpenPost on GitHub">
  </a>
</p>

## License and security

OpenPost is licensed under [AGPL-3.0-only](LICENSE). Report vulnerabilities privately through the [security policy](SECURITY.md).
