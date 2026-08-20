# Mastodon

This page is for operators configuring Mastodon and users connecting a custom or preconfigured instance.

Mastodon can be connected in two ways:

- **Custom instance from the Accounts screen:** enter a public instance such as `mastodon.social`. OpenPost registers an app with that instance, encrypts the client secret, and reuses it for later connections.
- **Preconfigured instances:** operators can still pin known instance app credentials with `MASTODON_SERVERS`, `OPENPOST_PROVIDER_APPS`, or the instance-admin provider app API.

## What you need

- For custom instances: no static env entry is required, but the instance must be public HTTPS and allow app registration.
- For preconfigured instances: one Mastodon app per instance and either `MASTODON_SERVERS` JSON, `OPENPOST_PROVIDER_APPS`, or an encrypted provider app row created through the instance-admin API.
- Redirect URI: `urn:ietf:wg:oauth:2.0:oob` by default.

## Custom instance flow

1. Open **Accounts**.
2. Choose **Mastodon / Custom instance**.
3. Enter an instance host or URL.
4. Authorize OpenPost on that instance.
5. Paste the authorization code into the OpenPost callback page.

OpenPost rejects custom Mastodon hosts that resolve to private, loopback, link-local, multicast, or otherwise local addresses.

## Example preconfigured instance

```sh
MASTODON_SERVERS='[
  {
    "name": "Personal",
    "client_id": "xxx",
    "client_secret": "yyy",
    "instance_url": "https://mastodon.social"
  }
]'
```

## Provider app API

Instance admins can store encrypted Mastodon provider apps in **Settings → Instance → Configuration → Provider apps** or through `POST /api/v1/admin/provider-apps`. Use this when a specific instance does not allow dynamic app registration or when you want OpenPost to use credentials you already created on that instance. `MASTODON_SERVERS` and `OPENPOST_PROVIDER_APPS` remain the environment-based deployment options and take precedence over matching database rows.

## Multiple instances

```sh
MASTODON_SERVERS='[
  {
    "name": "Personal",
    "client_id": "abc",
    "client_secret": "def",
    "instance_url": "https://mastodon.social"
  },
  {
    "name": "Work",
    "client_id": "ghi",
    "client_secret": "jkl",
    "instance_url": "https://fosstodon.org"
  }
]'
```

## Analytics

Analytics is an optional feature per connected Mastodon account. It starts off for a new account. Enable it after connection or in Account details. OpenPost collects follower, following, and post totals from the connected instance and favourites, replies, and reblogs for published posts and thread segments when enabled. Instance software and policy determine which counters are returned. Disabling Analytics stops future Mastodon analytics collection without deleting stored metrics or revoking authorization.

## Comments and inbox

Direct messages and Comments and replies are separate optional features per connected Mastodon account. Each starts off for a new account. Enable them after connection or in Account details.

- Comments and replies: OpenPost can list replies, send replies, favourite or unfavourite replies, and delete replies posted by the connected account when enabled. Disabling it stops future Mastodon comment collection and reply actions without deleting stored replies or revoking authorization.
- Direct messages: OpenPost can collect direct-visibility posts when enabled. Mastodon direct posts are not end-to-end encrypted; mentioned accounts and involved servers can read them. Disabling it stops future message collection without deleting stored messages or revoking authorization.

Availability for each feature depends on provider support, required scopes, and plan access as distinct facts.

## Grow

Grow is an optional feature per connected Mastodon account. It starts off for a new account. Enable it after connection or in Account details to discover candidates and follow them through OpenPost. Disabling Grow stops future discovery and follow checks without deleting stored recommendations or revoking authorization. OpenPost never follows automatically, each follow remains an explicit action and requires Grow to stay enabled.

## Notes

- The current backend config default for `MASTODON_REDIRECT_URI` is `urn:ietf:wg:oauth:2.0:oob`.
- OpenPost may show the config `name` in the UI, but the persisted provider identity is the full `instance_url`.
- The stored `instance_url` needs to stay consistent with the configured provider entry.
