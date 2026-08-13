# Illustrative OpenPost Launch Brief

> **Sample brief — not a record of an actual launch.** Replace every bracketed field and verify every provider claim before use.

## Campaign

- **Working name:** OpenPost launched OpenPost
- **Primary action:** `[WATCH THE NEW DEMO / USE THE MANAGED APP / SELF-HOST]`
- **Audience:** solo founders who need to turn what they are building into consistent content without hiring a content team
- **Core problem:** AI can prepare content quickly, but provider credentials, account-specific formatting, mutation approval, and publishing outcomes need an inspectable boundary

## Position

OpenPost is the all-in-one content team for solo founders.

The founder brings a launch, product update, lesson, or idea. OpenPost keeps the source, destination-specific versions, reusable media, calendar, and publishing outcomes together so that work becomes a repeatable content system instead of another isolated post.

An authorized agent can inspect workspace context and prepare destination-specific work through MCP without receiving provider credentials. A person reviews the campaign in OpenPost before allowing a state-changing operation. The durable queue keeps scheduled work, published outcomes, failures, and retries visible.

Use the managed app or self-host the same AGPL product as one binary or container. SQLite and local media are the defaults, and Redis is not required.

## Suggested hook

Use this only after the verification log proves the exact count and paths:

> An AI agent prepared this launch for `[VERIFIED DESTINATION COUNT]` networks without receiving a provider credential. I reviewed every destination in OpenPost, then scheduled the campaign from one visible queue.

If any destination remains unverified, use a claim that does not imply publication:

> I used an AI agent to prepare account-specific launch drafts in OpenPost. I reviewed each destination before deciding what to schedule.

## Facts the campaign may use

- MCP exposes separate read-only and state-changing operation paths.
- A workspace-scoped `mcp:read` token can inspect permitted OpenPost data and is server-blocked from mutations.
- A workspace-scoped `mcp:full` token is required to create or update drafts and renditions, schedule, publish, upload media, or perform other mutations.
- OpenPost does not return decrypted provider access or refresh tokens through MCP.
- MCP tokens are revocable, can be limited to one workspace, and have recent activity visible in Settings.
- Base content and account-specific renditions remain editable in the web app.
- Publishing uses a durable database-backed queue with visible lifecycle and failure state.
- Managed and self-hosted editions are the same AGPL product.
- Self-hosting uses one Go binary or container, SQLite and local media by default, and no required Redis service.
- Managed publishing starts at $15/month and includes a card-required 14-day trial.
- A hosted registration creates one workspace before checkout, but connecting accounts, uploading media, scheduling, publishing, and other provider writes need an active or trialing Paddle subscription.

## Claims the campaign must not use without evidence

- Do not say an agent had no publishing access when it used an `mcp:full` token that could execute a publishing operation.
- Do not say human approval is enforced by a server-side workflow. Review is a recommended process and client approval boundary.
- Do not say a provider is production-ready because an adapter exists, credentials are configured, or OAuth starts.
- Do not say a scheduled post published. Record the provider result or failure after the queue runs.
- Do not call sample renditions real campaign output.
- Do not invent users, testimonials, time savings, published URLs, reach, revenue, or conversion results.
- Do not present every implemented provider as equally ready. Keep preview and unverified paths out of the main demo.

## Deliverables

- one 45–75 second continuous product demo;
- one canonical launch post;
- one reviewed rendition for each live-verified destination;
- one per-provider rehearsal log;
- one screenshot or short clip of the web review step;
- one screenshot or short clip of the visible queue and final outcomes;
- one results note with real URLs, failures, and lessons after the campaign runs.

## Demo sequence

1. Open on the outcome. State how many exact destinations passed rehearsal and that the agent did not receive provider credentials.
2. Give the agent this brief.
3. Show read-only inspection of the workspace, accounts, media, schedule, and provider readiness.
4. Show the base post and genuinely different destination renditions.
5. Open the campaign in the OpenPost web app.
6. Review and edit account, copy, media, alt text, format, and schedule.
7. Show the exact `execute_operation` request and explicit client approval.
8. Show the OpenPost queue. After it runs, show provider URLs or honest failures.

Do not use a logo intro, founder monologue, or generic feature carousel before the result.

## Launch gate

The main demo may include only provider rows that have:

- current runtime configuration;
- a connected active account;
- a successful rehearsal for the exact format and media shape;
- a successful scheduling test when scheduling is shown;
- a final provider result recorded with date and evidence;
- a completed human review after the last agent edit.

Use [`provider-verification-log.md`](./provider-verification-log.md) for the evidence.
