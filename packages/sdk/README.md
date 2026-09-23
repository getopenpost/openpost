# @getopenpost/sdk

Official TypeScript SDK for the [OpenPost](https://openpo.st) API. Create publications, manage per-account renditions, upload media, and track publishing jobs from Node 20+, Bun, or Cloudflare Workers. Zero runtime dependencies: only `fetch` is used.

```ts
import { OpenPost } from "@getopenpost/sdk";

const openpost = new OpenPost({
  baseUrl: "https://app.openpo.st",
  token: process.env.OPENPOST_TOKEN,
  workspaceId: process.env.OPENPOST_WORKSPACE_ID,
});

const draft = await openpost.publications.create({
  workspace_id: await openpost.workspaceId(),
  title: "Launch day",
  content_profile: "short_text",
  source_text: "We just shipped our TypeScript SDK.",
  social_account_ids: ["acc_..."],
});

await openpost.publications.validate(draft.id, { throwOnInvalid: true });
const action = await openpost.publications.publishNow(draft.id, draft.revision);
if (action.job_id) await openpost.jobs.wait(action.job_id);
const done = await openpost.publications.wait(draft.id);
console.log(done.status); // published
```

## Install

```bash
npm install @getopenpost/sdk
```

Mint a workspace API token in OpenPost (API tokens settings) and pass it as `token`, or set `OPENPOST_TOKEN`. Override the instance with `baseUrl` or `OPENPOST_URL`. The default workspace comes from `workspaceId`, `OPENPOST_WORKSPACE_ID`, or `OPENPOST_WORKSPACE` (shared with the Go CLI).

## Publications

Publications are the authored record; renditions are the per-account versions. Copy Social Set defaults into renditions on create, let explicit post values win, and never rewrite existing publications when a set changes.

```ts
// Destination-specific text plus provider settings for one account.
const options = await openpost.accounts.destinationOptions("acc_...");
console.dir(options, { depth: null });

await openpost.publications.upsertRenditions(draft.id, draft.revision, [
  {
    social_account_id: "acc_...",
    body: "We just shipped our TypeScript SDK. Try it:",
    settings: { url: "https://openpo.st" },
  },
]);

// Lifecycle actions all take the revision you last saw, so stale
// automation fails with a conflict instead of clobbering edits.
await openpost.publications.publishNow(draft.id, draft.revision);
await openpost.publications.cancel(draft.id, draft.revision);
await openpost.publications.retryFailed(draft.id);
const events = await openpost.publications.events(draft.id);
```

## Media

`upload()` hides the three-step session flow: reserve the row, PUT the bytes to the storage target, then complete. Bytes go to external storage targets without the API token.

```ts
const asset = await openpost.media.upload({
  workspaceId: "ws_...",
  file: new Uint8Array(await Bun.file("cover.png").arrayBuffer()),
  filename: "cover.png",
  mimeType: "image/png",
  altText: "Launch cover art",
});
```

## Accounts, Social Sets, jobs

```ts
const accounts = await openpost.accounts.list("ws_...");
const options = await openpost.accounts.destinationOptions("acc_...");
const sets = await openpost.socialSets.list("ws_...");
const failedJobs = await openpost.jobs.list({ workspace_id: "ws_...", status: "failed" });
```

Publication responses expose `creation_source`. Records created through this package use `sdk`.

## Errors

```ts
import { OpenPost, OpenPostError } from "@getopenpost/sdk";

try {
  await openpost.publications.schedule(id, revision);
} catch (error) {
  if (error instanceof OpenPostError && error.code === "conflict") {
    // Someone edited the publication; re-read it and retry.
  }
}
```

Every error carries a `disposition` automation can switch on (`never` |
`after-delay` | `after-reconnect` | `reconcile-first`). `reconcile-first`
means the request may have executed: re-read state before retrying, never
blind-retry. `toJSON()` serializes the code, status, disposition, and
details.

| Code             | HTTP      | Disposition       | Retry?                                  |
| ---------------- | --------- | ----------------- | --------------------------------------- |
| `missing_config` | —         | `never`           | no, set token/workspace                 |
| `unauthorized`   | 401       | `after-reconnect` | no, reconnect first                     |
| `forbidden`      | 403       | `never`           | no                                      |
| `not_found`      | 404       | `never`           | no                                      |
| `conflict`       | 409       | `never`           | no, re-read first                       |
| `validation`     | 400 / 422 | `never`           | no, fix the input                       |
| `rate_limited`   | 429       | `after-delay`     | yes (`retryAfterMs`)                    |
| `server`         | 5xx       | `after-delay`     | GET retries once; mutations never retry |
| `ambiguous`      | —         | `reconcile-first` | no, reconcile first                     |
| `timeout`        | —         | `after-delay`     | caller decides                          |
| `network`        | —         | `after-delay`     | caller decides                          |

## Outcomes

Renditions are the per-destination truth. `describeRendition` maps one
rendition to an exhaustive outcome: `published` requires the provider
native id, a `published` row without one (or a `failed` row with no error
detail) reports `unknown` with a `reconcile-first` disposition.
`summarizePublication` derives one aggregate (`pending` | `complete` |
`partial`); partial success is first-class, so mixed results never read
as `published`.

```ts
import { describeRendition, summarizePublication } from "@getopenpost/sdk";

const summary = summarizePublication(publication);
if (summary.status === "partial") {
  for (const outcome of summary.outcomes) {
    console.log(outcome.state, outcome.disposition);
  }
}
```

## Testing

`@getopenpost/sdk/testing` ships a deterministic mock of the automation
surface: no network, fixed ids and timestamps, and one scenario string
plus an `advance()` latch for async pipelines. The subpath is separate
from the root import so production bundles never carry it.

```ts
import { MockOpenPost } from "@getopenpost/sdk/testing";

const mock = new MockOpenPost("processing-then-success");
const draft = await mock.publications.create({
  workspace_id: "ws_...",
  title: "Launch",
  content_profile: "short_text",
  source_text: "We shipped.",
  social_account_ids: ["acc_..."],
});
await mock.publications.publishNow(draft.id, draft.revision);
mock.advance(); // complete pending provider work without timers
const done = await mock.publications.wait(draft.id);
```

Scenarios: `immediate-success`, `processing-then-success`,
`mixed-success-failure`, `rate-limited`, `reconnect-required`,
`ambiguous-accept`. `history()` records every operation with a sequence
number; `reset()` clears state and counters.

## Automation surface

| Surface            | Use when                                                |
| ------------------ | ------------------------------------------------------- |
| **SDK** (this pkg) | CI jobs, scripts, and agents calling OpenPost over HTTP |
| **CLI**            | Terminal publishing and login via `openpost`            |
| **MCP**            | Agentic tools inside a running OpenPost instance        |
| **n8n**            | Visual workflows with `@getopenpost/n8n-nodes-openpost` |

## License

MIT. See [LICENSE](./LICENSE).
