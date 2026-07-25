# When Self-Hosting Fits

OpenPost offers the same publishing product as a managed app and as an open-source server. Self-hosting gives you control over where the application runs and where its data is stored. It also makes you responsible for operating it.

## What You Control

A self-hosted installation stores OpenPost data on infrastructure you choose:

- drafts, schedules, workspaces, and publishing history in SQLite or PostgreSQL;
- media on local disk or S3-compatible object storage;
- encrypted provider access and refresh tokens in the application database;
- application secrets, provider credentials, logs, backups, and retention settings.

OpenPost still sends content and access tokens to each connected social provider when it performs an action you request. Self-hosting changes who operates the OpenPost service; it does not remove the providers from the publishing path.

## What You Need to Operate

Plan for the same work as any internet-facing application:

- TLS and a public application URL;
- unique JWT and encryption secrets;
- database and media backups, plus tested restores;
- release updates and security patches;
- provider app credentials, callback URLs, permissions, and review;
- monitoring for failed publishing jobs and storage capacity.

The default deployment stays small: one Go binary or container, SQLite, local media, and a database-backed queue. Redis is not required. PostgreSQL and S3-compatible storage are available when the installation needs them.

## Choose the Managed App When

Use the managed app if you want OpenPost without maintaining its server, backups, TLS, and upgrades. It is also the simpler path when you do not need custom infrastructure or application changes.

Managed publishing starts at €6/month. Registration can create one bootstrap workspace before checkout, but connecting accounts, uploading media, scheduling, publishing, and other provider writes require an active or Polar-trialing subscription. There is no automatic hosted free tier or trial.

## Choose Self-Hosting When

Self-hosting is a good fit when you:

- already operate a server and can maintain it;
- need application data in a specific environment;
- want to inspect or change the implementation;
- need custom storage, networking, or provider configuration;
- accept the operational cost in exchange for that control.

The self-hosted edition has no software subscription. Infrastructure and provider API costs still apply.

Start with the [self-hosting guide](/self-hosting/) for deployment steps and the [security policy](https://github.com/rodrgds/openpost/blob/main/SECURITY.md) for production guidance.
