# Account Options

This page is for people tailoring one Publication for each selected social account.

The editor starts with the kind of post you want to make. It then finds the right format for each social network.

- **Post type** is Post, Thread, Story, Short video, or Video.
- **Content** can be text, a link, images, mixed media, a document, or a video.
- **Network format** is the exact format OpenPost sends, such as `instagram.carousel`, `linkedin.document`, `tiktok.photo`, or `youtube.short`.
- **Options** can apply to an account, a part of a thread, or one media file.

Open the settings beside a selected account to change its text and options. OpenPost only shows sections that apply: Content, Conversation, Distribution, Disclosure, and Media and accessibility.

## Where options apply

| Area       | Applies to                              | Examples                                                |
| ---------- | --------------------------------------- | ------------------------------------------------------- |
| Account    | The selected connected account          | Privacy, visibility, playlist, category, reply audience |
| Segment    | One post in a thread or follow-up chain | Poll, poll duration, first comment                      |
| Media item | One attached image or video             | Alt text, tagged users, product tags, focal point       |

Settings are not silently removed when content changes. A conflict stays visible until you remove the setting or the conflicting content.

## Options by social network

| Social network         | Formats                                                                     | What you can set                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X                      | Post, link, images, video, thread                                           | Poll, reply audience, community and location when granted, paid-partnership and AI disclosures, tagged users, and alt text. Quote publishing remains unavailable without X Enterprise access.                                                               |
| Mastodon               | Post, link, media, video, thread                                            | Instance-derived text, media, and poll limits; visibility; content warning; sensitive media; language; poll controls; alt text; and focal point. Quote and interaction policy controls remain unavailable until the instance advertises compatible support. |
| Bluesky                | Post, link card, images, video, thread                                      | Who can reply, thread rules, languages, labels, quote link, link card, and image alt text.                                                                                                                                                                  |
| LinkedIn               | Post, article, image, multi-image, document, video, poll, root plus comment | Visibility, reshares, article details, document title, image alt text, poll choices, and a first comment. Thumbnail and caption upload are not available here.                                                                                              |
| Facebook Pages         | Text, link, photo, multi-photo, video, Reel, Story                          | Link and video details, Reel feed sharing, and a first comment. Page polls, text backgrounds, and thumbnails are not available.                                                                                                                             |
| Instagram Professional | Feed image, carousel, Reel, Story                                           | Other authors, location, people tags on each image, alt text, Reel cover or frame, share to feed, and trial Reel controls when the account supports them. Product tags only appear for accounts that support them.                                          |
| Threads                | Post, link, image, video, carousel, thread                                  | Poll, who can reply, topic, location, media warning, link, long text, ghost posts, and reply approval when the account supports them. GIF publishing works, but the picker needs a GIPHY search service.                                                    |
| YouTube                | Short, Video                                                                | Required title, category, and privacy; description; tags; playlist; thumbnail; captions and language; license; embedding; child-directed, synthetic-media, and paid-placement disclosures; and subscriber notification.                                     |
| TikTok                 | Video, photo post                                                           | Direct Post or inbox upload, live privacy and interaction choices, photo title and cover, auto-music, video cover frame, branded and organic disclosures, music consent, and video AI disclosure. Privacy is required only for Direct Post.                 |

## Choices that can change

OpenPost checks these account choices again before it schedules or publishes:

- TikTok account choices after 5 minutes.
- YouTube playlists and categories after 15 minutes.
- Mastodon server settings after 1 hour.

OpenPost never treats a sign-in or permission error as a success. If it cannot load required account choices, the account panel shows **Retry** and blocks publishing. If the missing choices are optional, it shows a warning.

## Compatibility

YouTube accepts only Short video and Video. Multiple images use Post rather than a separate carousel type. A video added to Post requires Short video or Video. App review, permissions, account type, API limits, and public media links can still block a format.
