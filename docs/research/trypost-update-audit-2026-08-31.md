# TryPost August 2026 update audit

**Audit window:** 2026-08-01 through 2026-08-31

**TryPost revision:** `6496588bbc34`

**OpenPost revision:** `169c72d127c3`

**Status:** Complete

## Question

Which substantive TryPost changes from the audit window expose a reliability,
provider-parity, or product gap that OpenPost should address?

## Method

- Reviewed all 51 TryPost commits in the window from the shallow reference
  checkout at `references/trypost/`.
- Grouped related follow-up commits into 25 substantive change clusters.
- Read the source diffs, not only commit messages or release notes.
- Compared each candidate with current OpenPost code and recent OpenPost history.
- Checked the six active OpenPost Vikunja tasks. None already owns the adoption
  candidates below.
- Excluded release mail, README funding and star-history edits, dependency-only
  updates, generated media, and TryPost-specific framework maintenance unless
  they exposed a portable behavior change.

## Recommendation

OpenPost should adopt five changes, in this order:

1. Complete Meta Page discovery, including pagination and Business Portfolio
   edges.
2. Add provider-aware Meta error classification and preserve safe error
   subcodes.
3. Warn about scheduled renditions whose destination connection is likely to
   fail before publish time.
4. Resume Instagram publishes from durable container checkpoints.
5. Normalize uploaded filenames to valid UTF-8 before persistence.

Ad-click attribution is a useful lower-priority hosted-growth improvement. The
remaining TryPost work is already covered, does not apply to OpenPost, or lacks
enough evidence to justify a change.

## Adopt

### P1: Complete Meta Page discovery

**TryPost evidence:**

