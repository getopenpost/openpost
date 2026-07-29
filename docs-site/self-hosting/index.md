# Self-Hosting Docs

Use these docs when you run OpenPost on your own server. They cover setup, web addresses, secrets, social network apps, backups, and updates.

These pages assume that you manage the server. You should know how to set environment variables, save data outside a container, run a reverse proxy, and make backups.

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
