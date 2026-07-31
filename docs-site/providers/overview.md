# Platform Overview

OAuth and social app setup cause many connection errors. Use this guide as you turn on each network.

## Current social network connections

OpenPost supports these connections now. The Accounts page reads `GET /api/v1/accounts/providers` and shows which ones are ready on the current server.

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

Start with one network. Check that its callback works before you add another.

Working code and app keys do not prove that a real account can publish each post type. Use the [Launch Verification Matrix](/providers/launch-matrix) to record code, server setup, and live tests on their own.

Social app keys can come from older environment variables, `OPENPOST_PROVIDER_APPS` JSON, or encrypted `provider_apps` database rows managed through the instance-admin API. The web app does not have a page for these keys. Most self-hosted servers should use environment variables or `OPENPOST_PROVIDER_APPS`. Admin scripts can use the API.

Mastodon often needs this setup because each server can need its own app. People can still connect a public Mastodon server from Accounts when that server allows automatic app setup. For other OAuth networks, use these settings when you want to supply your own app keys.

OpenPost loads database rows at startup and uses them instead of matching environment or JSON values. Restart OpenPost after you change them.

If connection or publishing fails, use [Provider Troubleshooting](/providers/troubleshooting) to collect diagnostics and map common OAuth, permission, media URL, and publishing errors to the right fix.

## Support matrix

This matrix reflects current OpenPost support, not the full theoretical capability of each provider API.

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

See [Analytics](/usage/analytics) for collection timing, metric definitions, reconnect requirements, and provider-specific coverage.
