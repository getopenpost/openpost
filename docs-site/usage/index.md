# User Docs

Use these docs when you want to operate OpenPost as a product: connect accounts, draft posts, customize renditions, schedule publishing, automate from the CLI, or let an assistant help through MCP.

For a visual introduction, [watch the OpenPost product demo](https://youtu.be/_mZf3HzQaN8).

## Web app

The web app is the main editorial surface.

- [Workspaces](/usage/workspaces) keep brands, accounts, prompts, schedules, and media separate.
- [Settings](/usage/settings) explains the Workspace, Account, and Organization split.
- [Accounts](/usage/accounts) explains how connected provider identities appear in a workspace.
- [Agent-Assisted Publishing](/usage/agent-assisted-publishing) shows how an MCP client can prepare destination renditions while a person reviews and approves the campaign.
- [Composing Posts](/usage/composing-posts) covers destination selection, media, variants, and the composer.
- [Threads](/usage/threads) covers multi-post sequences.
- [Scheduling](/usage/scheduling) covers queued publishing and failure visibility.
- [Media](/usage/media-library) covers reusable assets, designs, templates, brand resources, collections, provenance, usage checks, and safe cleanup.
- [OpenPost Studio](/usage/studio) covers multi-page design editing, recovery versions, background removal, export, and composer return.

## CLI

The CLI is for terminal, CI, cron, and scripted workflows against a running OpenPost instance.

- [CLI Overview](/cli/) explains the command model.
- [Installation](/cli/installation) covers release binaries and source builds.
- [Authentication](/cli/authentication) covers browser login, device flow, and API-token login.
- [Posting](/cli/posting) covers posts, threads, media, rich publications, and `next-slot`.
- [Automation](/cli/automation) covers CI and recurring jobs.
- [Command Reference](/reference/cli) is generated from the Cobra command tree.

## MCP

MCP is for authenticated assistant workflows. Use it when a client such as ChatGPT, Claude, Cursor, Codex, or another agent should inspect context, create drafts, adapt renditions, or schedule posts with OpenPost permissions.

- [Agent-Assisted Publishing With MCP](/mcp/) covers the user-facing MCP workflow and token scopes.
- [MCP and ChatGPT App Developer Notes](/development/mcp) cover implementation details for contributors.

## Where not to look

- Deployment, backups, provider credentials, and operational settings live in [Self-Hosting](/self-hosting/).
- Repository architecture, backend/frontend internals, API generation, and tests live in [Developer Docs](/development/).
