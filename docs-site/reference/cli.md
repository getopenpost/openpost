# CLI Reference

This page is generated from the Cobra command tree. Do not edit it by hand.

Regenerate with:

```sh
cd cli && go run ./cmd/openpost-docs ../docs-site/reference/cli.md
```

## `openpost`

OpenPost CLI — control an OpenPost workspace from the terminal

openpost is a command-line client for the OpenPost social media scheduler.  It talks to a running OpenPost instance over HTTPS, authenticates with a revocable API token, and exposes the most common posting, scheduling, account, and media workflows for use from scripts, CI, and power-user shells.

**Usage**

```text
openpost [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `-h, --help` | `false` | help for openpost |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `-v, --version` | `false` | version for openpost |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost account` | Manage connected social accounts |
| `openpost auth` | Authenticate with an OpenPost instance |
| `openpost billing` | Manage billing for the managed app |
| `openpost completion` | Generate shell completion script |
| `openpost instance` | Manage OpenPost instance profiles |
| `openpost jobs` | List background jobs |
| `openpost media` | Upload and list media attachments |
| `openpost post` | Create, list, view, update, and delete posts |
| `openpost provider` | Inspect provider availability and publishing support |
| `openpost publication` | Create, list, validate, and publish publications |
| `openpost schedule` | Manage reusable posting schedule slots |
| `openpost thread` | Create multi-post threads |
| `openpost version` | Print the openpost CLI version |
| `openpost workspace` | Manage the active OpenPost workspace |

### `openpost account`

Manage connected social accounts

List, rename, and disconnect social accounts. Account slugs are the preferred selector for --accounts. New accounts are connected in the OpenPost web UI at &lt;instance&gt;/accounts.

**Usage**

```text
openpost account
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost account disconnect` | Disconnect a social account |
| `openpost account list` | List connected social accounts |
| `openpost account rename` | Rename a social account slug |

### `openpost account disconnect`

Disconnect a social account

**Usage**

```text
openpost account disconnect &lt;account-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost account list`

List connected social accounts

List connected social accounts for the active workspace.  Use the SLUG column as the preferred selector for --accounts and account rename.

**Usage**

```text
openpost account list [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--platform` | `-` | filter by platform |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost account rename`

Rename a social account slug

Rename a connected account's slug. The selector can be an account id, slug, platform:username value, bare platform when unambiguous, or mastodon host.

**Usage**

```text
openpost account rename &lt;selector&gt; --slug &lt;new-slug&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--slug` | `-` | new account slug |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost auth`

Authenticate with an OpenPost instance

**Usage**

```text
openpost auth
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost auth login` | Log in to an OpenPost instance |
| `openpost auth logout` | Delete the stored token for the active profile |
| `openpost auth status` | Show authentication status for the active profile |
| `openpost auth token` | Manage API tokens |

### `openpost auth login`

Log in to an OpenPost instance

**Usage**

```text
openpost auth login &lt;instance&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--device` | `false` | print the device code and poll without opening a browser |
| `--insecure-storage` | `false` | store the token in credentials.json instead of the OS keyring |
| `--no-browser` | `false` | skip automatically opening the browser |
| `--with-token` | `false` | read a raw API token from stdin |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost auth logout`

Delete the stored token for the active profile

**Usage**

```text
openpost auth logout
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost auth status`

Show authentication status for the active profile

**Usage**

```text
openpost auth status
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost auth token`

Manage API tokens

**Usage**

```text
openpost auth token
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost auth token list` | List API tokens |
| `openpost auth token revoke` | Revoke an API token |

### `openpost auth token list`

List API tokens

**Usage**

```text
openpost auth token list
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost auth token revoke`

Revoke an API token

**Usage**

```text
openpost auth token revoke &lt;id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost billing`

Manage billing for the managed app

Inspect billing status and create hosted checkout or customer portal URLs for the active workspace.

**Usage**

```text
openpost billing
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost billing checkout` | Create an OpenPost checkout URL for the active workspace |
| `openpost billing portal` | Open Whop billing management for the active workspace |
| `openpost billing status` | Show billing plan and usage for the active workspace |

### `openpost billing checkout`

Create an OpenPost checkout URL for the active workspace

Create an OpenPost checkout URL with an embedded Whop payment form. Plan IDs are starter, creator, pro, team, or agency.

**Usage**

```text
openpost billing checkout &lt;plan&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--billing-period` | `monthly` | Billing period: monthly or annual |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost billing portal`

