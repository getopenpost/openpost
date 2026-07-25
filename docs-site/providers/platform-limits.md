# Supported Platforms & Limitations

OpenPost has implemented capability-resolved publishing for X, Mastodon, Bluesky, Threads, LinkedIn, Facebook Pages, Instagram Professional accounts, TikTok, and YouTube. Some providers still require app review, account eligibility, public media URLs, or live-account verification.

Provider-native API capabilities are not the same as production-ready OpenPost support. The table below reflects the current implementation state, including paths that still need provider approval, deployment configuration, or real-account verification.

## Current Platform Support

| Provider  | Text      | Images                                     | Video                                                                                          | Threading                                                | Scheduling | Variants  |
| --------- | --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------- | --------- |
| X         | Supported | Up to 4 images                             | Implemented, real-account verification still required                                          | Replies                                                  | Supported  | Supported |
| Mastodon  | Supported | Up to 4 attachments                        | Implemented through media upload + publish flow, real-account verification still required      | Replies                                                  | Supported  | Supported |
| Bluesky   | Supported | Up to 4 images                             | Implemented for one MP4 video via `app.bsky.video.*`, real-account verification still required | AT Protocol reply refs                                   | Supported  | Supported |
| LinkedIn  | Supported | One image, 2-20 images, or a document      | Implemented, with live-account verification still recommended                                  | Thread children are posted as comments                   | Supported  | Supported |
| Threads   | Supported | One image or a 2-10 item carousel          | One video or mixed carousel with public HTTPS media                                            | `reply_to_id`                                            | Supported  | Supported |
| Facebook  | Supported | One image or a 2-10 image multi-photo post | One public HTTPS video URL; Story publishing accepts exactly one image or video                | Comment replies                                          | Preview    | Supported |
| Instagram | No        | Single image and carousel paths            | Implemented for Reels, needs live-account verification                                         | Comment replies/story paths exist for supported settings | Preview    | Supported |
| TikTok    | No        | 1-35 JPEG/WebP photos, up to 20 MB each    | Direct Post and inbox/upload video paths implemented, needs live-account verification          | No                                                       | Audit gate | Supported |
| YouTube   | No        | Thumbnail only                             | Short and Video uploads with explicit privacy, category, and metadata; needs live verification | No                                                       | Audit gate | Supported |

## Planned Platform Adapters

No planned provider adapter is exposed as connectable today. Future provider roadmap items should stay `status: "planned"` until the backend adapter, UI, docs, and tests land together.

## Known Limitations

- **Video support is uneven** — implementation exists across multiple providers, but support is still provider-dependent and some paths need end-to-end verification with real accounts.
- **TikTok and YouTube remain audit-gated** — their publishing code paths exist, but OpenPost currently returns a provider-audit readiness error. The adapters are not production-ready until that gate can be cleared and both providers are verified.
- **Capability gates are deliberate** — account-, permission-, review-, partner-, or provider-search-gated controls remain unavailable with a reason until OpenPost can verify access.
- **Planned providers are discovery-only** — adding a future provider to provider app config fails until its adapter is implemented.
- **Provider APIs can change** — social platforms may change their APIs, rate limits, or app review requirements at any time
- **OAuth tokens require HTTPS** — callbacks need a valid domain with TLS for OAuth to work

## Reading this table correctly

- A provider can support a feature natively while OpenPost still marks it unsupported or unverified.
- "Implemented" means the code path exists in OpenPost.
- "Verified" means the implementation has been confirmed against a live provider account recently.
- Deployment details still matter. Threads, Facebook, Instagram, and TikTok direct-post flows depend on public media URLs, and LinkedIn depends heavily on granted app permissions.

These limits are a starting point, not a permanent contract. Providers can change them.

See [Destination Options](/usage/destination-options) for the implemented output and settings matrix.
