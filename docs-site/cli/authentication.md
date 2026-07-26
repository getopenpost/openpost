# CLI Authentication

The CLI authenticates against a running OpenPost instance over HTTPS. It never handles your password, TOTP code, passkey, or social-provider OAuth credentials.

## Browser Device Flow

Browser login is the default:

```sh
openpost auth login http://localhost:8080
```

The CLI starts a device-flow session, opens the OpenPost approval page, and polls until the signed-in web user approves or denies the request.

When approved, the server mints an opaque API token and returns it to the CLI once. The CLI stores that token and uses it as a bearer token for future API calls.

## Headless Login

For SSH sessions or servers without a browser:

```sh
openpost auth login http://localhost:8080 --device
```

The CLI prints the verification URL and user code. Open that URL on another device, sign in, and approve the session.

## Token Login

For automation, create an API token in **Settings -> Account -> CLI Devices & API Tokens**, then pass it through stdin:

```sh
printf '%s\n' "$OPENPOST_TOKEN" | openpost auth login http://localhost:8080 --with-token
```

## Storage

By default, the CLI stores tokens in the operating system keyring through `github.com/zalando/go-keyring`.

If a keyring is unavailable, `--insecure-storage` writes credentials to an XDG-aware `credentials.json` file with `0600` permissions. That is portable and script-friendly, but anyone who can read the file can use the token.

## Token Scope

CLI tokens currently use the `cli:full` scope. It grants read and write access to workspaces, social accounts, posts, media, jobs, and API tokens for every workspace the approving user can access. Fine-grained per-workspace scopes are planned for a later release.

Use **Settings -> Account -> CLI Devices & API Tokens** to inspect token prefixes, last-used timestamps, and revoke devices or automation tokens.
