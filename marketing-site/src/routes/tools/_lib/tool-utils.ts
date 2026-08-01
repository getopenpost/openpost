export type PlatformKey =
  | "x"
  | "mastodon"
  | "bluesky"
  | "linkedin"
  | "threads"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "discord";

export interface PlatformCountDefinition {
  key: PlatformKey;
  name: string;
  limit: number;
  note: string;
  countMode: "graphemes" | "x-weighted";
}

export const COUNTER_PLATFORMS: PlatformCountDefinition[] = [
  {
    key: "x",
    name: "X",
    limit: 280,
    note: "Standard-post estimate: links use 23 characters, with X-style character weighting.",
    countMode: "x-weighted",
  },
  {
    key: "bluesky",
    name: "Bluesky",
    limit: 300,
    note: "Counts the characters you can see.",
    countMode: "graphemes",
  },
  {
    key: "mastodon",
    name: "Mastodon",
    limit: 500,
    note: "500 is the common default; an instance can set a different limit.",
    countMode: "graphemes",
  },
  {
    key: "threads",
    name: "Threads",
    limit: 500,
    note: "Counts the characters you can see.",
    countMode: "graphemes",
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    limit: 3_000,
    note: "This is the main post limit; comment replies are shorter.",
    countMode: "graphemes",
  },
  {
    key: "instagram",
    name: "Instagram",
    limit: 2_200,
    note: "Caption limit for feed posts and Reels.",
    countMode: "graphemes",
  },
  {
    key: "tiktok",
    name: "TikTok",
    limit: 2_200,
    note: "Video caption limit. Photo posts allow up to 4,000 characters.",
    countMode: "graphemes",
  },
  {
    key: "youtube",
    name: "YouTube",
    limit: 5_000,
    note: "Video description limit; titles use a separate field.",
    countMode: "graphemes",
  },
  {
    key: "facebook",
    name: "Facebook Pages",
    limit: 63_206,
    note: "Maximum post length. Shorter posts are often easier to read.",
    countMode: "graphemes",
  },
  {
    key: "discord",
    name: "Discord",
    limit: 2_000,
    note: "Message limit for incoming webhooks.",
    countMode: "graphemes",
  },
];

export const THREAD_PLATFORMS = [
  { key: "x", name: "X", limit: 280, countMode: "x-weighted" },
  { key: "bluesky", name: "Bluesky", limit: 300, countMode: "graphemes" },
  { key: "mastodon", name: "Mastodon", limit: 500, countMode: "graphemes" },
  { key: "threads", name: "Threads", limit: 500, countMode: "graphemes" },
  {
    key: "linkedin",
    name: "LinkedIn comment thread",
    limit: 1_250,
    countMode: "graphemes",
  },
] as const;

const urlPattern = /https?:\/\/[^\s]+/giu;
const pictographicPattern = /\p{Extended_Pictographic}/u;

export function graphemes(value: string): string[] {
  const normalized = value.normalize("NFC");
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(segmenter.segment(normalized), (part) => part.segment);
  }
  return Array.from(normalized);
}

export function graphemeCount(value: string): number {
  return graphemes(value).length;
}

function xWeight(value: string): number {
  return graphemes(value).reduce((total, grapheme) => {
    if (pictographicPattern.test(grapheme)) return total + 2;
    return (
      total +
      Array.from(grapheme).reduce((graphemeTotal, character) => {
        const point = character.codePointAt(0) ?? 0;
        const singleWeight =
          (point >= 0 && point <= 0x10ff) ||
          (point >= 0x2000 && point <= 0x200d) ||
          (point >= 0x2010 && point <= 0x201f) ||
          (point >= 0x2032 && point <= 0x2037);
        return graphemeTotal + (singleWeight ? 1 : 2);
      }, 0)
    );
  }, 0);
}

