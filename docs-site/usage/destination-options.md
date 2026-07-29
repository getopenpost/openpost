# Destination Options

The editor starts with the kind of post you want to make, then finds the right format for each platform.

- **Intent** is Post, Thread, Story, Short video, or Video.
- **Content shape** is text, link, image, multiple images, mixed media, document, or video.
- **Output** is the exact platform format, such as `instagram.carousel`, `linkedin.document`, `tiktok.photo`, or `youtube.short`.
- **Settings** apply to one account, one thread part, or one media item.

Open the settings beside a selected account to change its text and options. OpenPost only shows sections that apply: Content, Conversation, Distribution, Disclosure, and Media and accessibility.

## Settings by scope

| Scope       | Applies to                              | Examples                                                |
| ----------- | --------------------------------------- | ------------------------------------------------------- |
| Account     | The selected connected account          | Privacy, visibility, playlist, category, reply audience |
| Segment     | One post in a thread or follow-up chain | Poll, poll duration, first comment                      |
| Media item  | One attached image or video             | Alt text, tagged users, product tags, focal point       |

Settings are not silently removed when content changes. A conflict stays visible until you remove the setting or the conflicting content.

## Platform coverage

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

OpenPost never treats a sign-in or permission error as a success. If it cannot load required account choices, the account panel shows **Retry** and blocks publishing. If the missing choices are optional, it shows a warning.

## Compatibility

YouTube accepts only Short video and Video. Multiple images use Post rather than a separate carousel type. A video added to Post requires Short video or Video. App review, permissions, account type, API limits, and public media links can still block a format.
