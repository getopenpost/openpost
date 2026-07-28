# Destination Options

The composer separates what you intend to publish from the output each provider creates.

- **Intent** is Post, Thread, Story, Short video, or Video.
- **Content shape** is text, link, image, multiple images, mixed media, document, or video.
- **Output** is provider-qualified, such as `instagram.carousel`, `linkedin.document`, `tiktok.photo`, or `youtube.short`.
- **Settings** apply to a destination, one segment, or one media item.

Open the cog beside a selected account to edit its content override and supported settings. Sections appear only when relevant: Content, Conversation, Distribution, Disclosure, and Media and accessibility.

## Settings by scope

| Scope       | Applies to                              | Examples                                                |
| ----------- | --------------------------------------- | ------------------------------------------------------- |
| Destination | The selected connected account          | Privacy, visibility, playlist, category, reply audience |
| Segment     | One post in a thread or follow-up chain | Poll, poll duration, first comment                      |
| Media item  | One attached image or video             | Alt text, tagged users, product tags, focal point       |

Settings are not silently removed when content changes. A conflict stays visible until you remove the setting or the conflicting content.

## Provider coverage

| Provider               | Resolved outputs                                                            | Destination options                                                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X                      | Post, link, images, video, thread                                           | Poll, reply audience, community and location when granted, paid-partnership and AI disclosures, tagged users, and alt text. Quote publishing remains unavailable without X Enterprise access.                                                                     |
| Mastodon               | Post, link, media, video, thread                                            | Instance-derived text, media, and poll limits; visibility; content warning; sensitive media; language; poll controls; alt text; and focal point. Quote and interaction policy controls remain unavailable until the instance advertises compatible support.       |
| Bluesky                | Post, link card, images, video, thread                                      | Reply and thread gates, languages, self-labels, quote URL, link-card metadata, and image alt text. OpenPost resolves handles and AT Protocol record identifiers internally.                                                                                       |
| LinkedIn               | Post, article, image, multi-image, document, video, poll, root plus comment | Visibility, reshare control, article metadata, document title, image alt text, poll controls, and a first comment. Thumbnail and caption upload stay unavailable in this publishing flow.                                                                         |
| Facebook Pages         | Text, link, photo, multi-photo, video, Reel, Story                          | Link and video metadata, Reel feed sharing, and a first comment. Page polls are not exposed. Text-background presets and thumbnails remain unavailable until the Page API returns a supported creation path.                                                      |
| Instagram Professional | Feed image, carousel, Reel, Story                                           | Collaborators, location, per-image people tags, alt text, Reel cover or frame, share to feed, and eligible trial-Reel controls. Product tags stay account-capability gated.                                                                                       |
| Threads                | Post, link, image, video, carousel, thread                                  | Poll, reply control, topic, location, media spoiler, link attachment, long-form text attachment, and account-gated ghost posts and reply approvals. GIF publishing is implemented but its picker remains unavailable until a GIPHY search provider is configured. |
| YouTube                | Short, Video                                                                | Required title, category, and privacy; description; tags; playlist; thumbnail; captions and language; license; embedding; child-directed, synthetic-media, and paid-placement disclosures; and subscriber notification.                                           |
| TikTok                 | Video, photo post                                                           | Direct Post or inbox upload, live privacy and interaction choices, photo title and cover, auto-music, video cover frame, branded and organic disclosures, music consent, and video AI disclosure. Privacy is required only for Direct Post.                       |

## Dynamic account data

OpenPost refreshes account-specific choices before scheduling and publishing:

- TikTok creator state expires after 5 minutes.
- YouTube playlists and categories expire after 15 minutes.
- Mastodon instance configuration expires after 1 hour.

Authentication and permission failures are never cached as successful results. If a required collection cannot load, the destination panel shows a retry action and publishing remains blocked. Optional collection failures appear as warnings.

## Compatibility

YouTube accepts only Short video and Video. Multiple images are resolved from Post rather than a separate carousel intent. A video attached to Post requires Short video or Video. Provider approval, permissions, account type, quota, and public-media URL requirements can still make an otherwise valid output unavailable.
