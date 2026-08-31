# Sign In From the CLI

This page is for people signing the OpenPost CLI in from a browser, remote server, or automation job.

The CLI signs in to a running OpenPost server over HTTPS. It never sees your password, TOTP code, passkey, or social account keys.

## Sign in with a browser

Browser login is the default:

```sh
openpost auth login http://localhost:8080
```

The CLI opens an OpenPost approval page and waits for you to approve or deny access. Only a signed-in browser session can make that decision; an API or CLI token cannot approve another device credential. Before approval, choose whether workspace-owned actions apply to one workspace or every workspace the token is permitted to access. A bound token can use workspace-owned resources only in the selected workspace and only while your account remains a member there.

After approval, the server creates an API token and returns it once. The CLI saves it for later commands. All-workspace access can also apply to workspaces you join later when their organization policy permits it, so use it only for account-wide automation.

## Sign in on a server

For SSH sessions or servers without a browser:

```sh
openpost auth login http://localhost:8080 --device
```

The CLI prints the verification URL and user code. Open that URL on another device, sign in, and approve the session.

## Sign in with a token

For automation, create an API token in **Settings → Personal → Developer access**, then pass it through stdin:

```sh
printf '%s\n' "$OPENPOST_TOKEN" | openpost auth login http://localhost:8080 --with-token
```

## Where the CLI saves tokens

By default, the CLI stores tokens in the operating system keyring through `github.com/zalando/go-keyring`.

If no keyring is available, `--insecure-storage` writes the token to an XDG `credentials.json` file with `0600` permissions. Anyone who can read that file can use the token.

## Token access

CLI tokens use `cli:full`. They can read and change workspaces, social accounts, posts, media, jobs, and API tokens. A workspace selection limits workspace-owned resources and blocks organization-level resources, but it does not remove the account-level commands included in `cli:full`. An all-workspace token retains the account- and organization-level commands allowed by `cli:full`, while organization SSO and token policies can exclude protected workspaces. If its owner is an instance administrator, it also retains the explicitly typed provider-certification test operations; the general instance control plane still requires a signed-in browser session. For narrower automation, use an `api:read` or `api:write` token instead.

Use **Settings → Personal → Developer access** to see each token's status, expiration, last use, scope, and workspace boundary. Remove tokens you no longer use. See [API Tokens](/development/api-tokens) for the complete scope and lifetime contract.
