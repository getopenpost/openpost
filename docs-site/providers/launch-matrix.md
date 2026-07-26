# Launch Verification Matrix

Use this page before a public demo or campaign. It separates three claims that are easy to confuse:

1. **Implemented:** the adapter and OpenPost code path exist.
2. **Configured:** the current OpenPost instance has the required provider app, account, permission, public-media, and quota state.
3. **Live-verified:** the exact account and format completed a recent end-to-end publish, and the result was recorded.

Implementation does not prove configuration. Configuration does not prove publication. This documentation snapshot deliberately does not mark any provider as live-verified because the repository does not contain current launch rehearsal evidence.

## Current evidence levels

| Provider | Repository status | Runtime configuration to confirm | Live verification recorded here | Public demo default |
| --- | --- | --- | --- | --- |
| X | Implemented launch adapter | OAuth 1.0a app, callback, account tier, quota, and connected account | None | Exclude until the exact account and format pass rehearsal |
| Mastodon | Implemented launch adapter | Instance app or dynamic registration, connected account, and instance limits | None | Exclude until the exact instance, account, and format pass rehearsal |
| Bluesky | Implemented launch adapter | Connected handle and app password; no server provider app required | None | Exclude until the exact account and format pass rehearsal |
| LinkedIn | Implemented launch adapter | OAuth app, approved permissions, connected account, and provider access | None | Exclude until the exact account and format pass rehearsal |
| Threads | Implemented launch adapter | Meta app, approved scopes, connected account, and public HTTPS media when needed | None | Exclude until the exact account and format pass rehearsal |
| Facebook Pages | Preview adapter | Meta app review, Page permissions, connected Page, and public HTTPS media | None | Keep out of the main launch demo |
| Instagram Professional | Preview adapter | Meta app review, Page-backed professional account, scopes, and public HTTPS media | None | Keep out of the main launch demo |
| TikTok | Preview adapter | Content Posting API access, Direct Post audit approval, connected account, and public HTTPS media | None | Keep out of the main launch demo |
| YouTube | Preview adapter | Google app, channel access, quota, upload privacy, and connected account | None | Keep out of the main launch demo |

The running instance is the source of truth for configuration. Inspect **Accounts**, call `GET /api/v1/accounts/providers`, or use MCP `get_provider_readiness`. A provider shown as available or configured still needs a live rehearsal for the launch account and format.

## Implemented paths that still need proof

| Provider | Current OpenPost paths | Main caveat before a launch claim |
| --- | --- | --- |
| X | Tier-aware text, links, up to four images, one video, replies, scheduling | Video, quota, and account tier need exact live verification |
| Mastodon | Text, links, up to four attachments, replies, scheduling | Limits vary by instance; verify media processing and reply behavior |
| Bluesky | Text, links, up to four images, one MP4 video, AT Protocol replies, scheduling | Verify video and reply refs against the target account |
| LinkedIn | Text, links, image, document, video, comment-based child posts, scheduling | Permissions, app review, and video behavior can block the path |
| Threads | Text, image, video, 2–10 item mixed carousels, replies, scheduling | Media must be publicly reachable and Meta access must be approved |
| Facebook Pages | Text, links, image, 2–10 image multi-photo, Story, video, comments, scheduling | Preview only; permissions, review, Page identity, and public media apply |
| Instagram Professional | Image, carousel, Story, Reel, comments, scheduling | Preview only; no text-only posts and public media is required |
| TikTok | One video or 1–35 JPEG/WebP photo posts, scheduling | Preview only; Direct Post audit approval and public media apply |
| YouTube | One Short or long-form video with metadata, thumbnail, playlist, privacy, and scheduling | Preview only; unaudited projects can force private uploads, and quota applies |

See [Supported Platforms & Limitations](/providers/platform-limits) for detailed limits and [Provider Troubleshooting](/providers/troubleshooting) for diagnostics.

## Per-provider rehearsal log

Create one row for every account and format used in the campaign. Do not use one text-post result to mark video, carousel, Story, reply, or thread paths verified.

| Provider | Account ID or slug | Format | Connect result | Media result | Schedule result | Final provider result | Published URL or failure ID | Verified at | Verified by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _Not tested_ |  |  |  |  |  |  |  |  |  |

## Launch gate

Include a destination in the main demo only when:

- the instance reports the provider configured;
- the intended account is connected and active;
- the exact text, media, thread/reply, and scheduling path needed by the campaign passed;
- OpenPost recorded the final provider outcome;
- the result has a date, account, format, and evidence link;
- the rendition was reviewed after the final agent edit.

The repository's [provider verification log](https://github.com/rodrgds/openpost/blob/main/launch-kit/provider-verification-log.md) is a reusable copy of this evidence gate.