Open Whop billing management for the active workspace

**Usage**

```text
openpost billing portal
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost billing status`

Show billing plan and usage for the active workspace

**Usage**

```text
openpost billing status
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost completion`

Generate shell completion script

Output a shell completion script for the given shell.  To load completions:  Bash:   $ source &lt;(openpost completion bash)    # To load completions for each session, execute once:   # Linux:   $ openpost completion bash &gt; /etc/bash_completion.d/openpost   # macOS:   $ openpost completion bash &gt; $(brew --prefix)/etc/bash_completion.d/openpost  Zsh:   # If shell completion is not already enabled in your environment,   # you will need to enable it. You can execute the following once:   $ echo "autoload -U compinit; compinit" &gt;&gt; ~/.zshrc    # To load completions for each session, execute once:   $ openpost completion zsh &gt; "${fpath[1]}/_openpost"    # You will need to start a new shell for this setup to take effect.  Fish:   $ openpost completion fish \| source    # To load completions for each session, execute once:   $ openpost completion fish &gt; ~/.config/fish/completions/openpost.fish  PowerShell:   PS&gt; openpost completion powershell \| Out-String \| Invoke-Expression    # To load completions for every new session, run:   PS&gt; openpost completion powershell &gt; openpost.ps1   # and source this file from your PowerShell profile.

**Usage**

```text
openpost completion &lt;bash\|zsh\|fish\|powershell&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost instance`

Manage OpenPost instance profiles

**Usage**

```text
openpost instance
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost instance add` | Add or update an instance profile |
| `openpost instance diagnostics` | Collect a safe support snapshot for an OpenPost instance |
| `openpost instance health` | Check the active instance liveness and readiness |
| `openpost instance list` | List configured instances |
| `openpost instance remove` | Remove an instance profile |
| `openpost instance use` | Set the active instance profile |

### `openpost instance add`

Add or update an instance profile

**Usage**

```text
openpost instance add &lt;name&gt; &lt;url&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost instance diagnostics`

Collect a safe support snapshot for an OpenPost instance

**Usage**

