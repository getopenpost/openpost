# Self-Hosting Docs

Use these docs when you operate OpenPost on your own infrastructure. Self-hosting has no software fee, but it is not a Hosted service plan or a zero-price tier of the Hosted service. You pay for your infrastructure and any provider or third-party services you use.

These pages assume that you manage the server, public HTTPS origin, access controls, secrets, database, media storage, monitoring, backups, upgrades, and incident response. You also support the people who use your deployment and maintain its privacy, retention, and recovery practices.

## Responsibility boundary

- **Infrastructure and data:** you choose and secure the server, database, media storage, logs, network, and data locations.
- **Upgrades and backups:** you track releases and security notices, apply updates, back up the database, media, and required secrets together, and test restores.
- **Provider projects:** you create and maintain social network projects, callback URLs, permissions, reviews, API access, and provider budgets. OpenPost still sends requested content and access tokens to those networks.
- **Support:** OpenPost publishes documentation, source code, a public issue tracker, and community help. A self-hosted operator handles deployment availability, user support, incidents, and operator-specific configuration.

Review the [OpenPost source](https://github.com/getopenpost/openpost), [security policy](https://github.com/getopenpost/openpost/blob/main/SECURITY.md), and current [releases](https://github.com/getopenpost/openpost/releases) before exposing an instance to users.

## Install

- [Why Self-Host?](/guide/why-selfhost) explains the costs and benefits. OpenPost uses SQLite and local files by default when you run it yourself.
- [Docker Compose](/installation/docker-compose) is the best place to start.
- [Single Binary](/installation/binary) covers the app and server in one file.
- [Nix Module](/installation/nix-module) covers the generated NixOS module reference.
- [Reverse Proxy](/installation/reverse-proxy) covers public HTTPS routing.
- [Build From Source](/installation/build-from-source) covers local builds.
- [Docker Run](/installation/docker-run) shows how to run the container by hand.

## Configure

- [Configuration Overview](/configuration/overview) groups the main settings.
- [Environment Variables](/configuration/environment-variables) is the full configuration reference.
- [Database](/configuration/database) covers SQLite and Postgres.
- [Media Storage](/configuration/media-storage) covers local files and S3/R2 storage.
- [CORS and URLs](/configuration/cors-and-urls) covers public app and media web addresses.
- [Production Checklist](/configuration/production-checklist) helps you check the server before people use it.

## Providers

- [Providers Overview](/providers/overview) explains social network app setup.
- [Supported Platforms and Limits](/providers/platform-limits) lists current implementation state.
- [Provider Troubleshooting](/providers/troubleshooting) helps with OAuth, access, media link, and publish errors.
- [Provider Roadmap](/providers/roadmap) explains what works now and what is planned.
- [X](/providers/x), [Mastodon](/providers/mastodon), [Bluesky](/providers/bluesky), [LinkedIn](/providers/linkedin), [Threads](/providers/threads), [Facebook](/providers/facebook), [Instagram](/providers/instagram), [TikTok](/providers/tiktok), [YouTube](/providers/youtube), and [Discord](/providers/discord) cover each network's setup.

## Operate

- [Backups](/operations/backups)
- [Health Checks](/operations/health-checks)
- [Logs](/operations/logs)
- [Upgrades](/operations/upgrades)
- [Troubleshooting](/operations/troubleshooting)

## Adjacent docs

- If you only need to use the product, start with [User Docs](/usage/).
- If you are changing OpenPost code, start with [Developer Docs](/development/).
