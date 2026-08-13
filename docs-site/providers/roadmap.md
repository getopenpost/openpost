# Platform Roadmap

OpenPost connects to social networks through the web app, CLI, HTTP API, MCP, and ChatGPT-style clients. This page explains when a new platform may appear as connectable.

The platform list API returns implementation metadata and an evidence-based readiness decision so each client can show the same connection choices without treating configuration as proof.

| State                   | Meaning                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `needs_configuration`   | The adapter exists, but the exact provider app or instance configuration is missing.            |
| `approval_required`     | Configuration exists, but current provider approval evidence is missing.                        |
| `reconnect_required`    | The exact account grant is inactive, expired, revoked, or missing a required scope.              |
| `degraded` / `disabled` | A failed evidence lookup or runtime control blocks connection or publishing.                    |
| `ready`                 | Every fact required for this exact operation is current; healthy state stays quiet in the app.  |
| `planned`               | The platform is planned. The server will not start a real sign-in.                               |

## Planned platforms

No planned platform appears as connectable now. Keep a new platform in `planned` until its server code, platform list, UI, docs, and tests are ready.

## Platforms that need app review or live tests

| Platform  | Current implementation                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook  | Selected Page publishing for text, links, one image, 2–10 images, video, Reel, or Story; comments and opt-in inbox.                         |
| Instagram | Selected Business or Creator account publishing for image, carousel, Reel, or Story; comments and opt-in inbox.                             |
| TikTok    | Direct Post and inbox upload for video, plus 1–35 image photo posts. App review and a live account test still apply.                        |
| YouTube   | Selected channel uploads for Shorts and videos with privacy, title, description, thumbnail, and playlist settings; comments and moderation. |

## Account-selection requirement

Some platforms need the user to choose an account after OAuth:

- Instagram connects the selected Instagram Business or Creator account behind a Facebook Page.
- YouTube connects the selected channel.

Instagram, Facebook, and YouTube use the backend account-selection flow today. TikTok uses a direct OAuth account flow and is connectable when configured; its current adapter supports video plus photo-post paths, subject to TikTok app access and live verification.

## What a new platform must include

Every platform needs the shared server connection before users can connect it:

- OAuth or app-password account connection.
- Token refresh behavior, when the provider supports refresh.
- Profile lookup for stable account identity, or account-selection support for page/channel providers.
- Media upload rules and validation.
- Publish behavior, including reply/thread semantics where available.
- Docs for callbacks, app review, media limits, and known API limits.

Until the code is ready, keep the platform in `status: "planned"` and do not accept it in `OPENPOST_PROVIDER_APPS`.
