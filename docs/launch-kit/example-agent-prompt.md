# Example Agent Prompt

> **Illustrative prompt.** Replace every bracketed value. Do not include provider credentials, API secrets, or unreviewed claims.

```text
Help me prepare an OpenPost campaign from the attached launch brief.

Workspace: [WORKSPACE NAME OR ID]
Campaign goal: [GOAL]
Audience: [AUDIENCE]
Primary link: [URL]
Candidate publish window: [DATE, TIMEZONE, AND CONSTRAINTS]

Safety and evidence rules:
1. Start with search_operations, then use only query_operation while inspecting the workspace, provider catalog, connected accounts, recent media, drafts, posting slots, and provider readiness.
2. Treat implemented, configured, and live-verified as separate states. Do not include a provider in the final destination list unless the supplied verification log shows the exact account and format as live-verified.
3. Never ask me for social-provider access tokens, refresh tokens, client secrets, app passwords, or encryption keys. MCP should not expose them.
4. Prepare one canonical source message and a distinct rendition for each eligible destination. Preserve facts, but adapt length, structure, link placement, thread shape, media, alt text, and tone.
5. Flag any claim that the brief or linked source does not support. Do not invent testimonials, users, metrics, published URLs, provider verification, or campaign outcomes.
6. Before any mutation, show me:
   - the exact OpenPost operation;
   - workspace ID;
   - destination account IDs and provider names;
   - final copy for every destination;
   - media IDs, roles, and alt text;
   - format and settings;
   - scheduled time with timezone;
   - validation warnings or blockers.
7. Stop and wait for explicit approval before calling execute_operation.
8. Do not publish immediately. Prepare drafts and renditions first. Creating or updating them requires mcp:full and explicit client approval.
9. After I review the campaign in the OpenPost web app, accept my final edits as the source of truth. Ask again before scheduling.
10. After the queue runs, query the publication lifecycle and report a provider URL or failure for every destination. A saved or scheduled state is not proof of publication.

First, return a read-only readiness summary. Do not create, update, upload, schedule, publish, cancel, reply, hide, or delete anything in this step.
```

## Token choice

Use a workspace-scoped `mcp:read` token for the first readiness pass. The server limits it to read-safe discovery and query operations and rejects mutations.

Creating drafts, setting renditions, uploading media, scheduling, publishing, and other state changes require `mcp:full`. Keep it workspace-scoped, configure the MCP client to require approval for `execute_operation`, and revoke it when the campaign ends.

## Expected first response

The agent should return:

- selected workspace and scope;
- candidate accounts by provider;
- provider readiness and missing configuration;
- existing relevant media and drafts;
- exact paths marked live-verified in the supplied log;
- blocked or preview providers that will be excluded;
- open questions that must be answered before drafting.

It should not create a draft or claim that any provider is ready to launch during this first response.
