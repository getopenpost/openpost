# Agent-Assisted, Human-Reviewed Publishing

OpenPost can sit between an AI agent and your social accounts. The agent prepares publishing work through MCP; OpenPost keeps provider credentials, workspace data, validation, and queue state inside the application; a person reviews the campaign before allowing a mutation.

This workflow is useful for releases, product updates, open-source announcements, and recurring campaigns that need different treatment on each destination.

## What the agent can do

With a workspace-scoped `mcp:read` token, an agent can inspect the selected workspace, connected accounts, provider readiness, media, drafts, schedule, queue status, and lifecycle outcomes. OpenPost does not expose mutation tools to that scope and rejects mutation attempts server-side.

With `mcp:full`, an authorized agent can also:

- create or update a base draft;
- prepare account-specific renditions and media choices;
- validate a publication and suggest an open posting slot;
- schedule or publish through `execute_operation` after the client receives approval;
- inspect queue status, lifecycle events, published results, and failures.

The agent does not receive decrypted provider access or refresh tokens. OpenPost uses those credentials internally when it calls a provider.

::: warning MCP authority
Use `mcp:read` for inspection. It is server-enforced read-only access. An `mcp:full` token can execute publishing operations when the MCP client allows them. Keep it workspace-scoped, require approval for `execute_operation`, and revoke it when the integration no longer needs access.
:::

## Recommended workflow

| Stage | Agent task | Human task |
| --- | --- | --- |
| Inspect | Query the workspace, provider catalog, accounts, media, existing drafts, and provider readiness. | Confirm the selected workspace and accounts are in scope. |
| Prepare | Draft one canonical message and account-specific renditions. | Check claims, tone, links, media rights, and accessibility text. |
| Validate | Run publication validation and suggest candidate times. | Choose the exact accounts, format, and schedule. |
| Approve | Present the final mutation and wait. | Review in the web app, then approve the exact `execute_operation` call. |
| Observe | Query queue state and lifecycle events. | Resolve failures and record actual published URLs. |

Human review is the recommended process boundary. OpenPost does not currently impose a separate server-side approval stage before an authorized mutation.

## 1. Create bounded access

Connect through the remote MCP endpoint or the local `openpost-mcp` proxy as described in [Agent-Assisted Publishing With MCP](/mcp/). Prefer a dedicated `mcp:read` token bound to the current workspace for the first inspection pass. Grant `mcp:full` only when the agent needs to create or change OpenPost data.

Do not paste provider credentials into the prompt. The MCP client needs an OpenPost token, not X, Meta, LinkedIn, Bluesky, Mastodon, TikTok, or Google credentials.

## 2. Start with read-only inspection

Ask the agent to use `search_operations` to discover the current schemas. It should route inspection through `query_operation` and report:

- the workspace ID and intended accounts;
- each provider's readiness result;
- relevant media and its accessibility text;
- existing drafts that may overlap;
- candidate posting slots;
- any provider or format that still lacks current live verification.

Do not treat a configured provider app, a successful OAuth start, or an implemented adapter as proof that the exact launch account and format can publish today. Use the [Launch Verification Matrix](/providers/launch-matrix).

## 3. Prepare a canonical post and renditions

Keep the source message factual and destination-neutral. Then adapt it by account:

- shorten and front-load the point for X;
- add context and a clear professional takeaway for LinkedIn;
- use a compact thread when Bluesky needs more room;
- include self-hosting and federation-relevant detail for Mastodon;
- use a conversational rendition for Threads only after that exact production path passes rehearsal.

Do not paste the same text into every destination. Preserve the facts and call to action while adapting structure, length, link placement, and media.

## 4. Review in OpenPost

Before approval, inspect every destination in the composer:

1. Confirm the account identity and provider.
2. Read the rendition without the base post beside it.
3. Check character, thread, media-count, and format limits.
4. Verify links, mentions, hashtags, titles, descriptions, and alt text.
5. Remove providers that are not configured or not verified for the exact path.
6. Confirm the workspace timezone and scheduled time.
7. Save edits before approving the mutation.

## 5. Approve the exact mutation

The agent should show the operation name, workspace, account IDs, media IDs, format, and scheduled time before calling `execute_operation`. Approval should cover that exact mutation, not a standing instruction to publish anything the agent produces later.

## 6. Record outcomes, not intentions

A saved draft proves preparation. A scheduled state proves that OpenPost accepted the schedule. Neither proves that a provider published the post.

After the queue runs, record the per-destination result from lifecycle events:

- published URL and provider post ID;
- failure message and retry state;
- verification date, account, and format;
- any manual edit made after the agent's draft.

Use the [OpenPost Launch Kit](https://github.com/rodrgds/openpost/tree/main/launch-kit) for a reusable brief, sample prompt, five illustrative renditions, review checklist, and clearly labeled result template.

## Managed app access

Managed publishing starts at €6/month. Registration can create one bootstrap workspace before checkout, but connecting accounts, uploading media, scheduling, publishing, and other provider writes require an active or Polar-trialing subscription. There is no automatic hosted free tier or trial. Self-hosted OpenPost has no software subscription.
