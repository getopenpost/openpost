# Umbrel App Store package

This directory maintains the OpenPost package submitted to the official
[Umbrel App Store](https://github.com/getumbrel/umbrel-apps/pull/6230).
The submission is awaiting review. Until it is accepted, use the
[Portainer installation guide](https://openpo.st/docs/self-hosting/umbrelos).

The package requires umbrelOS 2.0 or later. It runs the official multi-architecture
image as UID/GID 1000, with SQLite, media, and instance state under
`${APP_DATA_DIR}/data`. It uses Umbrel's gateway on port 3457 and does not publish
the backend port. No other apps or host permissions are required.

## Configure social publishing

Create the first OpenPost account through the Umbrel home-screen entry. There
are no default OpenPost credentials. Configure provider applications in
OpenPost's instance administration, following the
[integration guides](https://openpo.st/docs/self-hosting/integrations).

Before connecting social accounts, configure a public HTTPS reverse proxy or
tunnel to the Umbrel app port. In the app's Umbrel settings, set
`OPENPOST_APP_URL` to the public origin, such as `https://post.example.com`.
OpenPost derives its public origin, OAuth callback defaults, and media URL from
this setting. Changing it restarts the app; it does not create a tunnel or
publish the app. Configure the provider callback URLs against that origin.

Umbrel login remains enabled. Provider callback routes, Telegram and X messaging
webhooks, and `/media/*` bypass Umbrel login so external services can reach them.
OpenPost still validates OAuth state, webhook credentials, and media access.
The rest of the API remains behind Umbrel login. Native apps, CLI, MCP, and
external API clients need an access path that supports their authentication;
turning off **Require Umbrel login** exposes OpenPost's own sign-in and API.
Create the first account and close registration before doing that.

Set `OPENPOST_DISABLE_REGISTRATIONS=true` in Umbrel's app settings after creating
the accounts you need. Existing accounts can still sign in.

The package trusts only Umbrel's host bridge gateway for forwarded HTTPS and
client-address headers. A separate public proxy must overwrite forwarded headers
before forwarding to Umbrel. Do not expose the internal OpenPost container port
or broaden trusted proxies to the shared app network.

## Maintain the package

Copy `umbrel-app.yml`, `docker-compose.yml`, `exports.sh`, and `data/.gitkeep`
to `openpost/` in a checkout of `getumbrel/umbrel-apps`. Keep this directory and
the upstream submission identical. Do not copy this README into the package.

Pin the stable release tag and its multi-architecture index digest together.
Verify that the index contains both `linux/amd64` and `linux/arm64`:

```sh
docker buildx imagetools inspect ghcr.io/getopenpost/openpost:v7.39.0
```

From the Umbrel Apps checkout, run its maintained package checks:

```sh
npm ci
npm run lint:apps -- openpost --check-images
bash -n openpost/exports.sh
git diff --check
```

Follow that repository's `umbrel-test-app` skill for installation, HTTP and HTTPS
onboarding, saving a post with media, app-setting changes, restart, and persistence
checks. Verify that unsigned webhook requests and unauthenticated private media
requests still fail through the public gateway. Test the actual release image;
raw Compose or a standalone binary does not prove the Umbrel lifecycle.

Session and encryption keys are derived independently from Umbrel's stable
per-install entropy. Preserve their derivation labels across updates. Back up
the data folder and Umbrel's device seed together through Umbrel's backup system;
copying only the SQLite database and media to another Umbrel does not preserve
the keys needed to decrypt provider credentials. For a manual migration, retain
both original secret values privately and follow OpenPost's
[backup and restore guide](https://openpo.st/docs/self-hosting/maintenance).