export function xWeightedCount(value: string): number {
  const normalized = value.normalize("NFC");
  let count = 0;
  let cursor = 0;
  for (const match of normalized.matchAll(urlPattern)) {
    const index = match.index ?? cursor;
    count += xWeight(normalized.slice(cursor, index));
    count += 23;
    cursor = index + match[0].length;
  }
  return count + xWeight(normalized.slice(cursor));
}

export function platformTextCount(
  value: string,
  platform: PlatformKey,
): number {
  return platform === "x" ? xWeightedCount(value) : graphemeCount(value);
}

export function wordCount(value: string): number {
  if (!value.trim()) return 0;
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    return Array.from(segmenter.segment(value)).filter(
      (part) => part.isWordLike,
    ).length;
  }
  return value.trim().split(/\s+/u).length;
}

function sentenceSegments(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "sentence",
    });
    return Array.from(segmenter.segment(value), (part) => part.segment).filter(
      Boolean,
    );
  }
  return value.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/gu) ?? [value];
}

function splitOversizeToken(
  value: string,
  limit: number,
  platform: PlatformKey,
): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const grapheme of graphemes(value)) {
    if (current && platformTextCount(current + grapheme, platform) > limit) {
      pieces.push(current);
      current = grapheme;
    } else {
      current += grapheme;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function splitUnit(
  value: string,
  limit: number,
  platform: PlatformKey,
): string[] {
  const output: string[] = [];
  let current = "";
  const tokens = value.match(/\S+\s*|\s+/gu) ?? [value];

  for (const token of tokens) {
    if (platformTextCount(current + token, platform) <= limit) {
      current += token;
      continue;
    }
    if (current.trim()) output.push(current.trim());
    current = "";
    if (platformTextCount(token.trim(), platform) <= limit) {
      current = token.trimStart();
      continue;
    }
    const pieces = splitOversizeToken(token.trim(), limit, platform);
    output.push(...pieces.slice(0, -1));
    current = pieces.at(-1) ?? "";
  }
  if (current.trim()) output.push(current.trim());
  return output;
}

function splitWithoutNumbering(
  value: string,
  limit: number,
  platform: PlatformKey,
): string[] {
  const paragraphs = value
    .replace(/\r\n?/gu, "\n")
    .trim()
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const output: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) output.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    const paragraphCandidate = current
      ? `${current}\n\n${paragraph}`
      : paragraph;
    if (platformTextCount(paragraphCandidate, platform) <= limit) {
      current = paragraphCandidate;
      continue;
    }
    flush();
    if (platformTextCount(paragraph, platform) <= limit) {
      current = paragraph;
      continue;
    }

    for (const sentence of sentenceSegments(paragraph)) {
      const cleanSentence = sentence.trim();
      if (!cleanSentence) continue;
      const sentenceCandidate = current
        ? `${current} ${cleanSentence}`
        : cleanSentence;
      if (platformTextCount(sentenceCandidate, platform) <= limit) {
        current = sentenceCandidate;
        continue;
      }
      flush();
      if (platformTextCount(cleanSentence, platform) <= limit) {
        current = cleanSentence;
        continue;
      }
      const pieces = splitUnit(cleanSentence, limit, platform);
      output.push(...pieces.slice(0, -1));
      current = pieces.at(-1) ?? "";
    }
    flush();
  }
  flush();
  return output;
}

export interface ThreadPart {
  text: string;
  content: string;
  count: number;
}

export function splitSmartThread(
  value: string,
  platform: PlatformKey,
  limit: number,
  numbering: boolean,
): ThreadPart[] {
  if (!value.trim()) return [];
  let expectedParts = 1;
  let parts: string[] = [];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffix = numbering ? `\n\n${expectedParts}/${expectedParts}` : "";
    const contentLimit = Math.max(
      20,
      limit - platformTextCount(suffix, platform),
    );
    parts = splitWithoutNumbering(value, contentLimit, platform);
    if (!numbering || parts.length === expectedParts) break;
    expectedParts = parts.length;
  }

  return parts.map((content, index) => {
    const suffix = numbering ? `\n\n${index + 1}/${parts.length}` : "";
    const text = `${content}${suffix}`;
    return { text, content, count: platformTextCount(text, platform) };
  });
}

