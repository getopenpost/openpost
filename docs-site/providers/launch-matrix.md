# Launch Verification Matrix

Use this page before a public demo or campaign. Check these three facts separately:

1. **Implemented:** the adapter and OpenPost code path exist.
2. **Set up:** the current OpenPost server has the required social app, account, access, public media link, and API limit.
3. **Live-tested:** the exact account and format published in a recent test, and someone saved the result.

Finished code does not prove that a server is set up. A set-up server does not prove that a post went live. This page does not mark any platform as live-tested because the repository has no current test proof.

## Current evidence levels

| Platform               | Code status   | Server setup to confirm                                                                       | Live test recorded here | Public demo default                                                  |
| ---------------------- | ------------- | --------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| X                      | Ready in code | OAuth 1.0a app, callback, account tier, API limit, and connected account                      | None                    | Exclude until the exact account and format pass a live test          |
| Mastodon               | Ready in code | Server app or dynamic registration, connected account, and server limits                      | None                    | Exclude until the exact server, account, and format pass a live test |
| Bluesky                | Ready in code | Connected handle and app password; no server social app required                              | None                    | Exclude until the exact account and format pass a live test          |
| LinkedIn               | Ready in code | OAuth app, approved permissions, connected account, and LinkedIn access                       | None                    | Exclude until the exact account and format pass a live test          |
| Threads                | Ready in code | Meta app, approved permissions, connected account, and public HTTPS media when needed         | None                    | Exclude until the exact account and format pass a live test          |
| Facebook Pages         | Ready in code | Meta app review, Page permissions, connected Page, and public HTTPS media                     | None                    | Exclude until the exact Page and format pass a live test             |
| Instagram Professional | Ready in code | Meta app review, Page-backed Business or Creator account, permissions, and public HTTPS media | None                    | Exclude until the exact account and format pass a live test          |
| TikTok                 | Ready in code | Content Posting API access, Direct Post app review, connected account, and public HTTPS media | None                    | Exclude until the exact account and format pass a live test          |
| YouTube                | Ready in code | Google app, channel access, API limit, upload privacy, and connected account                  | None                    | Exclude until the exact channel and format pass a live test          |
| Discord Webhooks       | Ready in code | Tested channel webhook and its server upload limit                                            | None                    | Exclude until the exact webhook and files pass a live test           |

Check the running server for its current setup. Open **Accounts**, call `GET /api/v1/accounts/providers`, or use MCP `get_provider_readiness`. A platform shown as available or set up still needs a live test for the account and format.

## Posting paths that still need a live test

| Platform               | Current OpenPost paths                                                                        | What to check before a public claim                                           |
| ---------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| X                      | Tier-aware text, links, up to four images, one video, replies, scheduling                     | Video, API limits, and account tier need an exact live test                   |
| Mastodon               | Text, links, up to four attachments, replies, scheduling                                      | Limits vary by instance; verify media processing and reply behavior           |
| Bluesky                | Text, links, up to four images, one MP4 video, AT Protocol replies, scheduling                | Verify video and reply refs against the target account                        |
| LinkedIn               | Text, links, image, document, video, comment-based child posts, scheduling                    | Permissions, app review, and video behavior can block the path                |
| Threads                | Text, image, video, 2–10 item mixed carousels, replies, scheduling                            | Media must be publicly reachable and Meta access must be approved             |
| Facebook Pages         | Text, links, image, 2–10 image multi-photo, Story, video, comments, scheduling                | Permissions, review, Page identity, and public media apply                    |
| Instagram Professional | Image, carousel, Story, Reel, comments, scheduling                                            | No text-only posts; Business or Creator account and public media are required |
| TikTok                 | One video or 1–35 JPEG/WebP photo posts, scheduling                                           | Direct Post audit approval and public media apply                             |
| YouTube                | One Short or long video with title, description, thumbnail, playlist, privacy, and scheduling | Unaudited projects can force private uploads, and API limits apply            |
| Discord Webhooks       | Text, up to 10 streamed attachments, reply references, scheduling, and deletion               | The webhook URL is a credential; Discord controls upload byte limits          |

See [Supported Platforms & Limitations](/providers/platform-limits) for detailed limits and [Provider Troubleshooting](/providers/troubleshooting) for diagnostics.

## Live test log

Add one row for every account and format in the campaign. A text post test does not prove that video, carousel, Story, reply, or thread posting works.

| Platform     | Account ID or name | Format | Connect result | Media result | Schedule result | Final platform result | Published URL or error ID | Tested at | Tested by |
| ------------ | ------------------ | ------ | -------------- | ------------ | --------------- | --------------------- | ------------------------- | --------- | --------- |
| _Not tested_ |                    |        |                |              |                 |                       |                           |           |           |

## Launch gate

Include an account in the main demo only when:

- the server reports the platform set up;
- the intended account is connected and active;
- the exact text, media, thread/reply, and scheduling path needed by the campaign passed;
- OpenPost recorded the final provider outcome;
- the result has a date, account, format, and proof link;
- someone reviewed the account version after the final AI edit.

The repository's [platform test log](https://github.com/rodrgds/openpost/blob/main/launch-kit/provider-verification-log.md) is a reusable copy of this list.