```text
openpost instance diagnostics [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--deployment` | `-` | deployment method being checked (docker, binary, nixos, cloud, other) |
| `--logs-file` | `-` | local OpenPost log file to include as a redacted last-100-line tail |
| `--provider` | `-` | social provider being tested, such as x, mastodon, youtube, or tiktok |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost instance health`

Check the active instance liveness and readiness

**Usage**

```text
openpost instance health
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost instance list`

List configured instances

**Usage**

```text
openpost instance list
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost instance remove`

Remove an instance profile

**Usage**

```text
openpost instance remove &lt;name&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost instance use`

Set the active instance profile

**Usage**

```text
openpost instance use &lt;name&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost jobs`

List background jobs

**Usage**

```text
openpost jobs
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost jobs list` | List background jobs |

### `openpost jobs list`

List background jobs

**Usage**

```text
openpost jobs list [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--limit` | `0` | maximum number of jobs to return |
| `--offset` | `0` | number of jobs to skip |
| `--status` | `-` | filter by status: pending, failed, completed |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost media`

Upload and list media attachments

**Usage**

```text
openpost media
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost media delete` | Delete an unused media attachment |
| `openpost media list` | List media attachments |
| `openpost media storage` | Show media storage usage |
| `openpost media update` | Update media alt text |
| `openpost media upload` | Upload a media file |
| `openpost media usage` | List content that uses a media attachment |

### `openpost media delete`

Delete an unused media attachment

**Usage**

```text
openpost media delete &lt;media-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost media list`

List media attachments

**Usage**

```text
openpost media list [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--limit` | `0` | maximum number of media items to return |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost media storage`

Show media storage usage

**Usage**

```text
openpost media storage
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost media update`

Update media alt text

**Usage**

```text
openpost media update &lt;media-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--alt` | `-` | alt text; pass an empty value to clear it |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost media upload`

Upload a media file

**Usage**

```text
openpost media upload &lt;file&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--alt` | `-` | alt text for the uploaded media |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost media usage`

List content that uses a media attachment

**Usage**

```text
openpost media usage &lt;media-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost post`

Create, list, view, update, and delete posts

**Usage**

```text
openpost post
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost post create` | Create a draft or scheduled post |
| `openpost post delete` | Delete a draft or scheduled post |
| `openpost post list` | List posts |
| `openpost post update` | Update a draft or scheduled post |
| `openpost post view` | View a post |

### `openpost post create`

Create a draft or scheduled post

**Usage**

```text
openpost post create [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--accounts` | `-` | comma-separated account selectors |
| `--content` | `-` | post content |
| `--file` | `-` | read post content from a file |
| `--media` | `[]` | media id or local file path; repeatable |
| `--media-alt` | `[]` | alt text for the matching uploaded --media |
| `--random-delay` | `0` | random delay in minutes |
| `--schedule` | `-` | natural-language, RFC3339, next-slot, now, or draft |
| `--thread-draft` | `-` | encoded thread draft to attach |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost post delete`

Delete a draft or scheduled post

**Usage**

```text
openpost post delete &lt;post-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost post list`

List posts

**Usage**

```text
openpost post list [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--limit` | `0` | maximum number of posts to return |
| `--offset` | `0` | number of posts to skip |
| `--status` | `-` | filter by status: draft, scheduled, published, failed |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost post update`

Update a draft or scheduled post

**Usage**

```text
openpost post update &lt;post-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--accounts` | `-` | comma-separated account selectors |
| `--content` | `-` | post content |
| `--media` | `[]` | replacement media id or local file path; repeatable; pass an empty value to clear |
| `--media-alt` | `[]` | alt text for the matching uploaded --media |
| `--random-delay` | `0` | random delay in minutes |
| `--schedule` | `-` | natural-language, RFC3339, next-slot, now, or draft; empty string unschedules |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost post view`

View a post

**Usage**

```text
openpost post view &lt;post-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost provider`

Inspect provider availability and publishing support

**Usage**

```text
openpost provider
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost provider capabilities` | List provider publishing capabilities |
| `openpost provider list` | List social providers available on the instance |
| `openpost provider readiness` | Inspect provider setup and blocking issues |

### `openpost provider capabilities`

List provider publishing capabilities

**Usage**

```text
openpost provider capabilities [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--content-profile` | `-` | filter by input or output content profile |
| `--provider` | `-` | filter by provider key |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost provider list`

List social providers available on the instance

**Usage**

```text
openpost provider list
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost provider readiness`

Inspect provider setup and blocking issues

**Usage**

```text
openpost provider readiness
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication`

Create, list, validate, and publish publications

**Usage**

```text
openpost publication
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost publication comments` | List comments for a published rendition |
| `openpost publication create` | Create a format-first publication |
| `openpost publication delete` | Permanently delete an editable publication |
| `openpost publication delete-comment` | Delete a provider comment |
| `openpost publication delete-rendition` | Permanently delete one saved publication destination |
| `openpost publication events` | List publication lifecycle events |
| `openpost publication hide-comment` | Hide a provider comment |
| `openpost publication list` | List publications |
| `openpost publication publish-now` | Queue a publication for immediate publishing |
| `openpost publication renditions` | Replace destination-specific renditions from JSON |
| `openpost publication reply` | Queue an explicit reply to a published rendition |
| `openpost publication reply-comment` | Reply to a provider comment |
| `openpost publication retry` | Retry one failed publication destination |
| `openpost publication schedule` | Schedule an existing publication |
| `openpost publication update` | Update an editable publication |
| `openpost publication validate` | Validate a publication |
| `openpost publication view` | View a publication |

### `openpost publication comments`

List comments for a published rendition

**Usage**

```text
openpost publication comments &lt;rendition-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication create`

Create a format-first publication

**Usage**

```text
openpost publication create [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--accounts` | `-` | comma-separated account IDs/slugs/platforms |
| `--caption` | `-` | caption for image, carousel, story, or social video outputs |
| `--content` | `-` | post text or fallback source text |
| `--content-profile` | `short_text` | content profile: short_text, thread, link_share, image_post, carousel, story, short_video, long_video |
| `--description` | `-` | description field for link/video outputs |
| `--file` | `-` | read post/source text from file or '-' for stdin |
| `--media` | `[]` | media ID or local file path to attach; repeatable |
| `--media-alt` | `[]` | alt text for uploaded media |
| `--privacy` | `-` | YouTube privacy status: private, unlisted, or public |
| `--schedule` | `-` | schedule time |
| `--tiktok-method` | `DIRECT_POST` | TikTok content posting method |
| `--tiktok-privacy` | `SELF_ONLY` | TikTok privacy level |
| `--title` | `-` | publication title |
| `--url` | `-` | source URL for link shares |
| `--video-description` | `-` | YouTube video description |
| `--video-title` | `-` | YouTube video title |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication delete`

Permanently delete an editable publication

**Usage**

```text
openpost publication delete &lt;publication-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--confirm` | `false` | confirm permanent publication deletion |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication delete-comment`

Delete a provider comment

**Usage**

```text
openpost publication delete-comment &lt;comment-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--confirm` | `false` | confirm permanent provider deletion |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication delete-rendition`

Permanently delete one saved publication destination

**Usage**

```text
openpost publication delete-rendition &lt;publication-id&gt; &lt;account-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--confirm` | `false` | confirm permanent destination deletion |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication events`

List publication lifecycle events

**Usage**

```text
openpost publication events &lt;publication-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--limit` | `0` | maximum number of events to return |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication hide-comment`

Hide a provider comment

**Usage**

```text
openpost publication hide-comment &lt;comment-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication list`

List publications

**Usage**

```text
openpost publication list [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--content-profile` | `-` | filter by content profile |
| `--limit` | `0` | maximum number of publications to return |
| `--offset` | `0` | number of publications to skip |
| `--status` | `-` | filter by status |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication publish-now`

Queue a publication for immediate publishing

**Usage**

```text
openpost publication publish-now &lt;publication-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication renditions`

Replace destination-specific renditions from JSON

**Usage**

```text
openpost publication renditions &lt;publication-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--file` | `-` | JSON array of renditions, or '-' for stdin |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication reply`

Queue an explicit reply to a published rendition

**Usage**

```text
openpost publication reply &lt;rendition-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--at` | `-` | optional reply schedule time |
| `--body` | `-` | reply text |
| `--file` | `-` | read reply text from file or '-' for stdin |
| `--parent-id` | `-` | external provider post or comment ID |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication reply-comment`

Reply to a provider comment

**Usage**

```text
openpost publication reply-comment &lt;comment-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--body` | `-` | reply text |
| `--file` | `-` | read reply text from file or '-' for stdin |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication retry`

Retry one failed publication destination

**Usage**

```text
openpost publication retry &lt;publication-id&gt; &lt;account-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication schedule`

Schedule an existing publication

**Usage**

```text
openpost publication schedule &lt;publication-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--at` | `-` | schedule time, natural language, or next-slot |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication update`

Update an editable publication

**Usage**

```text
openpost publication update &lt;publication-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--content` | `-` | shared post or caption text |
| `--content-profile` | `-` | content profile |
| `--file` | `-` | read shared text from file or '-' for stdin |
| `--force` | `false` | overwrite after reviewing a revision conflict |
| `--schedule` | `-` | new schedule time; use draft to clear |
| `--title` | `-` | publication title |
| `--url` | `-` | source URL; pass an empty value to clear |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication validate`

Validate a publication

**Usage**

```text
openpost publication validate &lt;publication-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost publication view`

View a publication

**Usage**

```text
openpost publication view &lt;publication-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost schedule`

Manage reusable posting schedule slots

Manage the workspace-local weekly slots used by next-slot scheduling.

**Usage**

```text
openpost schedule
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost schedule create` | Create a weekly posting schedule slot |
| `openpost schedule delete` | Delete a posting schedule slot |
| `openpost schedule list` | List posting schedule slots |
| `openpost schedule next` | Find the next available posting slot |
| `openpost schedule suggest` | Create a suggested seven-day posting schedule |
| `openpost schedule update` | Update a posting schedule slot |

### `openpost schedule create`

Create a weekly posting schedule slot

**Usage**

```text
openpost schedule create [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--day` | `0` | workspace-local day of week (0=Sunday, 6=Saturday) |
| `--hour` | `0` | workspace-local hour (0-23) |
| `--label` | `-` | display label |
| `--minute` | `0` | workspace-local minute (0-59) |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost schedule delete`

Delete a posting schedule slot

**Usage**

```text
openpost schedule delete &lt;schedule-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost schedule list`

List posting schedule slots

**Usage**

```text
openpost schedule list
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost schedule next`

Find the next available posting slot

**Usage**

```text
openpost schedule next
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost schedule suggest`

Create a suggested seven-day posting schedule

Create active workspace-local schedule slots for every day of the week.

**Usage**

```text
openpost schedule suggest [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--posts-per-day` | `3` | number of slots to create per day (1-10) |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost schedule update`

Update a posting schedule slot

**Usage**

```text
openpost schedule update &lt;schedule-id&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--active` | `false` | enable the slot |
| `--day` | `0` | workspace-local day of week (0=Sunday, 6=Saturday) |
| `--hour` | `0` | workspace-local hour (0-23) |
| `--inactive` | `false` | disable the slot |
| `--label` | `-` | display label; pass an empty value to clear it |
| `--minute` | `0` | workspace-local minute (0-59) |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost thread`

Create multi-post threads

**Usage**

```text
openpost thread
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost thread create` | Create a thread from a markdown file |

### `openpost thread create`

Create a thread from a markdown file

**Usage**

```text
openpost thread create &lt;file&gt; [flags]
```

**Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--accounts` | `-` | comma-separated account selectors |
| `--random-delay` | `0` | random delay in minutes |
| `--schedule` | `-` | natural-language, RFC3339, next-slot, now, or draft |

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost version`

Print the openpost CLI version

**Usage**

```text
openpost version
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost workspace`

Manage the active OpenPost workspace

**Usage**

```text
openpost workspace
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

**Subcommands**

| Command | Description |
| --- | --- |
| `openpost workspace create` | Create a workspace |
| `openpost workspace list` | List workspaces |
| `openpost workspace use` | Set the active workspace for the current profile |

### `openpost workspace create`

Create a workspace

**Usage**

```text
openpost workspace create &lt;name&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost workspace list`

List workspaces

**Usage**

```text
openpost workspace list
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

### `openpost workspace use`

Set the active workspace for the current profile

**Usage**

```text
openpost workspace use &lt;name-or-id&gt;
```

**Inherited Flags**

| Flag | Default | Description |
| --- | --- | --- |
| `--instance` | `-` | OpenPost instance URL (default: profile or $OPENPOST_INSTANCE) |
| `--json` | `false` | emit machine-readable JSON instead of tables/prose |
| `--no-color` | `false` | disable ANSI colors |
| `--profile` | `-` | profile name from config (default: $OPENPOST_PROFILE or 'default') |
| `--quiet` | `false` | suppress non-error output |
| `--token` | `-` | API token override (default: keyring or $OPENPOST_TOKEN) |
| `--workspace` | `-` | workspace name or ID (default: profile or $OPENPOST_WORKSPACE) |
| `--yes` | `false` | skip interactive confirmations |

