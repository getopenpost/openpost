---
description: Compare provider setup, implemented formats, account requirements, limits, and live-verification needs.
---

# Providers

OAuth and social app setup cause many connection errors. Use this guide as you turn on each network.

## Current social network connections

The table below is an implementation and setup inventory. It is not a Hosted service readiness claim. The Accounts page reads `GET /api/v1/accounts/providers`, which now uses the same evidence-based projection as scheduling and the publisher instead of treating adapter registration as availability.

| Network   | Sign-in method         | Server setup                                    | Status       | Notes                                                                      |
| --------- | ---------------------- | ----------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| Bluesky   | App password           | None                                            | Built-in     | Users connect with handle + app password.                                  |
| X         | OAuth 1.0a             | Client ID + secret                              | Configurable | Requires an X developer app with OAuth 1.0a user auth enabled.             |
| Mastodon  | OAuth 2.0 per instance | Dynamic registration or `MASTODON_SERVERS` JSON | Configurable | One app per instance, unless dynamic registration is enabled.              |
| LinkedIn  | OAuth 2.0              | Client ID + secret                              | Configurable | Replies may need extra approval.                                           |
| Threads   | Meta OAuth             | Client ID + secret + redirect URI               | Configurable | Public media URL required.                                                 |
| Facebook  | Meta OAuth             | Provider app registry                           | Configurable | Pages only; public HTTPS media required.                                   |
| Instagram | Meta OAuth             | Provider app registry                           | Configurable | Business or Creator account; public media URL required.                    |
| TikTok    | OAuth 2.0              | Provider app registry                           | Configurable | Video and photo paths; provider approval and public media required.        |
| YouTube   | Google OAuth           | Provider app registry                           | Configurable | One-video upload with configurable privacy; live verification recommended. |
| Discord   | Incoming webhook       | None                                            | Built-in     | Users connect a webhook URL; text and streamed attachments are supported.  |

Start with one network. Check that its callback works before you add another. A configured app may still need approval, a valid account grant, current local and live proof, an allowed policy mode, and an enabled runtime control.

Working code and app keys do not prove that a real account can publish each post type. Use the [Provider Readiness and Launch Gate](/operations/provider-launch-matrix) to inspect the mechanically enforced evidence model.

<!-- provider-certification:begin -->

The checked-in public certification manifest contains **0 exact provider-format claims**.

No Hosted service provider-format certification claim is current. Implementation descriptions do not assert Hosted service availability.
<!-- provider-certification:end -->

Social app keys can come from older environment variables, `OPENPOST_PROVIDER_APPS` JSON, or encrypted rows managed in **Settings → Instance → Configuration → Provider apps**. Environment-defined apps are read-only in the interface and win over matching database rows. Matching database fallbacks remain visible and can be deleted while the environment app stays active.

Mastodon often needs this setup because each server can need its own app. People can still connect a public Mastodon server from Accounts when that server allows automatic app setup. For other OAuth networks, use these settings when you want to supply your own app keys.

OpenPost loads the effective registry at startup. Restart OpenPost after you change a provider app.

If connection or publishing fails, use [Provider Troubleshooting](/providers/troubleshooting) to collect diagnostics and map common OAuth, permission, media URL, and publishing errors to the right fix.

## Support matrix

This matrix reflects implemented OpenPost code paths, not the full theoretical capability of each provider API and not current Hosted service certification.

