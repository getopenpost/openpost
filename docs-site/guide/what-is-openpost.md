# What Is OpenPost?

OpenPost is the publishing layer between AI agents and your social accounts. An authenticated assistant can inspect workspace context, prepare a base post, and adapt destination-specific renditions without receiving provider credentials. You can review those outputs in the web app, then schedule them through a visible queue.

You can use the managed app or run the same AGPL product on your own server. The self-hosted stack stays small: Go, SvelteKit, SQLite, local media storage, and one deployable binary or container. Redis is not required.

## Who is this for?

OpenPost is for people who need controlled publishing without adopting a large social-management suite.

- **Technical founders and developer advocates** preparing releases across several accounts
- **Open-source maintainers** adapting project updates for different communities
- **Small teams and agencies** that need separate workspaces, renditions, and visible delivery state
- **Developers using MCP clients or coding agents** who want a bounded publishing service
- **Self-hosters** who want a compact runtime and control over their deployment

## The controlled workflow

1. Give the agent a workspace-scoped, revocable `mcp:read` token.
2. Let it inspect accounts, media, drafts, schedules, and provider readiness while the server blocks mutations.
3. Grant workspace-scoped `mcp:full` access only when it needs to prepare or change drafts and destination-specific renditions.
4. Review and edit every destination in the web app.
5. Approve scheduling only after the content, accounts, media, and time are correct.
6. Inspect the queue, published URLs, failures, and lifecycle events.

OpenPost exposes only read-safe discovery and query tools to `mcp:read` tokens and rejects mutation attempts server-side. Human review is still the recommended process rather than a mandatory approval stage. An `mcp:full` token can execute mutations when the client allows them.

See [Agent-Assisted Publishing](/usage/agent-assisted-publishing) for the complete workflow.

## Managed or self-hosted

Managed publishing starts at €6/month. Registration can create one bootstrap workspace before checkout, but connecting accounts, uploading media, scheduling, publishing, and other provider writes require an active or Polar-trialing subscription. OpenPost does not provide an automatic hosted free tier or trial.

Self-hosted OpenPost has no software subscription. You operate its server, TLS, backups, upgrades, provider applications, and secrets.

## What OpenPost supports

- **Publishing integrations:** X, Mastodon, Bluesky, LinkedIn profiles and Organization Pages, Threads, Facebook Pages, Instagram Business and Creator accounts, TikTok, YouTube, and Discord webhooks
- **Communications:** cross-provider engagement, personal notifications, and a unified inbox for supported message APIs

Provider approval, app configuration, quotas, public-media access, or live-account verification can still block a specific account or format. See [Supported Platforms & Limitations](/providers/platform-limits) for the current profile-level matrix.

## What OpenPost is not

OpenPost focuses on drafting, adapting, scheduling, publishing, provider-reported analytics, engagement, notifications, and supported social conversations. It does not include enterprise social listening, ad management, or benchmarking. Media, metric, engagement, and messaging support vary by provider.

**Current limitations:**

- **Video support is provider-dependent** — some provider video paths exist in the codebase, but support is not consistent across every platform and not every path is verified end to end
- **No full feature parity guarantee** — each social network has different capabilities, and some provider-specific features may be unavailable in OpenPost
- **Analytics follow provider truth** — OpenPost stores supported counters and trends, but does not invent cross-provider equivalents or offer enterprise benchmarking
- **Enterprise approval workflows are not the current focus** — OpenPost is not positioning itself as an enterprise review-and-approval suite
- **Provider APIs can be restrictive** — each platform has its own API limits, rate limits, and approval requirements that may affect publishing

## What it deliberately avoids

- Redis or external queue requirements for simple deployments
- Postgres as a mandatory dependency
- Hosted-account lock-in
- Splitting the app into multiple services before it is necessary
