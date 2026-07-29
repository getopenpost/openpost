# Sign In From the CLI

The CLI signs in to a running OpenPost server over HTTPS. It never sees your password, TOTP code, passkey, or social account keys.

## Sign in with a browser

Browser login is the default:

```sh
openpost auth login http://localhost:8080
```

The CLI opens an OpenPost approval page and waits for you to approve or deny access.

After approval, the server creates an API token and returns it once. The CLI saves it for later commands.

## Sign in on a server

For SSH sessions or servers without a browser:

```sh
openpost auth login http://localhost:8080 --device
```

The CLI prints the verification URL and user code. Open that URL on another device, sign in, and approve the session.

## Sign in with a token

For automation, create an API token in **Settings -> Account -> CLI Devices & API Tokens**, then pass it through stdin:

```sh
printf '%s\n' "$OPENPOST_TOKEN" | openpost auth login http://localhost:8080 --with-token
```

## Where the CLI saves tokens

By default, the CLI stores tokens in the operating system keyring through `github.com/zalando/go-keyring`.

If no keyring is available, `--insecure-storage` writes the token to an XDG `credentials.json` file with `0600` permissions. Anyone who can read that file can use the token.

## Token access

CLI tokens use `cli:full`. They can read and change workspaces, social accounts, posts, media, jobs, and API tokens. On the approval page or token form, limit the token to one workspace when it does not need access to all of them.

Use **Settings -> Account -> CLI Devices & API Tokens** to see each token, when it was last used, and which workspace it can access. Remove tokens you no longer use.
