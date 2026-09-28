# Social previews

`packages/social-preview` owns post cards and page shells for the composer and public preview tools. The composer maps a rendition into `PreviewModel`; marketing creates the same model from local inputs. Keep provider-specific rendering in this package so both surfaces show the same post.

Preview support is separate from publishing readiness. Reddit is a preview-only platform. Pinterest and Google Business Profile previews do not enable their gated publishing integrations. Server capabilities remain authoritative for account-specific publishing limits.

## Rendering contract

- Page navigation responds to the preview container width, not the host viewport. Keep mobile navigation inside that container.
- `scheme` accepts `system`, `light`, or `dark`. Explicit schemes override the host application's appearance.
- Authored text detects direction with `dir="auto"`; multiline post bodies use `unicode-bidi: plaintext` and `text-align: start` for independent paragraph direction. Isolate inline author names with `bdi`. Keep card controls in the interface direction and preserve the original text without inserting directional characters.
- Preserve the selected output format, the destination's segment strategy, per-segment settings, and explicitly empty media arrays. Joined destinations use the same trimmed text and combined attachments as publication delivery.
- Use supplied media dimensions when available and intrinsic dimensions otherwise. A missing ratio must not permanently force portrait media into a landscape crop.
- Shared capability counts describe verified preview limits. Unspecified limits can vary by instance or client; public tools must label their own input limits and never silently discard uploads.
- Navigation and neighboring content illustrate a platform. Only real preview interactions, such as carousel navigation and content-warning disclosure, should look operable.

The Threads preview limit is 20 mixed images or videos, matching [Meta's published carousel contract](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api). Unverified limits remain labeled as preview-tool limits, rather than publishing guarantees.

PDF pages load PDF.js on demand. Both application Vite configs enable `pdfPreviewAssets()` from `packages/social-preview/pdf-assets.ts`, which ships the installed PDF.js character maps, fonts, decoders, and licenses under `/pdfjs/<version>/`. Keep those files on the same origin and match the renderer version; documents fetch them only when needed.

## Reference baseline

Reviewed on 26 September 2026. Logged-in Brave observations informed X, Threads, Facebook, Instagram, and LinkedIn web layouts. Account experiments, app versions, locales, native apps, fonts, and federated instance themes can differ. These previews estimate presentation; they do not guarantee published output.

| Platform or behavior                        | Primary reference                                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X photos and grids                          | [Posting pictures](https://help.x.com/en/using-x/posting-gifs-and-pictures), [posting limits](https://help.x.com/en/using-x/how-to-post)                                                       |
| Threads web columns and feeds               | [Meta web update](https://about.fb.com/news/2025/04/new-features-threads-web-experience/), checked against the current logged-in interface                                                     |
| Bluesky attachments                         | [Creating a post](https://docs.bsky.app/docs/tutorials/creating-a-post)                                                                                                                        |
| LinkedIn image collections                  | [Sharing photos or videos](https://www.linkedin.com/help/linkedin/answer/a527229/share-photos-or-videos?lang=en)                                                                               |
| Mastodon warnings and instance limits       | [Posting](https://docs.joinmastodon.org/user/posting/), [instance configuration](https://docs.joinmastodon.org/entities/Instance/)                                                             |
| Discord attachment mosaics                  | [File attachments](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ)                                                                                          |
| Telegram albums                             | [Albums](https://telegram.org/blog/albums-saved-messages), [file API](https://core.telegram.org/api/files)                                                                                     |
| TikTok photo posts                          | [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post)                                                                                              |
| Pinterest pin media and shape               | [Create a Pin](https://help.pinterest.com/en-gb/article/create-a-pin-from-an-image-or-video), [Pin formats](https://create.pinterest.com/en-ca/product-features/how-to-create-pins/)           |
| Reddit posts and galleries                  | [Posting](https://support.reddithelp.com/hc/en-us/articles/360060422572-How-do-I-post-and-comment-on-Reddit), [image galleries](https://redditinc.com/news/introducing-reddit-image-galleries) |
| Google Business updates, events, and offers | [Create posts](https://support.google.com/business/answer/7342169?hl=en)                                                                                                                       |

Open-source interfaces were consulted as behavioral references: [Bluesky](https://github.com/bluesky-social/social-app), [Lemmy](https://github.com/LemmyNet/lemmy-ui), [PeerTube](https://github.com/Chocobozzz/PeerTube), and [Pixelfed](https://github.com/pixelfed/pixelfed). No interface source was copied. Reddit and Google glyph paths come from [Simple Icons](https://github.com/simple-icons/simple-icons), under [CC0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md); Pinterest reuses the existing repository glyph.

When updating fidelity, compare real cards containing text, links, polls, multiple images, portrait media, and warnings. Check cards and full pages at 320px, 390px, and desktop widths in both schemes. Keep regression tests at the renderer, composer mapping, or browser-flow boundary that owns the behavior.
