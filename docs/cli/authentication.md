# CLI Authentication

The OpenPost CLI authenticates against a running OpenPost instance over HTTPS. It never reads the server database and never handles your password, TOTP code, passkey, or social-provider OAuth credentials.

## Device Flow

`openpost auth login <instance>` starts a device-flow session with the server. The CLI receives a device code and a short user code, opens the browser to the OpenPost approval page, and polls until the signed-in web user approves or denies the request.

When approved, the server mints an opaque API token and returns it to the CLI once. The CLI then uses that token as a bearer token for future API calls.

## Login Modes

Browser login is the default:

```sh
openpost auth login https://openpost.example.com
```

Device mode prints the verification URL and code without opening a browser, which is useful on SSH hosts:

```sh
openpost auth login https://openpost.example.com --device
```

Token mode reads an existing API token from stdin, which is useful for CI and other headless environments:

```sh
printf '%s\n' "$OPENPOST_TOKEN" | openpost auth login https://openpost.example.com --with-token
```

## Token Storage

By default, the CLI stores tokens in the operating system keyring through `github.com/zalando/go-keyring`. This keeps the token outside the plain-text config file.

Use `--insecure-storage` only when a keyring is unavailable. That fallback writes credentials to an XDG-aware `credentials.json` file with `0600` permissions. It is portable and script-friendly, but anyone who can read that file can use the token.

## Scope

CLI tokens currently use the `cli:full` scope. It grants read and write access to workspaces, social accounts, posts, media, and jobs for every workspace the approving user can access. Fine-grained per-workspace scopes are planned for a later release.

## Managing Tokens

OpenPost exposes CLI/device tokens in **Settings -> CLI Devices & API Tokens**. Use that screen to create a token for automation, inspect token prefixes and last-used timestamps, or revoke a device/token that should no longer have access.

For an exhaustive command and flag listing, see the generated [CLI reference](../../docs-site/reference/cli.md). The reference is built from the Cobra command tree during docs builds.
