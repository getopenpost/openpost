export const browserExtensions = [
  {
    slug: "youtube-localizer",
    name: "YouTube Localizer",
    title: "YouTube Localizer browser extension - OpenPost",
    description:
      "Translate video titles, descriptions and thumbnails in YouTube Studio. Generate new thumbnails with your own reference images.",
    headline: "Make your videos work in more languages.",
    repository: "https://github.com/getopenpost/youtube-localizer",
    screenshot: "/assets/marketing/extensions/youtube-localizer.webp",
    screenshotAlt:
      "YouTube Localizer’s Generate button beside a real video thumbnail in YouTube Studio",
    screenshotWidth: 950,
    screenshotHeight: 510,
    screenshotCaption: "Generate a thumbnail directly from YouTube Studio.",
    tone: "lilac",
    benefits: [
      {
        title: "Localize in Studio",
        text: "Translate titles, descriptions and thumbnail text across multiple YouTube accounts. Fill the languages you are missing.",
      },
      {
        title: "Make your next thumbnail",
        text: "Keep face, brand and style references ready. Generate originals through Fal with GPT Image 2.5 Sunburst. Choose GPT Image or Ideogram for localized edits.",
      },
      {
        title: "Reuse editable text",
        text: "Prepare Ideogram text layers once, then change the wording and render more languages locally.",
      },
    ],
    setup: [
      "Install the extension and open Settings.",
      "Add your Fal key for images and choose a text provider, including OpenRouter or your own endpoint.",
      "Open a video in YouTube Studio. Choose its languages or generate a thumbnail.",
    ],
    cost: "The extension is free. AI requests use your own provider keys and their pricing.",
    privacy:
      "Keys, saved references and job history stay in your browser. Selected text and images go directly to the AI providers you choose when you generate. The extension has no OpenPost backend or telemetry.",
  },
  {
    slug: "x-timeline-blocker",
    name: "X Timeline Blocker",
    title: "X Timeline Blocker browser extension - OpenPost",
    description:
      "Give the X home timeline five minutes, then get back to your work. Posting, messages and notifications stay available.",
    headline: "Five minutes of feed. Keep the rest of X.",
    repository: "https://github.com/getopenpost/x-timeline-blocker",
    screenshot: "/assets/marketing/extensions/x-timeline-blocker.webp",
    screenshotAlt:
      "X Timeline Blocker pauses the home feed while the composer and navigation remain available",
    screenshotWidth: 1280,
    screenshotHeight: 800,
    screenshotCaption: "X Timeline Blocker on OpenPost’s X preview.",
    tone: "blue",
    benefits: [
      {
        title: "Open the feed on purpose",
        text: "The home timeline starts paused. Browse timeline opens a five-minute window, with a countdown on the toolbar.",
      },
      {
        title: "One window per hour",
        text: "The feed pauses when your time ends. Your next window is available one hour after you started the last one.",
      },
      {
        title: "Keep using X",
        text: "Post, answer messages, check notifications, visit profiles and open bookmarks or individual posts at any time.",
      },
    ],
    setup: [
      "Install the extension in your browser.",
      "Open the home timeline on x.com or twitter.com.",
      "Choose Browse timeline when you want your five-minute window.",
    ],
    cost: "Free. No account or API keys needed.",
    privacy:
      "The extension stores its timer in your browser and runs only on x.com and twitter.com. It sends no data to a backend and has no telemetry.",
  },
];
