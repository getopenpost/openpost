# Provider Overview

OAuth and provider app setup are the most common source of deployment friction. Use this section when you are enabling networks one by one.

## Current provider apps

These providers have adapter code in OpenPost today. The Accounts page discovers them through `GET /api/v1/accounts/providers` and shows whether each one is ready to connect on the current server.

| Provider  | Auth method            | Server setup                                    | Status       | Notes                                                                      |
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

Start with one provider, confirm the callback works, then expand.

For launch or demo claims, do not treat adapter code or a configured provider app as proof that an exact account and format published successfully. Use the [Launch Verification Matrix](/providers/launch-matrix) to record implementation, runtime configuration, and live verification separately.

Provider app credentials can come from legacy env vars, `OPENPOST_PROVIDER_APPS` JSON, or active encrypted `provider_apps` database rows managed through the instance-admin provider app API. The current web settings UI does not expose Provider Apps management, so self-hosted operators should normally use env vars or `OPENPOST_PROVIDER_APPS`; scripted/admin deployments can use the API.

Mastodon is the most common reason to use Provider Apps because each instance can need its own app registration. Users can still connect public custom Mastodon instances from the Accounts screen when dynamic registration is available. For other OAuth providers, Provider Apps are mainly for operators who want to bring their own keys instead of relying on hosted/default credentials.

Database rows are loaded at startup and override matching env/JSON entries, so operator-managed changes require a restart until hot reload exists.

If connection or publishing fails, use [Provider Troubleshooting](/providers/troubleshooting) to collect diagnostics and map common OAuth, permission, media URL, and publishing errors to the right fix.

## Support matrix

This matrix reflects current OpenPost support, not the full theoretical capability of each provider API.

| Provider  | Text posts | Image posts | Threads / replies                | Scheduled posts | Video posts                                                           | Platform-specific variants | Analytics                                 |
| --------- | ---------- | ----------- | -------------------------------- | --------------- | --------------------------------------------------------------------- | -------------------------- | ----------------------------------------- |
| X         | Yes        | Yes         | Yes                              | Yes             | Partial, needs real-account verification                              | Yes                        | Account and post counters                 |
| Mastodon  | Yes        | Yes         | Yes                              | Yes             | Partial, needs real-account verification                              | Yes                        | Account and post counters                 |
| Bluesky   | Yes        | Yes         | Yes                              | Yes             | Partial, one MP4 path implemented and needs real-account verification | Yes                        | Account and post counters                 |
| LinkedIn  | Yes        | Yes         | Partial, implemented as comments | Yes             | Partial, implementation exists and needs re-verification              | Yes                        | Not for personal connections              |
| Threads   | Yes        | Yes         | Yes                              | Yes             | Partial, public-media deployment dependent                            | Yes                        | Requires insights permission              |
| Facebook  | Yes        | Yes         | Yes, via Page comments           | Yes             | Partial, public HTTPS video and Story paths implemented               | Yes                        | Page and post counters                    |
| Instagram | No         | Yes         | Yes, via comments                | Yes             | Partial, public HTTPS carousel, Story, and Reel paths implemented     | Yes                        | Requires insights permission              |
| TikTok    | No         | Yes         | No                               | Yes             | Partial, public HTTPS video and photo-post paths implemented          | Yes                        | Requires stats and video-list permissions |
| YouTube   | No         | No          | No                               | Yes             | Partial, one video upload path with privacy settings implemented      | Yes                        | Channel and video counters                |

## Provider-specific caveats

- **X:** Requires an X developer app with OAuth 1.0a user auth enabled and matching callback URLs.
- **Mastodon:** Setup is per instance. Custom public instances can be entered from Accounts; operator-pinned instances can use `MASTODON_SERVERS`, `OPENPOST_PROVIDER_APPS`, or the instance-admin provider app API.
- **Bluesky:** Uses handle plus app password. No server-side OAuth app is required.
- **LinkedIn:** Permissions and app review can block some publishing or reply workflows even when the integration code is present.
- **Threads:** Media must be reachable at a public `OPENPOST_MEDIA_URL`, and Meta fetches those files server-side.
- **Facebook:** Configure through the provider app registry with provider `facebook`. The adapter connects a selected Page and supports text, one image or video, multi-photo posts with 2–10 images, Stories, and Page comment replies. Media must use public HTTPS URLs.
- **Instagram:** Configure through the provider app registry with provider `instagram`. The adapter connects a selected Instagram Business or Creator account behind a Facebook Page and implements single-image, carousel, Story, Reel, and comment-reply paths. Provider access and live verification still apply.
- **TikTok:** Configure through the provider app registry with provider `tiktok`. The adapter implements direct and inbox video paths plus photo posts using public HTTPS media. App review and live verification still apply.
- **YouTube:** Configure through the provider app registry with provider `youtube`. The adapter connects a selected channel and uploads one video with privacy, metadata, thumbnail, and playlist settings. Live verification is still recommended.

Provider API policies, scopes, rate limits, and review requirements can change. Re-check provider docs if a previously working flow starts failing.

See [Analytics](/usage/analytics) for collection timing, metric definitions, reconnect requirements, and provider-specific coverage.
