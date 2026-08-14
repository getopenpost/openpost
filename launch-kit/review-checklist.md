# Human Review and Campaign Checklist

Use this checklist after the agent prepares the campaign and before any scheduling or publishing operation.

## Release freeze

- [ ] [`release-freeze-checklist.md`](./release-freeze-checklist.md) has an owner and is complete for the release candidate.
- [ ] The release candidate is fixed; only first-use, reliability, provider, and copy blockers may change.
- [ ] The application, documentation, screenshots, and campaign all describe the same release.
- [ ] Production readiness, queue health, analytics, and rollback checks have passed.
- [ ] The full campaign has been rehearsed without exposing credentials.

## Evidence and provider gate

- [ ] Every included account and format has a dated successful row in [`provider-verification-log.md`](./provider-verification-log.md).
- [ ] Implemented, configured, and live-verified are not treated as synonyms.
- [ ] Preview, audit-gated, unconfigured, or unverified paths are removed from the main demo.
- [ ] The number of destinations in the hook matches the verified rows exactly.
- [ ] No sample file or scheduled state is presented as published proof.

## Campaign facts

- [ ] Product, pricing, license, deployment, and security claims match current source and docs.
- [ ] Hosted service access states the card-required 14-day trial, exact renewal price and date, and bootstrap workspace limit.
- [ ] Testimonials, customer names, metrics, and comparison claims have evidence and permission.
- [ ] The agent did not invent users, results, published URLs, or provider verification.
- [ ] Links resolve to the intended current pages.

## Destination review

Repeat for every destination:

- [ ] Correct workspace, account, provider, and identity.
- [ ] Copy reads naturally without the base post beside it.
- [ ] Facts and call to action match the approved brief.
- [ ] Structure, length, link placement, and tone suit the destination.
- [ ] Thread sequence and reply targets are correct.
- [ ] Media count, format, crop, title, description, and provider settings pass validation.
- [ ] Alt text explains the useful content of every informative image.
- [ ] Mentions, hashtags, and links point to the intended entities.
- [ ] No credential, private identifier, or unreleased information appears in copy or media.

## Mutation approval

- [ ] The MCP token is limited to the intended workspace.
- [ ] `mcp:read` was used for inspection where possible.
- [ ] `mcp:full` is enabled only because this step creates or changes OpenPost data.
- [ ] The client requires approval for `execute_operation`.
- [ ] The operation name, account IDs, media IDs, format, and time are visible before approval.
- [ ] Approval covers this exact operation, not future agent-generated work.
- [ ] Immediate publication is not selected accidentally.

## Schedule and queue

- [ ] Workspace timezone, local time, and any daylight-saving transition are correct.
- [ ] The queue shows every intended destination once.
- [ ] The scheduled state and primary job are visible.
- [ ] Monitoring and a named person are ready for the publish window.
- [ ] Failure and retry behavior is understood before the campaign runs.

## After the queue runs

- [ ] Every destination has a final lifecycle result.
- [ ] Published provider ID and URL are recorded from the result.
- [ ] Failures retain their exact message, retry state, and owner.
- [ ] Manual corrections are recorded instead of hidden.
- [ ] The results template distinguishes scheduled, published, failed, and unverified destinations.
- [ ] Temporary `mcp:full` access is revoked when no longer needed.
