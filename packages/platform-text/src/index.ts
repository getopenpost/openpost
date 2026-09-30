export const DEFAULT_PLATFORM_CHAR_LIMIT = 280;
export const X_STANDARD_CHAR_LIMIT = 280;
export const X_PREMIUM_CHAR_LIMIT = 25_000;
const X_TRANSFORMED_URL_LENGTH = 23;
const X_URL_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<>{}[\]"']+|(?<![@\p{L}\p{N}_])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?:[/?#][^\s<>{}[\]"']*)?/giu;
const MASTODON_URL_LENGTH = 23;
const MASTODON_URL_PATTERN = /https?:\/\/[^\s<>{}[\]"']+/giu;
const MASTODON_REMOTE_MENTION_PATTERN = /(^|[^/\w])@([a-z0-9_]+)@[a-z0-9.-]+[a-z0-9]+/gi;
// An http(s) link whose host ends in a dot and a top-level domain, the part of
// twitter-text's validDomain Mastodon relies on to decide what is a link.
const MASTODON_LINK_HOST =
  /^https?:\/\/(?:[^/?#@\s]*@)?[^/?#:\s]+\.(?:\p{L}{2,}|xn--[a-z0-9-]+)(?::\d+)?(?:[/?#]|$)/iu;
const GRAPHEME_SEGMENTER = resolveGraphemeSegmenter();

export interface PlatformLimitDefinition {
  key: string;
  name: string;
  charLimit: number;
  media: string;
  note: string;
}

export const PLATFORM_LIMITS = {
  x: {
    key: "x",
    name: "X",
    charLimit: X_STANDARD_CHAR_LIMIT,
    media: "Up to 4 images or 1 MP4 video",
    note: "Connected accounts use the limits reported by their X subscription tier.",
  },
  mastodon: {
    key: "mastodon",
    name: "Mastodon",
    charLimit: 500,
    media: "Up to 4 attachments",
    note: "Instance rules can vary.",
  },
  pixelfed: {
    key: "pixelfed",
    name: "Pixelfed",
    charLimit: 500,
    media: "Up to 4 photos, or one album of 2-4 photos",
    note: "Photo-first. Instance rules can vary.",
  },
  peertube: {
    key: "peertube",
    name: "PeerTube",
    charLimit: 5000,
    media: "Exactly one video per channel",
    note: "A title and channel are required. Instance quota and transcoding apply.",
  },
  lemmy: {
    key: "lemmy",
    name: "Lemmy",
    charLimit: 50000,
    media: "Text, link, or one image per community post",
    note: "A community and title are required. Community rules apply.",
  },
  piefed: {
    key: "piefed",
    name: "PieFed",
    charLimit: 50000,
    media: "Text, link, or one image per community post",
    note: "A community and title are required. Community rules apply.",
  },
  bluesky: {
    key: "bluesky",
    name: "Bluesky",
    charLimit: 300,
    media: "Up to 4 images or 1 MP4 video",
    note: "Video is MP4-only and cannot be mixed with images.",
  },
  linkedin: {
    key: "linkedin",
    name: "LinkedIn",
    charLimit: 3000,
    media: "One image, video, or document, or 2-20 images",
    note: "Thread replies publish as comments. Use the focused editor for videos and documents.",
  },
  threads: {
    key: "threads",
    name: "Threads",
    charLimit: 500,
    media: "One media item or a 2-20 item carousel",
    note: "Media must be served from public HTTPS URLs.",
  },
  facebook: {
    key: "facebook",
    name: "Facebook Pages",
    charLimit: 63206,
    media: "One image/video, a 2-10 photo post, or one Story item",
    note: "Pages publishing depends on Meta permissions and app review.",
  },
  instagram: {
    key: "instagram",
    name: "Instagram Professional",
    charLimit: 2200,
    media: "One image/video or a 2-10 item carousel",
    note: "Business or Creator accounts linked to Facebook Pages.",
  },
  tiktok: {
    key: "tiktok",
    name: "TikTok",
    charLimit: 2200,
    media: "One video or 1-35 JPEG/WebP photos",
    note: "Public link checks and app review may apply.",
  },
  youtube: {
    key: "youtube",
    name: "YouTube",
    charLimit: 5000,
    media: "Exactly one video",
    note: "Private by default. Unaudited Google projects may force private uploads.",
  },
  pinterest: {
    key: "pinterest",
    name: "Pinterest",
    charLimit: 800,
    media: "One image, up to 5 images, or one MP4 video",
    note: "Pin descriptions use this limit; public use remains gated on Standard access and live certification.",
  },
  telegram: {
    key: "telegram",
    name: "Telegram",
    charLimit: 4096,
    media: "Up to 10 media items in one group",
    note: "Captions use a separate 1,024-character limit; public bot use remains gated on live certification.",
  },
  discord: {
    key: "discord",
    name: "Discord",
    charLimit: 2000,
    media: "Up to 10 files, using a safe 10 MiB limit for each file",
    note: "Discord webhooks can publish and delete messages, but cannot read a channel inbox.",
  },
} satisfies Record<string, PlatformLimitDefinition>;

export function countPlatformText(platformKey: string, text: string): number {
  if (platformKey === "threads") return new TextEncoder().encode(text).length;
  if (platformKey === "bluesky") return graphemeSegments(text).length;
  if (platformKey === "mastodon") return Array.from(mastodonCountableText(text)).length;
  if (platformKey !== "x") return Array.from(text).length;
  const normalized = text.normalize("NFC");

  let length = 0;
  let cursor = 0;
  for (const match of normalized.matchAll(X_URL_PATTERN)) {
    const start = match.index;
    const matchedURL = match[0].replace(/[.,!?;:)\]}]+$/u, "");
    if (!matchedURL) continue;
    length += xWeightedTextSegmentLength(normalized.slice(cursor, start));
    length += X_TRANSFORMED_URL_LENGTH;
    cursor = start + matchedURL.length;
  }
  return length + xWeightedTextSegmentLength(normalized.slice(cursor));
}