export interface ParsedHandle {
  valid: boolean;
  type: "mastodon" | "bluesky" | "unknown";
  label: string;
  normalized: string;
  username?: string;
  host?: string;
  profileUrl?: string;
  lookupUrl?: string;
  message: string;
}

const blueskyHandlePattern =
  /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/u;

function validHostname(host: string): boolean {
  if (
    host.length > 253 ||
    !host.includes(".") ||
    !blueskyHandlePattern.test(host)
  )
    return false;
  try {
    const parsed = new URL(`https://${host}`);
    return parsed.hostname === host.toLowerCase() && !parsed.port;
  } catch {
    return false;
  }
}

export function parseSocialHandle(value: string): ParsedHandle {
  const trimmed = value.trim();
  const withoutLeadingAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const separator = withoutLeadingAt.lastIndexOf("@");

  if (separator > 0) {
    const username = withoutLeadingAt.slice(0, separator);
    const host = withoutLeadingAt.slice(separator + 1).toLowerCase();
    if (/^[a-zA-Z0-9_]+$/u.test(username) && validHostname(host)) {
      const normalized = `@${username}@${host}`;
      return {
        valid: true,
        type: "mastodon",
        label: "Mastodon-style Fediverse handle",
        normalized,
        username,
        host,
        profileUrl: `https://${host}/@${encodeURIComponent(username)}`,
        lookupUrl: `https://${host}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${username}@${host}`)}`,
        message:
          "The syntax is valid. A live check can confirm that the server resolves it.",
      };
    }
  }

  const candidate = withoutLeadingAt.toLowerCase();
  if (candidate.length <= 253 && blueskyHandlePattern.test(candidate)) {
    return {
      valid: true,
      type: "bluesky",
      label: "Bluesky handle",
      normalized: candidate,
      host: candidate,
      profileUrl: `https://bsky.app/profile/${encodeURIComponent(candidate)}`,
      lookupUrl: `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(candidate)}`,
      message:
        "The DNS-style syntax is valid. A live check can resolve it to a DID.",
    };
  }

  return {
    valid: false,
    type: "unknown",
    label: "Handle needs attention",
    normalized: "",
    message:
      "Use @name@server.example for a Fediverse account or name.bsky.social for Bluesky.",
  };
}

export function formatLinkedInText(
  value: string,
  options: { sentencesPerParagraph: number; normalizeBullets: boolean },
): string {
  const clean = value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/gu, ""))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (!clean) return "";

  const bulletNormalized = options.normalizeBullets
    ? clean.replace(/^\s*[-*•]\s+/gmu, "• ")
    : clean;
  const originalParagraphs = bulletNormalized.split(/\n{2,}/u);
  const output: string[] = [];
  for (const paragraph of originalParagraphs) {
    if (/^• /mu.test(paragraph) || options.sentencesPerParagraph <= 0) {
      output.push(paragraph.trim());
      continue;
    }
    const sentences = sentenceSegments(paragraph)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    for (
      let index = 0;
      index < sentences.length;
      index += options.sentencesPerParagraph
    ) {
      output.push(
        sentences.slice(index, index + options.sentencesPerParagraph).join(" "),
      );
    }
  }
  return output.filter(Boolean).join("\n\n");
}

export async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

export const TIMEZONES = [
  "UTC",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "America/New_York",
  "America/Toronto",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Sao_Paulo",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
] as const;

export const WEEKDAYS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
] as const;

export interface PostingSlot {
  day: number;
  dayLabel: string;
  audienceTime: string;
  localTime: string;
  iso: string;
  adjustedForTimezone: boolean;
  requestedAudienceTime?: string;
}

function minutesFromTime(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function timeFromMinutes(value: number): string {
  const hour = Math.floor(value / 60) % 24;
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function partsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const result: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") result[part.type] = Number(part.value);
  }
  return result;
}