| Platform  | Text posts | Image posts | Threads / replies           | Scheduled posts | Video posts                                                     | Account versions | Analytics                                            |
| --------- | ---------- | ----------- | --------------------------- | --------------- | --------------------------------------------------------------- | ---------------- | ---------------------------------------------------- |
| X         | Yes        | Yes         | Yes                         | Yes             | Yes; account tier and API limits set the rules                  | Yes              | Account and post numbers                             |
| Mastodon  | Yes        | Yes         | Yes                         | Yes             | Yes; the server sets its limits                                 | Yes              | Account and post numbers                             |
| Bluesky   | Yes        | Yes         | Yes                         | Yes             | One MP4 up to 100 MB                                            | Yes              | Account and post numbers                             |
| LinkedIn  | Yes        | Yes         | Child posts become comments | Yes             | One MP4 from 3 seconds to 30 minutes, up to 500 MiB             | Yes              | Profiles and Organization Pages with approved access |
| Threads   | Yes        | Yes         | Yes                         | Yes             | One video or a mixed carousel; public media links are required  | Yes              | Requires insights permission                         |
| Facebook  | Yes        | Yes         | Page comment replies        | Yes             | Public video links, Stories, Reels, and long videos             | Yes              | Page and post numbers                                |
| Instagram | No         | Yes         | Comment replies             | Yes             | Reels, Stories, and carousels; public media links are required  | Yes              | Requires insights permission                         |
| TikTok    | No         | Yes         | No                          | Yes             | One video or 1–35 photos; app review may be required            | Yes              | Requires stats and video-list permissions            |
| YouTube   | No         | No          | Comment replies             | Yes             | One Short or video with title, description, and privacy options | Yes              | Channel and video numbers                            |
| Discord   | Yes        | Yes         | Reply links between parts   | Yes             | Yes, within the webhook's file-size limit                       | Yes              | No analytics                                         |

Direct messages, Comments and replies, Analytics, and Grow are optional and per connected account. Each feature starts off for a newly connected account. Enable supported features after connection or in Account details. Disabling a feature stops future provider reads and writes without deleting stored history or revoking provider authorization. Availability depends on provider support, required scopes, and plan access as distinct facts. Grow never follows automatically. Existing accounts keep their current behavior after upgrade. Use each provider page to see which optional features that provider supports.

Grow discovery and follow are available only for Bluesky and Mastodon. Inbox Direct messages are available for X, Bluesky, Facebook Pages, Instagram Professional accounts, and Mastodon. Engagement Comments and replies are available for X, Mastodon, Bluesky, LinkedIn, Threads, Facebook Pages, Instagram, and YouTube. Analytics is available for X, Mastodon, Bluesky, LinkedIn, Threads, Facebook, Instagram, TikTok, and YouTube. Discord webhooks support none of these optional features.

## Implementation limits

Use this table when checking implemented formats and safe provider limits. An implementation is not a Hosted service certification claim. App review, the right account type, public media links, runtime controls, and current local and live tests remain separate gates. Limits were reviewed against official provider documentation on 2026-08-03. Connected-account or instance limits override these safe defaults where OpenPost can resolve them.

| Provider         | Text implementation                                   | Image implementation                              | Video implementation                                                                                                 | Threading implementation                                 | Scheduling  | Variants    |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------- | ----------- |
| X                | 280 standard or 25,000 subscribed weighted characters | Up to 4 images                                    | One video; 140 seconds/512 MiB standard or 4 hours/16 GiB subscribed; real-account verification still required       | Replies                                                  | Implemented | Implemented |
| Mastodon          | Implemented                                           | Up to 4 attachments                               | MP4, MOV, or WebM under a safe 99 MiB default; connected instances can advertise their actual formats and size limit | Replies                                                  | Implemented | Implemented |
| Bluesky           | Implemented                                           | Up to 4 images                                    | One MP4 video via `app.bsky.video.*`; real-account verification still required                                       | AT Protocol reply refs                                   | Implemented | Implemented |
| LinkedIn          | Implemented                                           | One JPG/PNG/GIF image, 2-20 images, or a document | One MP4, 3 seconds to 30 minutes and up to 500 MiB; live-account verification is still recommended                   | Thread children are posted as comments                   | Implemented | Implemented |
| Threads           | Implemented                                           | One image or a 2-20 item carousel                 | One video or mixed carousel with public HTTPS media                                                                  | `reply_to_id`                                            | Implemented | Implemented |
| Facebook          | Implemented                                           | One image or a 2-10 image multi-photo post        | One public HTTPS video URL; Story publishing accepts exactly one image or video                                      | Comment replies                                          | Implemented | Implemented |
| Instagram         | No text-only path                                     | Single image and carousel paths                   | Reels for Business and Creator accounts; live-account verification is still recommended                              | Comment replies and Story paths for implemented settings | Implemented | Implemented |
| TikTok            | No text-only path                                     | 1-35 JPEG/WebP photos, up to 20 MB each           | One MP4 or MOV up to 10 minutes and 4 GB through Direct Post or inbox/upload; app review still applies               | No threading path                                        | Implemented | Implemented |
| YouTube           | No text-only path                                     | Thumbnail only                                    | Short and Video uploads with privacy, category, title, description, and resumable upload                             | Comment replies and moderation                           | Implemented | Implemented |
| Discord Webhooks  | Implemented                                           | Up to 10 file attachments                         | MP4, MOV, or WebM; OpenPost uses Discord's safe 10 MiB default because the actual limit can vary                     | Reply references between segments                        | Implemented | Implemented |

