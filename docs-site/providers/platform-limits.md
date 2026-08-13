# Platform Implementations & Limitations

OpenPost includes publishing implementations for X, Mastodon, Bluesky, Threads, LinkedIn, Facebook Pages, Instagram Professional accounts, TikTok, YouTube, and Discord webhooks. An implementation is not a managed-service certification claim. App review, the right account type, public media links, runtime controls, and current local and live tests remain separate gates.

A social network may offer a feature that OpenPost has not implemented. The table describes current code paths and where an app review, server setting, or live account test still matters.

Limits reviewed against official provider documentation on 2026-08-03. Connected-account or instance limits override these safe defaults where OpenPost can resolve them.

## Managed certification projection

<!-- provider-certification:begin -->
The checked-in public certification manifest contains **0 exact provider-format claims**.

No managed provider-format certification claim is current. Implementation descriptions do not assert managed availability.
<!-- provider-certification:end -->

## Current implementations

| Provider         | Text implementation                                  | Image implementation                              | Video implementation                                                                                                 | Threading implementation                                   | Scheduling | Variants    |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- | ----------- |
| X                | 280 standard or 25,000 subscribed weighted characters | Up to 4 images                                    | One video; 140 seconds/512 MiB standard or 4 hours/16 GiB subscribed; real-account verification still required       | Replies                                                    | Implemented | Implemented |
| Mastodon         | Implemented                                          | Up to 4 attachments                               | MP4, MOV, or WebM under a safe 99 MiB default; connected instances can advertise their actual formats and size limit | Replies                                                    | Implemented | Implemented |
| Bluesky          | Implemented                                          | Up to 4 images                                    | One MP4 video via `app.bsky.video.*`; real-account verification still required                                      | AT Protocol reply refs                                     | Implemented | Implemented |
| LinkedIn         | Implemented                                          | One JPG/PNG/GIF image, 2-20 images, or a document | One MP4, 3 seconds to 30 minutes and up to 500 MiB; live-account verification is still recommended                   | Thread children are posted as comments                     | Implemented | Implemented |
| Threads          | Implemented                                          | One image or a 2-20 item carousel                 | One video or mixed carousel with public HTTPS media                                                                  | `reply_to_id`                                              | Implemented | Implemented |
| Facebook         | Implemented                                          | One image or a 2-10 image multi-photo post        | One public HTTPS video URL; Story publishing accepts exactly one image or video                                      | Comment replies                                            | Implemented | Implemented |
| Instagram        | No text-only path                                    | Single image and carousel paths                   | Reels for Business and Creator accounts; live-account verification is still recommended                              | Comment replies and Story paths for implemented settings   | Implemented | Implemented |
| TikTok           | No text-only path                                    | 1-35 JPEG/WebP photos, up to 20 MB each           | One MP4 or MOV up to 10 minutes and 4 GB through Direct Post or inbox/upload; app review still applies               | No threading path                                          | Implemented | Implemented |
| YouTube          | No text-only path                                    | Thumbnail only                                    | Short and Video uploads with privacy, category, title, description, and resumable upload                             | Comment replies and moderation                             | Implemented | Implemented |
| Discord Webhooks | Implemented                                          | Up to 10 file attachments                         | MP4, MOV, or WebM; OpenPost uses Discord's safe 10 MiB default because the actual limit can vary                     | Reply references between segments                          | Implemented | Implemented |

## Planned Platform Adapters

No planned provider adapter is exposed as connectable today. Future provider roadmap items should stay `status: "planned"` until the backend adapter, UI, docs, and tests land together.

## Known Limitations

- **Video support is uneven** — implementation exists across multiple providers, but support is still provider-dependent and some paths need end-to-end verification with real accounts.
- **TikTok and YouTube have provider gates** — TikTok Direct Post requires app audit approval, while unaudited Google projects can force YouTube uploads to private. Verify each production account and format before relying on either integration.
- **OpenPost hides actions an account cannot use** — the app explains when an account, permission, review, partner, or platform search requirement blocks a control.
- **X limits are resolved per account** — Basic, Premium, and Premium+ accounts use subscribed text and video limits when X verifies the tier. Unknown or stale tiers use standard limits.
- **Planned platforms cannot connect** — adding a future platform to app settings fails until its connection code is ready.
- **Social APIs can change** — platforms may change their APIs, limits, or app review rules at any time.
- **OAuth tokens require HTTPS** — callbacks need a valid domain with TLS for OAuth to work.

## Reading this table correctly

- A platform can offer a feature while OpenPost still marks its implementation missing or untested.
- "Implemented" means the code path exists in OpenPost.
- "Verified" means the implementation has been confirmed against a live provider account recently.
- Deployment details still matter. Threads, Facebook, Instagram, and TikTok direct-post flows depend on public media URLs, and LinkedIn depends heavily on granted app permissions.

Platforms can change these limits.

See [Account Options](/usage/destination-options) for the formats and settings each social network supports.
