# API and schema compatibility

This page is for contributors deprecating or removing public API and stored-data contracts.

OpenPost does not remove a public API or stored-data contract because repository search reports no caller. API-token clients, older CLI versions, MCP bridges, and automation tools can use a route without appearing in the current source tree.

[`compatibility-surfaces.json`](https://github.com/getopenpost/openpost/blob/main/compatibility-surfaces.json) is the machine-checked retirement registry. It records the owner, exact introduction commit and release, current decision, replacement, migration path, notice state, normalized route evidence, consumer review, and earliest removal facts for each candidate.

## Sunset policy

A retained route is supported. It is not deprecated merely because a replacement exists.

A route or schema member can become deprecated only when all of these are true:

- its replacement is available and the migration path is documented;
- the OpenAPI operation or schema property has a `deprecated` marker;
- the change is announced in `CHANGELOG.md` and migration documentation;
- normalized telemetry review has started for every consumer class.

Removal requires at least 90 days and two later stable releases after the announcement. The review must cover `web`, `cli`, `mcp`, `mcp-media`, `n8n`, and other `api` callers. Every class needs recorded no-use or not-applicable evidence, and no known use can remain. A failed or incomplete review keeps the route.

The request log's `route` and `consumer` fields provide low-cardinality evidence. The consumer value comes from a caller-controlled user agent, so it is a useful review hint, not proof of identity. See [Logs](/operations/logs) for the exact logging boundary.

## Current decisions

No route in the initial registry is deprecated. The `media_cleanup_days` workspace-settings field is already in a measured compatibility period: old writes are ignored, reads return `14`, and removal remains blocked until the full sunset gate passes.

| Surface                                                 | Decision  | Reason                                                                                                                                                          |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /posts/schedule-overview`                          | Retain    | The handler now reads canonical publications, but no replacement yet promises the same bounded monthly aggregate.                                               |
| `GET /accounts/mastodon/servers`                        | Retain    | The provider catalogue must prove configured and dynamic Mastodon instance parity first.                                                                        |
| `GET /accounts/{account_id}/destination-options`        | Retain    | The approved n8n v0.1 contract reserves this selector; implement and migrate it to the paged option route before deprecation.                                   |
| Legacy `POST /posts` and `PATCH /posts/{id}`            | Retain    | External clients need an explicit publication migration that preserves revision behavior.                                                                       |
| `GET /organizations` and `GET /organizations/{id}/team` | Retain    | Organization identity, billing, and membership are not equivalent to workspace access.                                                                          |
| Workspace-context and organization-path billing routes  | Retain    | The app and CLI use the generic routes while organization routes remain part of the admin contract. BILL-003 and BILL-004 must choose one final boundary first. |
| `POST /auth/oidc/{provider_id}/logout`                  | Retain    | It is the active local-session revocation and optional provider logout contract.                                                                                |
| `/prompts` routes                                       | Retain    | The Writing prompts page and text-and-thread composer are maintained consumers.                                                                                 |
| Publication request `intent` aliases                    | Retain    | `creation_preset` is preferred, but no formal alias sunset has started and external clients may still send `intent`.                                            |
| Workspace-settings `media_cleanup_days`                 | Deprecate | The lifecycle is fixed; the compatibility field remains until the announced 90-day, two-stable-release, and consumer-evidence gates pass.                       |

## Changing the registry

Update the registry in the same change as an OpenAPI deprecation or removal. Run:

```bash
bun run check -- compatibility
```

The check fails if a retained operation or schema member disappears from OpenAPI, an operation ID drifts, a candidate vanishes from the registry, a deprecation lacks its marker or notices, or a removal is attempted before its time, release, replacement, and consumer-evidence gates pass.