## Known limitations

- **Video support is uneven:** implementation exists across multiple providers, but support is still provider-dependent and some paths need end-to-end verification with real accounts.
- **TikTok and YouTube have provider gates:** TikTok Direct Post requires app audit approval, while unaudited Google projects can force YouTube uploads to private. Verify each production account and format before relying on either integration.
- **OpenPost hides actions an account cannot use:** the app explains when an account, permission, review, partner, or platform search requirement blocks a control.
- **X limits are resolved per account:** Basic, Premium, and Premium+ accounts use subscribed text and video limits when X verifies the tier. Unknown or stale tiers use standard limits.
- **Social APIs can change:** platforms may change their APIs, limits, or app review rules at any time.
- **OAuth tokens require HTTPS:** callbacks need a valid domain with TLS for OAuth to work.

A platform can offer a feature while OpenPost still marks its implementation missing or untested. "Implemented" means the code path exists in OpenPost. "Verified" means the implementation has been confirmed against a live provider account recently. Deployment details still matter. Threads, Facebook, Instagram, and TikTok direct-post flows depend on public media URLs, and LinkedIn depends heavily on granted app permissions.

## Notes for each network

- **X:** Requires an X developer app with OAuth 1.0a user auth enabled and matching callback URLs.
- **Mastodon:** Setup is per instance. Custom public instances can be entered from Accounts; operator-pinned instances can use `MASTODON_SERVERS`, `OPENPOST_PROVIDER_APPS`, or the instance-admin provider app API.
- **Bluesky:** Uses handle plus app password. No server-side OAuth app is required.
- **LinkedIn:** Permissions and app review can block some posts or replies even when OpenPost supports them.
- **Threads:** Media must be reachable at a public `OPENPOST_MEDIA_URL`, and Meta fetches those files server-side.
- **Facebook:** Use provider key `facebook`. OpenPost connects a selected Page and supports text, one image or video, photo posts with 2–10 images, Stories, and Page comment replies. Media must use public HTTPS links.
- **Instagram:** Use provider key `instagram`. OpenPost connects a selected Business or Creator account linked to a Facebook Page. It supports one image, carousels, Stories, Reels, and comment replies. Account access and live tests still apply.
- **TikTok:** Use provider key `tiktok`. OpenPost supports direct and inbox video uploads plus photo posts through public HTTPS media links. App review and live tests still apply.
- **YouTube:** Use provider key `youtube`. OpenPost connects a selected channel, uploads one video with privacy, title, description, thumbnail, and playlist settings, and supports comment replies and moderation. Test a live channel before you rely on it.
- **Discord:** Connect an incoming webhook URL directly. OpenPost streams attachments and uses a safe 10 MiB file limit because Discord's actual limit can vary by server and account.

Social network API rules, access, request limits, and app review can change. Check that network's docs if a feature stops working.

See [Analytics](/usage/analytics) for collection timing, metric definitions, reconnect requirements, and provider-specific coverage. See [Accounts](/usage/accounts), [Engagement, Inbox, and Notifications](/usage/communications), and [Grow](/usage/grow) for the per-account optional feature model.

Native auto reposts are currently available for X, Mastodon, Bluesky, and LinkedIn. OpenPost reposts only within the source network; it never turns a repost into a copied post on another network. See [Auto Reposts](/usage/auto-reposts) for rule and account-access details.
