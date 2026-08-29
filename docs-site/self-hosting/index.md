# Self-Hosting Docs

Use these docs when you operate OpenPost on your own infrastructure. Self-hosting has no software fee, but it is not a Hosted service plan or a zero-price tier of the Hosted service. You pay for your infrastructure and any provider or third-party services you use.

These pages assume that you manage the server, public HTTPS origin, access controls, secrets, database, media storage, monitoring, backups, upgrades, and incident response. You also support the people who use your deployment and maintain its privacy, retention, and recovery practices.

## Responsibility boundary

- **Infrastructure and data:** you choose and secure the server, database, media storage, logs, network, and data locations.
- **Upgrades and backups:** you track releases and security notices, apply updates, back up the database, media, and required secrets together, and test restores.
- **Provider projects:** you create and maintain social network projects, callback URLs, permissions, reviews, API access, and provider budgets. OpenPost still sends requested content and access tokens to those networks.
- **Support:** OpenPost publishes documentation, source code, a public issue tracker, and community help. A self-hosted operator handles deployment availability, user support, incidents, and operator-specific configuration.

Review the [OpenPost source](https://github.com/getopenpost/openpost), [security policy](https://github.com/getopenpost/openpost/blob/main/SECURITY.md), and current [releases](https://github.com/getopenpost/openpost/releases) before exposing an instance to users.

## When self-hosting fits

A self-hosted installation stores OpenPost data on servers and storage you choose:

- drafts, schedules, workspaces, and publishing history in SQLite or PostgreSQL;
- media on local disk or S3-compatible object storage;
- encrypted social account tokens in the app database;
- app secrets, social app keys, logs, backups, and data retention settings.

OpenPost still sends content and access tokens to each social network when it carries out your request. Self-hosting changes who runs OpenPost. It does not remove the social networks.

Plan for TLS and a public application URL, unique JWT and encryption secrets, tested database and media restores, release and security updates, social app keys and reviews, and checks for failed posts and low storage. The default setup stays small: one Go binary or container, SQLite, local media, and saved background jobs. Redis is not required. PostgreSQL and S3-compatible storage are available for larger setups.

Choose self-hosting when you already operate a server, need data in a specific environment, want to inspect or change the code, or need custom storage, networking, or social app settings. Choose the [Hosted service](https://openpost.social/pricing) when you want OpenPost to manage its server, backups, TLS, and upgrades.

## Install

- [Docker Compose](/installation/docker-compose) is the best place to start.
- [Single Binary](/installation/binary) covers the app and server in one file.
- [Nix Module](/installation/nix-module) covers the generated NixOS module reference.
- [Reverse Proxy](/installation/reverse-proxy) covers public HTTPS routing.
- [Build From Source](/installation/build-from-source) covers local builds.
- [Docker Run](/installation/docker-run) shows how to run the container by hand.

## Configure

- [Configuration](/configuration/) groups the main settings.
- [Environment Variables](/configuration/environment-variables) is the full configuration reference.
- [Custom Connectors](/configuration/custom-connectors) adds operator-run HTTP services as publishing destinations.
- [Database](/configuration/database) covers SQLite and Postgres.
- [Media Storage](/configuration/media-storage) covers local files and S3/R2 storage.
- [CORS and URLs](/configuration/cors-and-urls) covers public app and media web addresses.
- [Production Checklist](/configuration/production-checklist) helps you check the server before people use it.

## Providers

- [Providers](/providers/) explains social network app setup, implementations, and limits.
- [Provider Troubleshooting](/providers/troubleshooting) helps with OAuth, access, media link, and publish errors.
- [Provider Launch Matrix](/operations/provider-launch-matrix) covers evidence and readiness for operators.
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
