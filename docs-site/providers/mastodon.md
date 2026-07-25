# Mastodon

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

Instance admins can store encrypted Mastodon provider app rows through `POST /api/v1/admin/provider-apps`. Use this when a specific instance does not allow dynamic app registration or when you want OpenPost to use credentials you already created on that instance. The current web settings UI does not expose a Provider Apps panel, so most self-hosted operators should prefer `MASTODON_SERVERS` or `OPENPOST_PROVIDER_APPS`.

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

## Notes

- The current backend config default for `MASTODON_REDIRECT_URI` is `urn:ietf:wg:oauth:2.0:oob`.
- OpenPost may show the config `name` in the UI, but the persisted provider identity is the full `instance_url`.
- The stored `instance_url` needs to stay consistent with the configured provider entry.
