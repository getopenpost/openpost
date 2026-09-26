// Preview tools describe native layouts, not OpenPost publishing integrations.
export const previewTools = [
  {
    platform: "x",
    slug: "x-post-preview",
    name: "X post preview",
    title: "Free X post preview - OpenPost",
    description: "Check a short post, a reply thread, a quoted post, or a poll before sharing it.",
    checks: [
      "A short opening should make sense before a reader expands the post. Use a thread when the next point deserves its own reply.",
      "Compare a link card with an attached image. Check quoted text separately from your own introduction.",
    ],
  },
  {
    platform: "bluesky",
    slug: "bluesky-post-preview",
    name: "Bluesky post preview",
    title: "Free Bluesky post preview - OpenPost",
    description: "Check thread continuity, image descriptions, quoted posts, and link cards.",
    checks: [
      "Check a four-image grid with both portrait and landscape photos. Alt text should describe the useful content of each image.",
      "A quoted post and a link card occupy different space below the text. Review the first post and every continuation together.",
    ],
  },
  {
    platform: "mastodon",
    slug: "mastodon-post-preview",
    name: "Mastodon post preview",
    title: "Free Mastodon post preview - OpenPost",
    description: "Review a federated handle, content warning, poll, or thread. Server limits vary.",
    checks: [
      "Write a content warning that explains what is behind it. Expand the warning in the preview and check the revealed text.",
      "Keep the complete federated handle recognizable. Attachment and poll limits depend on the server where you publish.",
    ],
  },
  {
    platform: "pixelfed",
    slug: "pixelfed-post-preview",
    name: "Pixelfed post preview",
    title: "Free Pixelfed post preview - OpenPost",
    description:
      "Review a photo caption and album in its feed context. Album limits vary by server.",
    checks: [
      "Put the photograph first and check that the caption still reads naturally below it. Use the carousel controls to inspect each image.",
      "Album limits depend on the Pixelfed server. Check the destination before preparing a large album.",
    ],
  },
  {
    platform: "peertube",
    slug: "peertube-post-preview",
    name: "PeerTube post preview",
    title: "Free PeerTube post preview - OpenPost",
    description: "Review your video title, description, and player in a watch page.",
    checks: [
      "A useful title should explain the video before playback. Compare its length beside the channel identity in the watch page.",
      "Use your actual video to check its proportions and poster. PeerTube themes and server settings may change the surrounding page.",
    ],
  },
  {
    platform: "lemmy",
    slug: "lemmy-post-preview",
    name: "Lemmy post preview",
    title: "Free Lemmy post preview - OpenPost",
    description: "Check a community post title, body, image, and linked page.",
    checks: [
      "The post title introduces the discussion independently of the body. Include enough context for readers arriving from another community.",
      "Community names, votes, and linked images compete for space in a compact feed. Check a narrow width before sharing a long title.",
    ],
  },
  {
    platform: "piefed",
    slug: "piefed-post-preview",
    name: "PieFed post preview",
    title: "Free PieFed post preview - OpenPost",
    description: "Review the title and body of a community discussion with its image or link.",
    checks: [
      "Start with a descriptive discussion title and identify the community in Post details. Check the text at phone width.",
      "Compare a linked page with an uploaded image. Community rules and instance settings remain separate from this visual check.",
    ],
  },
  {
    platform: "linkedin",
    slug: "linkedin-post-preview",
    name: "LinkedIn post preview",
    title: "Free LinkedIn post preview - OpenPost",
    description: "Review a professional post, multi-image layout, poll, or document card.",
    checks: [
      "Check the opening lines with your professional identity. Expand a long post and make sure the ending still has a clear next step.",
      "The first image affects a multi-photo layout. Try a portrait and a landscape lead image, or choose Document for a document card.",
    ],
  },
  {
    platform: "threads",
    slug: "threads-post-preview",
    name: "Threads post preview",
    title: "Free Threads post preview - OpenPost",
    description: "Check conversational copy, replies, quoted posts, and photo carousels.",
    checks: [
      "Use short paragraphs and inspect each reply when preparing a thread. Check quoted text separately from the text introducing it.",
      "Photo carousels can make the caption secondary. Inspect each photo and check the text again in the isolated post card.",
    ],
  },
  {
    platform: "instagram",
    slug: "instagram-post-preview",
    name: "Instagram post preview",
    title: "Free Instagram post preview - OpenPost",
    description: "Review captions and media in a feed post, carousel, Story, or Reel.",
    checks: [
      "Compare the square feed context with a vertical Story or Reel. Keep important image content clear of names, captions, and action controls.",
      "Use the carousel controls to review every image. The first photo should explain the album even before someone swipes.",
    ],
  },
  {
    platform: "facebook",
    slug: "facebook-post-preview",
    name: "Facebook post preview",
    title: "Free Facebook post preview - OpenPost",
    description: "Check page identity, post copy, photos, linked pages, Stories, and Reels.",
    checks: [
      "Check the page name and opening lines together. A linked page, a photo collection, and a Reel each give the text a different position.",
      "Review Stories and Reels at phone width. Avoid placing essential information behind the visible identity or interaction controls.",
    ],
  },
  {
    platform: "youtube",
    slug: "youtube-post-preview",
    name: "YouTube post preview",
    title: "Free YouTube post preview - OpenPost",
    description: "Review a video title and watch page, or check a vertical Short.",
    checks: [
      "Check whether the title still explains the video when it wraps. Use the watch page for long videos and Short for vertical footage.",
      "A title and thumbnail need to work together before playback. Check the uploaded video proportions and the channel name below it.",
    ],
  },
  {
    platform: "tiktok",
    slug: "tiktok-post-preview",
    name: "TikTok post preview",
    title: "Free TikTok post preview - OpenPost",
    description: "Check vertical video overlays or the first impression of a photo carousel.",
    checks: [
      "Inspect the vertical media with the caption and action controls visible. Keep important on-screen text away from those controls.",
      "For a photo post, inspect the opening image and every following slide. A large photo set should still make sense one slide at a time.",
    ],
  },
  {
    platform: "pinterest",
    slug: "pinterest-post-preview",
    name: "Pinterest post preview",
    title: "Free Pinterest post preview - OpenPost",
    description: "Review a Pin image, title, description, and destination card.",
    checks: [
      "The image introduces the Pin before its description. Inspect the portrait crop and choose a title that explains what the image offers.",
      "Check the destination domain and account identity. A standard image Pin uses a single image; this tool does not create an advertisement.",
    ],
  },
  {
    platform: "reddit",
    slug: "reddit-post-preview",
    name: "Reddit post preview",
    title: "Free Reddit post preview - OpenPost",
    description: "Check a community post title, discussion text, image gallery, or poll.",
    checks: [
      "The community and title set the context before anyone reads the body. Use the community field and check a long title on a small screen.",
      "Use the gallery controls for multi-image posts or add a poll for a choice-based discussion. Each community can restrict allowed post types.",
    ],
  },
  {
    platform: "googlebusiness",
    slug: "googlebusiness-post-preview",
    name: "Google Business post preview",
    title: "Free Google Business post preview - OpenPost",
    description: "Review a business update and image in a local business profile.",
    checks: [
      "Choose an update, event, or offer in Post details. Events need a useful title and dates; offers can include a coupon code and terms.",
      "Check the action button beside the post copy. The business identity should help a reader recognize the location before following the offer.",
    ],
  },
  {
    platform: "discord",
    slug: "discord-post-preview",
    name: "Discord post preview",
    title: "Free Discord post preview - OpenPost",
    description: "Check a channel message, attachments, linked content, and a reply thread.",
    checks: [
      "Keep the opening line meaningful inside a channel conversation. Use the context field to identify the channel.",
      "Review an attachment and a link embed together with the message. Server permissions and upload allowances are not checked by this tool.",
    ],
  },
  {
    platform: "telegram",
    slug: "telegram-post-preview",
    name: "Telegram post preview",
    title: "Free Telegram post preview - OpenPost",
    description: "Review a channel message, its media album, and caption.",
    checks: [
      "Review the message in channel context and keep the useful part of the caption near the beginning.",
      "An album can contain several media items. Check their order and make sure the channel identity remains recognizable at phone width.",
    ],
  },
];
