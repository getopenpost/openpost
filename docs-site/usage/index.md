---
description: Learn how to connect accounts, create account versions, schedule publications, track results, and manage replies and messages.
---

# User Docs

Use these docs to connect accounts, write account versions, schedule posts, track results, work with replies and messages, use the CLI, or let an AI tool help through MCP.

Provider data, formats, and actions remain limited by the connected account and provider.

For a visual introduction, [watch the OpenPost product demo](https://youtu.be/_mZf3HzQaN8).

## Web app

The web app is the main place to work.

- [Workspaces](/usage/workspaces) keep brands, accounts, prompts, schedules, and media separate.
- [Settings](/usage/settings) explains the Workspace, Account, and Organization split.
- [Account Security](/usage/account-security) covers authenticator setup, one-time recovery codes, passkeys, and secure replacement or removal.
- [Accounts](/usage/accounts) explains how connected social accounts appear in a workspace.
- [Agent-Assisted Publishing](/usage/agent-assisted-publishing) shows how an MCP tool can prepare account versions while a person reviews the work.
- [Composing Posts](/usage/composing-posts) covers account selection, media, account versions, and the editor.
- [Threads](/usage/threads) covers multi-post sequences.
- [Scheduling](/usage/scheduling) covers posting times, status, and errors.
- [Auto Reposts](/usage/auto-reposts) covers native repost rules, engagement gates, delays, per-post overrides, and cross-workspace account access.
- [Analytics](/usage/analytics) covers account growth, post results, platform access, and update times. Analytics is an optional feature per connected account and starts off.
- [Engagement, Inbox, and Notifications](/usage/communications) covers comments, replies, messages, and alerts. Direct messages and Comments and replies are separate optional features per connected account and start off.
- [Grow](/usage/grow) covers recommendations for Bluesky and Mastodon. Grow is an optional feature per connected account, starts off, and never follows automatically.
- [Media](/usage/media-library) covers reusable files, designs, templates, brand items, tags, file sources, use checks, and safe cleanup.
- [OpenPost Image Editor](/usage/image-editor) covers the no-account editor, multi-page still-image designs, saved versions, background removal, export, and return to the post editor.
- [OpenPost Video Editor](/usage/video-editor) covers disk-backed projects, multitrack editing, motion, color, audio, captions, local models, export, and Media handoff.
- [Quick Cut](/usage/quick-cut) covers verified keyframe cuts, exact cuts, stream selection, merged output, and lossless packet-copy export.
- [Recorder](/usage/recording) covers separate synchronized screen, camera, and microphone capture, recovery, and timeline insertion.

## CLI

Use the CLI from a terminal, CI, cron, or a script that connects to a running OpenPost server.

- [CLI Overview](/cli/) explains the command model.
- [Installation](/cli/installation) covers release binaries and source builds.
- [Authentication](/cli/authentication) covers browser login, device flow, and API-token login.
- [Posting](/cli/posting) covers posts, threads, media, rich publications, and `next-slot`.
- [Automation](/cli/automation) covers CI and recurring jobs.
- [Command Reference](/reference/cli) is generated from the Cobra command tree.

## MCP

MCP lets an AI tool use the access you grant. Use it when ChatGPT, Claude, Cursor, Codex, or another tool should read workspace data, create drafts, tailor account versions, or schedule posts.

- [Use OpenPost With an AI Assistant](/mcp/) explains MCP access and safe use.
- [MCP and ChatGPT App Developer Notes](/development/mcp) cover implementation details for contributors.

## Where not to look

- Server setup, backups, social app keys, and server settings live in [Self-Hosting](/self-hosting/).
- Code structure, backend and frontend details, API generation, and tests live in [Developer Docs](/development/).
