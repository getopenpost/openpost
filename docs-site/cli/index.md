# OpenPost CLI

The OpenPost CLI controls a running OpenPost instance from a terminal or automation job. It talks to the same `/api/v1` HTTP API as the web app, authenticates with revocable API tokens, and never reads the server database directly.

Use it when you want to:

- Create drafts, scheduled posts, and threads from scripts
- Upload media from a terminal
- Manage workspaces, account slugs, jobs, and API tokens
- Run OpenPost from CI, cron, deploy hooks, or a personal shell workflow

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
openpost post create --accounts main-x,linkedin --content "Hello from OpenPost" --schedule next-slot
```

## Docs

- [Installation](/cli/installation)
- [Authentication](/cli/authentication)
- [Posting](/cli/posting)
- [Automation](/cli/automation)
- [Generated command reference](/reference/cli)

The command reference is generated from the Cobra command tree during docs builds, so flags and usage stay aligned with the implementation.
