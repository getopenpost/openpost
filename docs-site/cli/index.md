# OpenPost CLI

The OpenPost CLI controls a running OpenPost instance from a terminal or automation job. It talks to the same `/api/v1` HTTP API as the web app, authenticates with revocable API tokens, and never reads the server database directly.

The CLI never bypasses server authorization, validation, quota, or audit checks.

This page is for people using OpenPost from a terminal, script, CI job, or scheduled task.

Use it when you want to:

- Create drafts, scheduled posts, and threads from scripts
- Check account setup and supported post types
- Upload, inspect, update, and clean up media from a terminal
- Set a weekly posting schedule
- Manage workspaces, account names, jobs, and API tokens
- Use OpenPost from CI, cron, deploy scripts, or your terminal

## Typical setup

```sh
openpost instance add local http://localhost:8080
openpost instance use local
openpost instance health
openpost auth login http://localhost:8080
openpost workspace use personal
```

Then inspect accounts and pass explicit selectors to posting commands:

```sh
openpost account list
openpost provider readiness
openpost post create --accounts main-x,linkedin --content "Hello from OpenPost" --schedule next-slot
```

## Docs

- [Installation](/cli/installation)
- [Authentication](/cli/authentication)
- [Posting](/cli/posting)
- [Automation](/cli/automation)
- [Generated command reference](/reference/cli)

OpenPost builds the command reference from the CLI code, so its commands and flags stay up to date.
