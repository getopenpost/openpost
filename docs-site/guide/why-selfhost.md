# When Self-Hosting Fits

OpenPost is one product with two deployment paths. The Hosted service is operated by OpenPost. A self-hosted deployment runs on infrastructure you control and stores OpenPost data where you choose.

## What You Control

A self-hosted installation stores OpenPost data on servers and storage you choose:

- drafts, schedules, workspaces, and publishing history in SQLite or PostgreSQL;
- media on local disk or S3-compatible object storage;
- encrypted social account tokens in the app database;
- app secrets, social app keys, logs, backups, and data retention settings.

OpenPost still sends content and access tokens to each social network when it carries out your request. Self-hosting changes who runs OpenPost. It does not remove the social networks.

## What You Need to Operate

Plan for these server tasks:

- TLS and a public application URL;
- unique JWT and encryption secrets;
- database and media backups, plus tested restores;
- release updates and security patches;
- social app keys, callback addresses, permissions, and review;
- checks for failed posts and low storage.

The default setup stays small: one Go binary or container, SQLite, local media, and saved background jobs. Redis is not required. You can use PostgreSQL and S3-compatible storage for a larger setup.

## Choose the Hosted Service When

Use the Hosted service if you want OpenPost without maintaining its server, backups, TLS, and upgrades. It is also simpler when you do not need a custom server setup or code changes.

Hosted service plans start at $15 per month and include a card-required 14-day trial. OpenPost shows the renewal price and date before you start. An active or trialing plan is required to connect accounts, upload media, schedule, or publish.

## Choose Self-Hosting When

Self-hosting is a good fit when you:

- already operate a server and can maintain it;
- need application data in a specific environment;
- want to inspect or change the code;
- need custom storage, networking, or social app settings;
- accept the server work and cost.

Self-hosting has no software fee. It is not a Hosted service plan or a zero-price Hosted service tier. Server and social network API costs still apply.

Start with the [self-hosting guide](/self-hosting/) for deployment steps and the [security policy](https://github.com/getopenpost/openpost/blob/main/SECURITY.md) for production guidance.