function zonedWallTimeToInstant(
  date: Date,
  time: string,
  timeZone: string,
): Date {
  const [hour, minute] = time.split(":").map(Number);
  let candidate = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
    minute,
  );
  const target = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
    minute,
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsInZone(new Date(candidate), timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += target - represented;
  }
  return new Date(candidate);
}

function nextMonday(reference: Date): Date {
  const date = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
    ),
  );
  const offset = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

export function buildPostingPlan(input: {
  audienceTimezone: string;
  localTimezone: string;
  days: number[];
  postsPerWeek: number;
  windowStart: string;
  windowEnd: string;
  reference?: Date;
}): PostingSlot[] {
  const days = [...input.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 0 || input.postsPerWeek < 1) return [];
  const start = minutesFromTime(input.windowStart);
  const end = minutesFromTime(input.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return [];

  const allocations = new Map<number, number>();
  const assignedDays =
    input.postsPerWeek <= days.length
      ? input.postsPerWeek === 1
        ? [days[Math.floor((days.length - 1) / 2)]]
        : Array.from(
            { length: input.postsPerWeek },
            (_, index) =>
              days[
                Math.round(
                  (index * (days.length - 1)) / (input.postsPerWeek - 1),
                )
              ],
          )
      : Array.from(
          { length: input.postsPerWeek },
          (_, index) => days[index % days.length],
        );
  for (const day of assignedDays) {
    allocations.set(day, (allocations.get(day) ?? 0) + 1);
  }

  const weekStart = nextMonday(input.reference ?? new Date());
  const output: PostingSlot[] = [];
  for (const day of days) {
    const count = allocations.get(day) ?? 0;
    if (count === 0) continue;
    const date = new Date(weekStart);
    date.setUTCDate(weekStart.getUTCDate() + ((day + 6) % 7));
    for (let position = 0; position < count; position += 1) {
      const minutes = Math.round(
        start + ((end - start) * (position + 1)) / (count + 1),
      );
      const requestedAudienceTime = timeFromMinutes(minutes);
      const instant = zonedWallTimeToInstant(
        date,
        requestedAudienceTime,
        input.audienceTimezone,
      );
      const actualAudience = partsInZone(instant, input.audienceTimezone);
      const adjustedForTimezone =
        actualAudience.year !== date.getUTCFullYear() ||
        actualAudience.month !== date.getUTCMonth() + 1 ||
        actualAudience.day !== date.getUTCDate() ||
        actualAudience.hour * 60 + actualAudience.minute !== minutes;
      const audienceTime = timeFromMinutes(
        actualAudience.hour * 60 + actualAudience.minute,
      );
      const dayLabel = new Intl.DateTimeFormat("en-GB", {
        timeZone: input.audienceTimezone,
        weekday: "long",
      }).format(instant);
      const localTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: input.localTimezone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(instant);
      output.push({
        day,
        dayLabel,
        audienceTime,
        localTime,
        iso: instant.toISOString(),
        adjustedForTimezone,
        requestedAudienceTime: adjustedForTimezone
          ? requestedAudienceTime
          : undefined,
      });
    }
  }
  return output.sort((a, b) => a.iso.localeCompare(b.iso));
}

export function postingPlanCsv(
  slots: PostingSlot[],
  audienceTimezone: string,
  localTimezone: string,
) {
  const rows = [
    [
      "Day",
      `Audience time (${audienceTimezone})`,
      `Local time (${localTimezone})`,
      "Example date (UTC)",
      "Clock change",
    ],
    ...slots.map((slot) => [
      slot.dayLabel,
      slot.audienceTime,
      slot.localTime,
      slot.iso,
      slot.adjustedForTimezone
        ? `Requested ${slot.requestedAudienceTime}; shifted to ${slot.audienceTime}`
        : "",
    ]),
  ];
  return rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
}

export function downloadText(
  filename: string,
  contents: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
