# Supported Platforms & Limitations

OpenPost can publish to X, Mastodon, Bluesky, Threads, LinkedIn, Facebook Pages, Instagram Professional accounts, TikTok, YouTube, and Discord webhooks. Some platforms still require app review, the right account type, public media links, or a live test.

A social network may offer a feature that OpenPost does not yet support. The table shows what OpenPost supports now and where an app review, server setting, or live account test still matters.

## Current Platform Support

| Provider         | Text                                                  | Images                                     | Video                                                                                                                | Threading                                                | Scheduling | Variants  |
| ---------------- | ----------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------- | --------- |
| X                | 280 standard or 25,000 subscribed weighted characters | Up to 4 images                             | One video; 140 seconds/512 MiB standard or 4 hours/16 GiB subscribed; real-account verification still required       | Replies                                                  | Supported  | Supported |
| Mastodon         | Supported                                             | Up to 4 attachments                        | MP4, MOV, or WebM under a safe 99 MiB default; connected instances can advertise their actual formats and size limit | Replies                                                  | Supported  | Supported |
| Bluesky          | Supported                                             | Up to 4 images                             | Implemented for one MP4 video via `app.bsky.video.*`, real-account verification still required                       | AT Protocol reply refs                                   | Supported  | Supported |
| LinkedIn         | Supported                                             | One image, 2-20 images, or a document      | One MP4, 3 seconds to 30 minutes and up to 500 MiB; live-account verification is still recommended                   | Thread children are posted as comments                   | Supported  | Supported |
| Threads          | Supported                                             | One image or a 2-10 item carousel          | One video or mixed carousel with public HTTPS media                                                                  | `reply_to_id`                                            | Supported  | Supported |
| Facebook         | Supported                                             | One image or a 2-10 image multi-photo post | One public HTTPS video URL; Story publishing accepts exactly one image or video                                      | Comment replies                                          | Supported  | Supported |
| Instagram        | No                                                    | Single image and carousel paths            | Reels for Business and Creator accounts; live-account verification is still recommended                              | Comment replies/story paths exist for supported settings | Supported  | Supported |
| TikTok           | No                                                    | 1-35 JPEG/WebP photos, up to 20 MB each    | One MP4 or MOV up to 10 minutes and 4 GB through Direct Post or inbox/upload; app review still applies               | No                                                       | Supported  | Supported |
| YouTube          | No                                                    | Thumbnail only                             | Short and Video uploads with privacy, category, title, description, and resumable upload                             | Comment replies and moderation                           | Supported  | Supported |
| Discord Webhooks | Supported                                             | Up to 10 file attachments                  | MP4, MOV, or WebM; OpenPost uses Discord's safe 10 MiB default because the actual limit can vary                     | Reply references between segments                        | Supported  | Supported |

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

- A platform can support a feature while OpenPost still marks it unsupported or untested.
- "Implemented" means the code path exists in OpenPost.
- "Verified" means the implementation has been confirmed against a live provider account recently.
- Deployment details still matter. Threads, Facebook, Instagram, and TikTok direct-post flows depend on public media URLs, and LinkedIn depends heavily on granted app permissions.

Platforms can change these limits.

See [Account Options](/usage/destination-options) for the formats and settings each social network supports.
