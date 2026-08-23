# Selected OpenPost automation contract

Generated from the canonical OpenAPI `x-openpost-automation` metadata.

- Source version: 1.0.0
- Actions emitted: 20
- Checksum: 6acd02371f1deb0ac9e62f765ec0ba230d753c6bb88a8d7e07ca686e8b1101b2

## Actions

| Resource         | Operation               | OpenAPI operation                                          | Effect          | Retry                | Idempotency |
| ---------------- | ----------------------- | ---------------------------------------------------------- | --------------- | -------------------- | ----------- |
| Workspace        | Get Many                | list-workspaces                                            | query           | transient            | none        |
| Account          | Get Many                | list-accounts                                              | query           | transient            | none        |
| Account          | Get Destination Options | get-account-destination-options                            | query           | transient            | none        |
| Account          | Get Provider Readiness  | get-provider-readiness                                     | query           | transient            | none        |
| Social Set       | Get Many                | list-social-sets                                           | query           | transient            | none        |
| Social Set       | Get                     | get-social-set                                             | query           | transient            | none        |
| Posting Schedule | Get Next Available Slot | get-next-available-slot                                    | query           | transient            | none        |
| Media            | Get Many                | list-media                                                 | query           | transient            | none        |
| Media            | Upload Binary           | create-media-upload-session, complete-media-upload-session | local-mutation  | idempotent-transient | required    |
| Publication      | Get Many                | list-publications                                          | query           | transient            | none        |
| Publication      | Create                  | create-publication                                         | local-mutation  | idempotent-transient | required    |
| Publication      | Get                     | get-publication                                            | query           | transient            | none        |
| Publication      | Update                  | update-publication                                         | local-mutation  | idempotent-transient | required    |
| Publication      | Set Renditions          | upsert-publication-renditions                              | local-mutation  | idempotent-transient | required    |
| Publication      | Validate                | validate-publication                                       | query           | transient            | none        |
| Publication      | Schedule                | schedule-publication                                       | local-mutation  | idempotent-transient | required    |
| Publication      | Cancel                  | cancel-publication                                         | local-mutation  | idempotent-transient | required    |
| Publication      | Publish Now             | publish-publication-now                                    | external-action | idempotent-transient | required    |
| Publication      | Retry Failed Renditions | retry-failed-publication-renditions                        | external-action | idempotent-transient | required    |
| Publication      | Get Events              | list-publication-events                                    | query           | transient            | none        |

## Findings

- warning: selector-metadata-missing: list-accounts relies on n8n presentation metadata for workspace_id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: get-account-destination-options relies on n8n presentation metadata for account_id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: get-provider-readiness relies on n8n presentation metadata for workspace_id; the automation catalog does not provide a selector hint.
- warning: pagination-cursor-parameter-missing: list-social-sets declares cursor pagination metadata but the OpenAPI operation has no cursor query parameter.
- warning: selector-metadata-missing: list-social-sets relies on n8n presentation metadata for workspace_id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: get-social-set relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: get-next-available-slot relies on n8n presentation metadata for workspace_id; the automation catalog does not provide a selector hint.
- warning: pagination-cursor-parameter-missing: list-media declares cursor pagination metadata but the OpenAPI operation has no cursor query parameter.
- warning: result-extraction-metadata-missing: list-media needs result extraction metadata for wrapped response items.
- warning: selector-metadata-missing: list-media relies on n8n presentation metadata for workspace_id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: create-media-upload-session relies on n8n presentation metadata for workspace_id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: list-publications relies on n8n presentation metadata for workspace_id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: create-publication relies on n8n presentation metadata for workspace_id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: get-publication relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: update-publication relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: upsert-publication-renditions relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: validate-publication relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: schedule-publication relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: cancel-publication relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: publish-publication-now relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: retry-failed-publication-renditions relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- warning: selector-metadata-missing: list-publication-events relies on n8n presentation metadata for id; the automation catalog does not provide a selector hint.
- missing: operation-not-in-openapi: get-job is not available in the canonical OpenAPI automation surface.
