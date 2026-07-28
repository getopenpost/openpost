# Self-Hosting Docs

Use these docs when you run OpenPost yourself: install it, configure URLs and secrets, connect provider apps, keep data backed up, and operate the instance over time.

Self-hosting docs are separate from user-facing docs. They assume you own the server or deployment and can change environment variables, volumes, reverse proxies, provider apps, and backups.

## Install

- [Why Self-Host?](/guide/why-selfhost) explains the tradeoffs and why OpenPost keeps SQLite/local storage as the default self-hosted path.
- [Docker Compose](/installation/docker-compose) is the recommended first production-style setup.
- [Single Binary](/installation/binary) covers the embedded frontend/backend binary.
- [Nix Module](/installation/nix-module) covers the generated NixOS module reference.
- [Reverse Proxy](/installation/reverse-proxy) covers public HTTPS routing.
- [Build From Source](/installation/build-from-source) covers local builds.
- [Docker Run](/installation/docker-run) is the low-level container reference.

## Configure

- [Configuration Overview](/configuration/overview) groups the main settings.
- [Environment Variables](/configuration/environment-variables) is the full configuration reference.
- [Database](/configuration/database) covers SQLite defaults and Postgres-ready hosted deployments.
- [Media Storage](/configuration/media-storage) covers local files and S3/R2-compatible storage.
- [CORS and URLs](/configuration/cors-and-urls) covers public app/media origins.
- [Production Checklist](/configuration/production-checklist) covers launch readiness.

## Providers

- [Providers Overview](/providers/overview) explains provider app setup.
- [Supported Platforms and Limits](/providers/platform-limits) lists current implementation state.
- [Provider Troubleshooting](/providers/troubleshooting) maps OAuth, permission, media URL, and publish errors to operator checks.
- [Provider Roadmap](/providers/roadmap) explains available, unconfigured, and planned providers.
- [X](/providers/x), [Mastodon](/providers/mastodon), [Bluesky](/providers/bluesky), [LinkedIn](/providers/linkedin), [Threads](/providers/threads), [Facebook](/providers/facebook), [Instagram](/providers/instagram), [TikTok](/providers/tiktok), and [YouTube](/providers/youtube) cover provider-specific requirements.

## Operate

- [Backups](/operations/backups)
- [Health Checks](/operations/health-checks)
- [Logs](/operations/logs)
- [Upgrades](/operations/upgrades)
- [Troubleshooting](/operations/troubleshooting)

## Adjacent docs

- If you only need to use the product, start with [User Docs](/usage/).
- If you are changing OpenPost code, start with [Developer Docs](/development/).
