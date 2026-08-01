# What Is OpenPost?

OpenPost helps people and teams create, tailor, preview, schedule, and publish social posts. Start with one shared draft, then change the text, media, format, and settings for each connected account.

Use the managed app or run the same AGPL product on your own server. The default self-hosted setup uses one Go binary or container, SQLite, and local media storage. You do not need Redis.

## Who is this for?

OpenPost is for people who want social publishing without a large marketing suite.

- **Creators and small brands** that publish to several accounts
- **Teams and agencies** that need separate workspaces for brands or clients
- **Open-source teams** that share updates with different communities
- **Developers** that use the API, CLI, or MCP
- **Self-hosters** that want control over the server and stored data

## How it works

1. Choose Post, Thread, Story, Short video, or Video.
2. Write the shared text and add media.
3. Select the social accounts.
4. Tailor and preview the version for each account.
5. Publish now or choose a time.
6. Check the result, errors, and retry options in the app.

OpenPost also has a media library, a still-image editor called Studio, posting schedules, analytics, comments and replies, personal alerts, and inboxes for supported accounts.

If an AI tool helps, give it an OpenPost token instead of your social account keys. `mcp:read` is read-only. `mcp:full` can create, change, schedule, publish, reply, or moderate. Review the result before you allow a change. See [Agent-Assisted Publishing](/usage/agent-assisted-publishing).

## Managed or self-hosted

Managed plans start at €6 per month. You can create an account and one workspace before checkout, but you need an active plan to connect social accounts, upload media, schedule, or publish. There is no hosted free plan or automatic trial.

Self-hosted OpenPost has no software fee. You manage the server, TLS, backups, updates, social apps, and secrets.

## What OpenPost supports

- **Publishing:** X, Mastodon, Bluesky, LinkedIn profiles and Organization Pages, Threads, Facebook Pages, Instagram Business and Creator accounts, TikTok, YouTube, and Discord webhooks
- **Content types:** posts, threads, Stories, short videos, and videos, based on each platform
- **Results:** account and post analytics when the platform grants access
- **Replies:** comments, replies, and moderation for supported platforms
- **Inbox:** opt-in message collection for X, Bluesky, Facebook Pages, Instagram, and Mastodon
- **Workspaces:** separate accounts, media, schedules, members, and tool access
- **Tools:** web app, HTTP API, CLI, and MCP

App review, account access, API limits, public media links, or a failed live test can still block an account or format. See [Supported Platforms & Limitations](/providers/platform-limits).

## What OpenPost is not

OpenPost does not include social listening, ad management, a CRM, or large-company benchmarks. Each social network gives different access to media, analytics, comments, and messages.

**Current limitations:**

- **Video differs by platform.** Formats, lengths, file sizes, and app review rules vary.
- **Features differ by platform.** OpenPost only shows actions that the connected account can use.
- **Analytics keep each metric distinct.** Views, impressions, and reach do not mean the same thing.
- **There is no separate server approval step for every tool action.** A person should review AI-made work before allowing it.
- **Social networks can change their APIs.** Their limits and review rules can affect publishing.

## What it does not require

- Redis for scheduled jobs
- PostgreSQL for a small self-hosted setup
- The managed app when you prefer to self-host
- Several app services for the default install