// Mastodon measures a status after counting each http(s) link as 23
// characters and each @user@domain mention as @user.
function mastodonCountableText(text: string): string {
  return text
    .replace(MASTODON_URL_PATTERN, (match) => {
      const url = match.slice(0, mastodonURLEnd(match));
      if (!MASTODON_LINK_HOST.test(url)) return match;
      return "x".repeat(MASTODON_URL_LENGTH) + match.slice(url.length);
    })
    .replace(MASTODON_REMOTE_MENTION_PATTERN, "$1@$2");
}

// Trailing punctuation is not part of a link, except a ")" that closes a "("
// inside it, as in https://en.wikipedia.org/wiki/Foo_(bar).
function mastodonURLEnd(url: string): number {
  let end = url.length;
  while (end > 0) {
    const character = url[end - 1];
    if (character === ")") {
      const body = url.slice(0, end);
      if (body.split("(").length >= body.split(")").length) break;
    } else if (!/[.,!?;:\]}]/u.test(character)) {
      break;
    }
    end--;
  }
  return end;
}

function xWeightedTextSegmentLength(text: string): number {
  let length = 0;
  for (const cluster of graphemeSegments(text)) {
    const codePoints = Array.from(cluster, (value) => value.codePointAt(0) ?? 0);
    if (isXEmojiSequence(codePoints)) {
      length += 2;
      continue;
    }
    for (const codePoint of codePoints) length += xCodePointWeight(codePoint);
  }
  return length;
}

function graphemeSegments(text: string): string[] {
  if (GRAPHEME_SEGMENTER) {
    return Array.from(GRAPHEME_SEGMENTER.segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

function isXEmojiSequence(codePoints: number[]): boolean {
  if (codePoints.length < 2) return false;
  let regionalIndicators = 0;
  for (const codePoint of codePoints) {
    if (
      codePoint === 0x200d ||
      codePoint === 0xfe0f ||
      codePoint === 0x20e3 ||
      (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
      (codePoint >= 0xe0020 && codePoint <= 0xe007f)
    ) {
      return true;
    }
    if (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) regionalIndicators += 1;
  }
  return regionalIndicators >= 2;
}

function xCodePointWeight(codePoint: number): number {
  if (
    (codePoint >= 0 && codePoint <= 0x10ff) ||
    (codePoint >= 0x2000 && codePoint <= 0x200d) ||
    (codePoint >= 0x2010 && codePoint <= 0x201f) ||
    (codePoint >= 0x2032 && codePoint <= 0x2037)
  ) {
    return 1;
  }
  return 2;
}

function resolveGraphemeSegmenter(): Intl.Segmenter | null {
  return typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
}