- [#253, paginate Facebook Page connection results](https://github.com/trypostit/trypost/commit/173a1e4c612e34e00c18cb1b878b69077b5deaf0)
- [#301, discover Pages reached through a Business Portfolio](https://github.com/trypostit/trypost/commit/02e44b978511026b550def4e3950c8f775e23c7d)

TryPost found two distinct omissions. `/me/accounts` can paginate, and some
Pages are available only through Business Portfolio `owned_pages` or
`client_pages` edges.

OpenPost requests `business_management`, but
`backend/internal/platform/facebook.go` and
`backend/internal/platform/instagram.go` still discover accounts from
`/me/accounts` only. Both request `limit=100`, read one response, and do not
follow a paging cursor. Requesting the broader permission without traversing
the corresponding edges leaves valid Pages undiscoverable.

**Adopt:** Build one Meta Page discovery path shared by Facebook and Instagram.
It should:

- follow all `/me/accounts` pages;
- enumerate the login's Business Portfolios;
- follow each portfolio's `owned_pages` and `client_pages` pages;
- deduplicate by Page ID;
- preserve the Page access token associated with each result;
- keep OpenPost's current explicit error reporting when discovery is denied or
  incomplete.

This is the clearest user-visible parity gap in the audit.

### P1: Make Meta failure handling provider-aware

**TryPost evidence:**

- [#254, distinguish dead Meta tokens from transient and rate-limit failures](https://github.com/trypostit/trypost/commit/1adef7787c9598cb142833eb96d33180d36b056d)
- [#280, retry the exact transient Threads container propagation failure](https://github.com/trypostit/trypost/commit/2f6c006bfb1f8db2b4cc60b8da94eac3cd1207d8)
- [Meta Graph API error handling](https://developers.facebook.com/docs/graph-api/guides/error-handling/)
- [Meta Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)

OpenPost's `backend/internal/platform/errors.go` safely retains HTTP status, one
provider code, and `Retry-After`. That is a strong privacy boundary, but it is
not enough for Meta:

- Meta often returns auth, permission, rate-limit, and transient failures as
  HTTP 400.
- `backend/internal/services/publisher/failures.go` classifies a generic HTTP
  400 as content validation. A Meta token rejection can therefore tell the
  user to edit content instead of reconnecting.
- Meta Business Use Case rate limits can also arrive as HTTP 400, so treating
  every Meta 400 as permanent would be wrong.
- OpenPost already retries Threads code `24`, but
  `isThreadsPublishPropagationError` retries every code-24 response. TryPost's
  fix targets code `24`, subcode `4279009`, the known processed-container
  propagation case.

**Adopt:** Extend the safe error envelope with a validated provider subcode,
then normalize Meta failures at the adapter boundary into stable OpenPost
codes. Keep the raw response body out of stored state and logs. At minimum:

- classify confirmed token rejection as reconnect-required;
- classify confirmed permission failures as provider-action-required;
- classify Meta transient and relevant Business Use Case rate-limit codes as
  retryable;
- treat unparseable bodies as unknown or transient, not proof that a token is
  dead;
- narrow the Threads propagation retry to code `24`, subcode `4279009`.

Do not copy one global Meta code table into the generic HTTP layer. Meanings can
depend on the endpoint and provider operation.

### P1: Verify connections for renditions due soon

**TryPost evidence:**

- [#256, proactive connection checks for at-risk scheduled posts](https://github.com/trypostit/trypost/commit/a147c7414ba8f253af01c305a68d3f57a1a4a893)

TryPost verifies active destinations for posts due within the next hour and
notifies the user before publish time when a confirmed connection failure
needs intervention.

OpenPost refreshes tokens through `backend/internal/services/tokenmanager/`
and handles failures during publishing, but it has no equivalent preflight
flow for scheduled renditions. A destination can therefore remain apparently
healthy until the durable publish job reaches it.

**Adopt:** Add a durable, deduplicated job that checks active renditions due in
a bounded window. It should use each adapter's least expensive identity or
verification call, share the provider-aware classification above, and notify
only for confirmed user-action failures. Rate limits, network failures, and
unparseable responses must not mark an account disconnected. Record the last
verification and last warning so frequent schedules do not create read or
notification storms.

This should be scoped to upcoming scheduled work, not an hourly sweep of every
connected account.

### P1: Resume Instagram from provider checkpoints

**TryPost evidence:**

- [#281, resume in-flight Instagram and TikTok publishes](https://github.com/trypostit/trypost/commit/4546425532db33896180e629d3dcff435722338c)

OpenPost already has the right generic machinery:

- `platform.PublishRequest` carries resume state and a checkpoint callback;
- `providerwrite.Control` persists provider state and reference IDs;
- the publisher fences ambiguous writes and reconciles pending submissions;
- TikTok checkpoints its `publish_id` and implements `ReconcilePublish`.

TikTok is therefore already covered. Instagram is not. In
`backend/internal/platform/instagram.go`, the adapter creates one or more media
containers, polls them, and publishes them without checkpointing the container
IDs. A worker failure after container creation cannot resume that remote work.
The generic write fence prevents a blind duplicate, but the likely result is
manual ambiguity rather than an automatic recovery.

**Adopt:** Use the existing provider-write contract in the Instagram adapter.
Checkpoint container IDs immediately after creation, resume polling from those
IDs, and checkpoint the final publish transition. Define versioned state for
single media, carousel children and parent, and multi-story sequences. Resume
must verify the checkpoint belongs to the same rendition intent before using
it.

Do not add a parallel Instagram-only job state model.

### P1: Normalize filenames to valid UTF-8

**TryPost evidence:**

- [#265, sanitize invalid UTF-8 in uploaded filenames](https://github.com/trypostit/trypost/commit/74e6d341abb14e2e8cd288210e29d881dad9a7c1)

TryPost reproduced database failures from legacy filenames containing invalid
bytes and normalized every media-ingest path.

OpenPost's `backend/internal/api/handlers/media.go` stores multipart
`FileHeader.Filename` in both buffered and streaming upload paths. Go's
multipart parser can preserve an invalid filename byte, so this string is not
guaranteed to be valid UTF-8 before database persistence or JSON output.
Server-created JSON upload sessions are safer because Go's JSON decoder
normalizes invalid input, but direct multipart upload remains exposed.

**Adopt:** Add one filename normalization function at the media service
boundary and apply it to all persisted media names, including direct,
streaming, resumable, URL-import, and future MCP ingest paths. Preserve as much
of the name as possible with replacement runes, then apply existing basename,
length, and safety rules. Add a regression test through the multipart HTTP
boundary using a raw invalid byte.

### P2: Preserve ad click IDs for hosted conversion attribution

**TryPost evidence:**

- [#276, capture ad click IDs](https://github.com/trypostit/trypost/commit/ca1e34622761c229fbe727586728b6a3f6d17abb)

OpenPost has backend signup and checkout telemetry, but the current source tree
does not persist common click IDs such as `gclid`, `fbclid`, `ttclid`,
`twclid`, or `msclkid`. UTM data alone cannot support every ad platform's
server-side conversion matching.

**Adopt when paid acquisition is active:** Capture an allowlist on the first
landing request, bind it to the signup or anonymous session, copy it to the
hosted customer record, and attach only the relevant field to conversion
events. Set a retention limit and document the privacy purpose. Do not add this
to the self-hosted core path unless an operator enables it.

## Already covered

| TryPost change                                                                                                                                          | OpenPost result                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#208 workspace deletion](https://github.com/trypostit/trypost/commit/53a5a8bf22710afa32bd57c21d08bd47347ab78b)                                         | Covered by `DELETE /workspaces/{id}`, deletion preview, recent-auth and canonical-name confirmation, last-workspace protection, and deletion tests.                              |
| [#209 drafts remain unscheduled](https://github.com/trypostit/trypost/commit/a33ff5d00fe73e8298f800e4dbee1732a2d98c0f)                                  | OpenPost separates optional `scheduled_at` from the explicit scheduling operation and requires a future time before scheduling.                                                  |
| [#241 and #245 MCP viewer, settings, and workspace-scoped tokens](https://github.com/trypostit/trypost/commit/2ca594830908cf73d0f932c506093e5844553ceb) | OpenPost API tokens have explicit MCP read/full scopes and optional workspace binding. MCP requests use the same workspace and permission boundaries as the HTTP API.            |
| [#263 concurrent upload collision](https://github.com/trypostit/trypost/commit/676afb15ba5f9dfcf85484ac54e8fc2ef5fa9256)                                | Covered by server-created upload-session UUIDs, idempotency, centralized deduplication, cancellation reconciliation, and no identity derived only from user, filename, and size. |
| [#220 OpenRouter routing](https://github.com/trypostit/trypost/commit/eb52b6b699df81ec261e62f7f3864c1a0257c312)                                         | OpenPost AI calls use the shared provider-neutral boundary and shared model/config selection rather than a per-feature provider path.                                            |
| [#272 LinkedIn Page post URLs](https://github.com/trypostit/trypost/commit/29e90c52afbe74068b0ae9fca7c5816d88a83a02)                                    | OpenPost stores external IDs and resolves provider content URLs through the adapter contract instead of relying on a truncated organization URL.                                 |
| [#277 backend signup and checkout events](https://github.com/trypostit/trypost/commit/de54ea24f958e7b71a02de94f3ad77fae4b07d06)                         | `backend/internal/telemetry/telemetry.go` already defines server-side signup, billing-checkout-created, and checkout-completed events.                                           |
| TikTok half of [#281](https://github.com/trypostit/trypost/commit/4546425532db33896180e629d3dcff435722338c)                                             | TikTok checkpoints `publish_id`, marks the write reconcile-only, and implements pending publish reconciliation.                                                                  |
| [#282 Asset Library API and MCP](https://github.com/trypostit/trypost/commit/eb2b345163a72124e501dc01155516107f44796a)                                  | OpenPost exposes workspace media through HTTP and MCP, supports URL ingestion, and accepts publication `media_ids`. Its surface is broader than the specific TryPost addition.   |
| [#297 nullable MCP `last_used_at`](https://github.com/trypostit/trypost/commit/097f30c765390524c6bdaee83246476cb6be87e8)                                | `APITokenResponse.LastUsedAt` is already nullable and produced through `optionalTime`; the settings UI handles absent values.                                                    |
| [#286 multiple accounts per network](https://github.com/trypostit/trypost/commit/91c3d86d868d0f1413ed8cd7c9fdf53d063cddc7)                              | OpenPost allows multiple remote accounts for a provider and deduplicates only the same workspace, provider, and remote account identity.                                         |

## Not applicable or insufficiently evidenced

| TryPost change                                                                                                                                                                                                                                                                                                                                       | Classification                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinterest title/link, polling, and rejection mapping in [#232](https://github.com/trypostit/trypost/commit/2248d01edc90697f9c645a9051732720a874b87c), [#246](https://github.com/trypostit/trypost/commit/27287aa1305487be43d1f171232adb66b43b46be), and [#278](https://github.com/trypostit/trypost/commit/120839213c5bffe3b2200b786a01c843703cb424) | Not applicable until OpenPost has a Pinterest adapter. Reassess these behaviors during that implementation.                                                                                                                                             |
| [#293 require a social connection before Stripe](https://github.com/trypostit/trypost/commit/15f87aebe4fd504934aecd3178c09fcec635bfed)                                                                                                                                                                                                               | A plausible activation experiment, not a demonstrated correctness fix. It can also add checkout friction. Measure connection completion, checkout completion, and paid activation before changing the funnel.                                           |
| [#299 remove X API reads](https://github.com/trypostit/trypost/commit/96ec995fcd0aadccd5debdf0caf9993352b1b86d)                                                                                                                                                                                                                                      | Do not copy directly. OpenPost uses `/2/users/me` for account identity and X subscription-based limits. Audit actual call volume and cache fresh capability state before removing any read.                                                             |
| [#308 defuse X links](https://github.com/trypostit/trypost/commit/6496588bbc34e0554175255a2912b5839c3b3b9a)                                                                                                                                                                                                                                          | Insufficiently evidenced. OpenPost accounts for URL-bearing posts in cost reservation, but the audit did not find clear official X documentation that supports TryPost's claimed link-post fee behavior. Rewriting user content also changes semantics. |
| MySQL compatibility in [#302](https://github.com/trypostit/trypost/commit/6e10e394a973c2bdfe911ba8980988e59ff86560) and [#307](https://github.com/trypostit/trypost/commit/02425038aa6adaafd069e4e4f96c486870210dbf)                                                                                                                                 | Not applicable. OpenPost supports SQLite and PostgreSQL, not MySQL.                                                                                                                                                                                     |
| TryPost post-template removal in [#296](https://github.com/trypostit/trypost/commit/0eff22dc0d86e6bfaf0cd8fc23e87b6f9263d1b2)                                                                                                                                                                                                                        | Product-specific cleanup with no matching OpenPost subsystem to remove.                                                                                                                                                                                 |
| Ukrainian locale and date-picker localization in [#219](https://github.com/trypostit/trypost/commit/3baf2e9c41f9696e1e0ba4c641527799e61b1611) and [#234](https://github.com/trypostit/trypost/commit/1af705f3fdd4f2b0c8fde9d42589c0ae09960edf)                                                                                                       | Useful localization work, but not evidence for adding a language without a translation plan and demand. OpenPost's date formatting already follows the active locale through shared formatters.                                                         |
| Welcome/checklist, billing knobs, sidebar unification, release material, docs, CI, and framework dependency commits                                                                                                                                                                                                                                  | Either OpenPost already has a different product-specific equivalent or the change is not portable reliability evidence.                                                                                                                                 |

## Suggested implementation slices

1. **Meta discovery:** shared paginated Page collector, portfolio traversal, adapter
   integration, and provider-boundary tests.
2. **Meta failure semantics:** safe subcode envelope, endpoint-aware
   normalization, exact Threads propagation regression test, and publisher
   failure-action tests.
3. **Scheduled connection preflight:** due-rendition query, durable job,
   verification timestamps, deduplicated warning, and transient-failure tests.
4. **Instagram resume:** versioned checkpoint state for single media first,
   then carousel and stories in separate changes.
5. **Filename normalization:** one service function plus raw multipart,
   resumable-session, and URL-import boundary tests.

These should be separate tickets. Meta error semantics should land before the
scheduled connection preflight so the preflight cannot disconnect accounts on
rate limits or malformed upstream responses.
