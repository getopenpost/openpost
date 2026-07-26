# Provider Roadmap

OpenPost supports provider-aware publishing through the web app, CLI, HTTP API, MCP, and ChatGPT-style clients. This page records the contract for adding providers without exposing unfinished adapters as connectable.

The provider discovery API returns current and planned providers so clients can render a consistent account-connection surface.

| Status                | Meaning                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `available`           | Adapter is registered on this server and users can connect accounts.           |
| `needs_configuration` | Adapter exists, but the operator has not configured the provider app.          |
| `planned`             | Product roadmap item. The backend will not start a real OAuth flow for it yet. |

## Planned adapters

No planned adapter is exposed as connectable right now. New provider roadmap items should stay in `planned` status until backend publish behavior, provider discovery, UI states, docs, and tests land together.

## Preview adapters

| Provider | Current product focus                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Facebook | Selected Page publishing for text, one public HTTPS image URL, or one public HTTPS video URL. |
| Instagram | Selected Instagram Business or Creator account publishing for single image/Reel, carousel, Story, and comment-reply paths, with live verification still recommended. |
| TikTok   | Direct-post video, inbox/upload video, and photo-post paths, with app-review/live-account verification still required. |
| YouTube  | Selected channel uploads with privacy/metadata/thumbnail/playlist settings and resumable upload handling, with live verification still recommended. |

## Account-selection requirement

Some providers cannot be modeled as a single OAuth user profile:

- Instagram connects the selected Instagram Business or Creator account behind a Facebook Page.
- YouTube connects the selected channel.

Instagram, Facebook, and YouTube use the backend account-selection flow today. TikTok uses a direct OAuth account flow and is connectable when configured; its current adapter supports video plus photo-post paths, subject to TikTok app access and live verification.

## Implementation contract

Every provider still needs to implement the shared backend adapter before it becomes connectable:

- OAuth or app-password account connection.
- Token refresh behavior, when the provider supports refresh.
- Profile lookup for stable account identity, or account-selection support for page/channel providers.
- Media upload rules and validation.
- Publish behavior, including reply/thread semantics where available.
- Documentation for callbacks, app review requirements, media limits, and known API caveats.

Until an adapter lands, keep the provider in `status: "planned"` and do not accept it in `OPENPOST_PROVIDER_APPS`.
