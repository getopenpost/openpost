# OpenPost Launch Kit

This folder is a worked example of an agent-assisted, human-reviewed OpenPost campaign. It is designed to be copied, edited, rehearsed, and audited.

**Nothing in this folder is evidence that a campaign was published.** The posts are illustrative, the verification log starts empty, and the results file is a template. Add provider URLs or success claims only after OpenPost records the final live outcome.

## What is included

| File | Purpose |
| --- | --- |
| [`launch-brief.md`](./launch-brief.md) | One-page campaign goal, audience, facts, claim boundaries, and demo sequence |
| [`example-agent-prompt.md`](./example-agent-prompt.md) | Prompt that starts read-only, prepares renditions, and stops before execution |
| [`sample-base-post.md`](./sample-base-post.md) | Canonical source message for the worked example |
| [`renditions/`](./renditions/) | Five destination-specific sample versions for X, LinkedIn, Bluesky, Mastodon, and Threads |
| [`mcp-security-boundary.md`](./mcp-security-boundary.md) | What MCP access reveals, what it can change, and what stays inside OpenPost |
| [`provider-verification-log.md`](./provider-verification-log.md) | Empty evidence log for each exact account and format |
| [`review-checklist.md`](./review-checklist.md) | Human review, scheduling, queue, and post-publication checks |
| [`release-freeze-checklist.md`](./release-freeze-checklist.md) | Version freeze, production smoke, campaign rehearsal, and rollback template |
| [`pilot-evidence-log.md`](./pilot-evidence-log.md) | Empty ten-user pilot log for activation, failure points, and permitted proof |
| [`distribution-plan.md`](./distribution-plan.md) | Proof-first launch waves and destination-specific material |
| [`listings.md`](./listings.md) | Human-maintained directory and marketplace listing tracker |
| [`metrics-plan.md`](./metrics-plan.md) | Fourteen-day activation and guardrail plan with manual evidence fields |
| [`results-template.md`](./results-template.md) | Clearly labeled template for real outcomes, URLs, failures, and lessons |
| [`media/README.md`](./media/README.md) | Existing product assets and placeholders for the final campaign media |

## Use the kit

1. Copy the folder for one campaign. Keep the untouched example for reference.
2. Replace the sample facts and placeholders in the launch brief.
3. Connect with a workspace-scoped `mcp:read` token for inspection. It cannot create, update, schedule, or publish.
4. Fill the provider verification log by rehearsing the exact account and format. Implemented or configured is not the same as live-verified.
5. Give the agent the brief and prompt. If it needs to create drafts or renditions, use a workspace-scoped `mcp:full` token and require client approval for mutations.
6. Review every rendition, account, media attachment, and time in the OpenPost web app.
7. Approve only the exact scheduling or publishing operation you inspected.
8. Record actual provider URLs or failures from OpenPost lifecycle events in the results template.

Before the public campaign, complete the release-freeze checklist and collect ten pilot records. During the first fourteen days, update the metrics plan from named manual evidence sources. The social-provider Analytics page does not measure product activation, and this repository does not include a product-usage analytics vendor or automatic launch KPI dashboard.

The five sample rendition files are not a recommendation to include five providers in a real launch. Use only rows marked live-verified for the exact campaign account and format.

## Hosted service and self-hosted access

Hosted service publishing starts at $15/month. Every plan includes a card-required 14-day trial. Registration creates one workspace before checkout; connecting accounts, uploading media, scheduling, publishing, and other provider writes require an active or trialing Paddle subscription.

Self-hosted OpenPost has no software subscription. The operator remains responsible for infrastructure, provider applications, secrets, backups, and upgrades.

## Product documentation

- [Agent-assisted publishing](https://docs.openpost.social/usage/agent-assisted-publishing)
- [MCP connection and safety](https://docs.openpost.social/mcp/)
- [Launch verification matrix](https://docs.openpost.social/operations/provider-launch-matrix)
- [Supported platforms and limits](https://docs.openpost.social/providers/)
