export const previewPlatforms = [
  "x",
  "mastodon",
  "pixelfed",
  "peertube",
  "lemmy",
  "piefed",
  "bluesky",
  "linkedin",
  "threads",
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
  "discord",
  "telegram",
  "pinterest",
  "reddit",
  "googlebusiness",
] as const;

export type PreviewPlatform = (typeof previewPlatforms)[number];
export type PreviewPlatformKey = PreviewPlatform | "unsupported";
export type PreviewScheme = "light" | "dark" | "system";

const previewFormats = [
  "post",
  "thread",
  "story",
  "reel",
  "short",
  "video",
  "photo",
  "document",
] as const;

export type PreviewFormat = (typeof previewFormats)[number];
export type PreviewMediaKind = "image" | "video" | "document";

export interface PreviewIdentity {
  displayName: string;
  handle: string;
  avatarUrl?: string;
  verified?: boolean;
}

export interface PreviewMedia {
  id: string;
  kind: PreviewMediaKind;
  src: string;
  alt?: string;
  poster?: string;
  aspectRatio?: number;
  durationLabel?: string;
}

export interface PreviewSegment {
  id: string;
  text: string;
  media?: PreviewMedia[];
  poll?: PreviewPoll;
  card?: PreviewCard;
  contentWarning?: string;
}

export interface PreviewPoll {
  question?: string;
  options: string[];
  durationLabel?: string;
  allowMultiple?: boolean;
}

export interface PreviewCard {
  kind: "link" | "quote";
  title: string;
  description?: string;
  domain?: string;
  imageUrl?: string;
  author?: PreviewIdentity;
}

export interface PreviewBusinessPost {
  topic: "standard" | "event" | "offer";
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  action?: "book" | "order" | "shop" | "learn_more" | "sign_up" | "call";
  actionUrl?: string;
  couponCode?: string;
  terms?: string;
}

export interface PreviewModel {
  platform: PreviewPlatformKey;
  format: PreviewFormat;
  identity: PreviewIdentity;
  segments: PreviewSegment[];
  media: PreviewMedia[];
  poll?: PreviewPoll;
  card?: PreviewCard;
  contentWarning?: string;
  visibility?: string;
  location?: string;
  title?: string;
  subtitle?: string;
  createdAtLabel?: string;
  approximate?: boolean;
  business?: PreviewBusinessPost;
}

interface PreviewCapability {
  formats: readonly PreviewFormat[];
  media: readonly PreviewMediaKind[];
  polls?: boolean;
  cards?: readonly PreviewCard["kind"][];
  contentWarning?: boolean;
  maxImages?: number;
  maxPollOptions?: number;
}

const commonMedia = ["image", "video"] as const;

export const previewCapabilities: Record<PreviewPlatform, PreviewCapability> = {
  x: {
    formats: ["post", "thread", "video"],
    media: commonMedia,
    polls: true,
    cards: ["link", "quote"],
    maxImages: 4,
    maxPollOptions: 4,
  },
  mastodon: {
    formats: ["post", "thread", "video"],
    media: commonMedia,
    polls: true,
    cards: ["link"],
    contentWarning: true,
  },
  pixelfed: {
    formats: ["post", "thread", "photo"],
    media: ["image"],
    polls: true,
    cards: ["link"],
    contentWarning: true,
  },
  peertube: {
    formats: ["video"],
    media: ["video"],
  },
  lemmy: {
    formats: ["post"],
    media: ["image"],
    cards: ["link"],
  },
  piefed: {
    formats: ["post"],
    media: ["image"],
    cards: ["link"],
  },
  bluesky: {
    formats: ["post", "thread", "video"],
    media: commonMedia,
    cards: ["link", "quote"],
    maxImages: 4,
  },
  linkedin: {
    formats: ["post", "thread", "video", "document"],
    media: ["image", "video", "document"],
    polls: true,
    cards: ["link"],
    maxImages: 20,
    maxPollOptions: 4,
  },
  threads: {
    formats: ["post", "thread", "video"],
    media: commonMedia,
    maxImages: 20,
    polls: true,
    cards: ["link", "quote"],
    contentWarning: true,
  },
  instagram: {
    formats: ["post", "story", "reel"],
    media: commonMedia,
  },
  facebook: {
    formats: ["post", "story", "reel", "video"],
    media: commonMedia,
    cards: ["link"],
  },
  youtube: {
    formats: ["video", "short"],
    media: ["video"],
  },
  tiktok: {
    formats: ["video", "photo"],
    media: commonMedia,
    maxImages: 35,
  },
  discord: {
    formats: ["post", "thread", "video"],
    media: ["image", "video", "document"],
    cards: ["link"],
  },
  telegram: {
    formats: ["post", "video"],
    media: ["image", "video", "document"],
    maxImages: 10,
  },
  pinterest: {
    formats: ["photo", "video"],
    media: commonMedia,
    cards: ["link"],
    maxImages: 1,
  },
  reddit: {
    formats: ["post", "photo", "video"],
    media: commonMedia,
    cards: ["link"],
    polls: true,
    contentWarning: true,
    maxImages: 20,
    maxPollOptions: 6,
  },
  googlebusiness: {
    formats: ["post"],
    media: commonMedia,
  },
};

export const platformNames: Record<PreviewPlatformKey, string> = {
  x: "X",
  mastodon: "Mastodon",
  pixelfed: "Pixelfed",
  peertube: "PeerTube",
  lemmy: "Lemmy",
  piefed: "PieFed",
  bluesky: "Bluesky",
  linkedin: "LinkedIn",
  threads: "Threads",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  discord: "Discord",
  telegram: "Telegram",
  pinterest: "Pinterest",
  reddit: "Reddit",
  googlebusiness: "Google Business Profile",
  unsupported: "Unsupported account",
};

export function normalizePreviewPlatform(value: string): PreviewPlatformKey {
  const normalized = value.trim().toLowerCase().split(":")[0];
  return previewPlatforms.includes(normalized as PreviewPlatform)
    ? (normalized as PreviewPlatform)
    : "unsupported";
}

export function supportsPreviewFormat(platform: PreviewPlatform, format: PreviewFormat): boolean {
  return previewCapabilities[platform].formats.includes(format);
}

export function createPreviewModel(
  input: Partial<PreviewModel> & Pick<PreviewModel, "platform">,
): PreviewModel {
  return {
    platform: input.platform,
    format:
      input.format ??
      (input.platform === "unsupported" ? "post" : previewCapabilities[input.platform].formats[0]),
    identity: {
      displayName: input.identity?.displayName || "Your name",
      handle: input.identity?.handle?.replace(/^@/u, "") || "yourhandle",
      avatarUrl: input.identity?.avatarUrl,
      verified: input.identity?.verified,
    },
    segments: input.segments?.length ? input.segments : [{ id: "primary", text: "" }],
    media: input.media ?? [],
    poll: input.poll,
    card: input.card,
    contentWarning: input.contentWarning,
    visibility: input.visibility,
    location: input.location,
    title: input.title,
    subtitle: input.subtitle,
    createdAtLabel: input.createdAtLabel ?? "Now",
    approximate: input.approximate ?? true,
    business: input.business,
  };
}
