export type PublicationStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  ready: "Ready",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
};

export function statusColor(
  status: string,
  colors: Readonly<Record<string, string>>,
  fallback: string,
): string {
  return colors[status] ?? fallback;
}

const PLATFORM_LABEL: Record<string, string> = {
  x: "X",
  twitter: "X",
  mastodon: "Mastodon",
  bluesky: "Bluesky",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  threads: "Threads",
  youtube: "YouTube",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  reddit: "Reddit",
  discord: "Discord",
  telegram: "Telegram",
  gmb: "Google Business",
};

export function platformLabel(platform: string): string {
  return (
    PLATFORM_LABEL[platform.toLowerCase()] ?? platform.charAt(0).toUpperCase() + platform.slice(1)
  );
}

export function accountHandle(username: string | null | undefined, fallback: string): string {
  const value = username?.trim();
  if (!value) return fallback;
  return value.startsWith("@") ? value : `@${value}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.abs(diffMs) / 60000;
  if (absMinutes < 1) return "just now";
  if (absMinutes < 60) return relativeUnit(Math.round(diffMs / 60000), "minute");
  if (absMinutes < 60 * 24) return relativeUnit(Math.round(diffMs / 3600000), "hour");
  if (absMinutes < 60 * 24 * 7) return relativeUnit(Math.round(diffMs / 86400000), "day");
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function relativeUnit(value: number, unit: "minute" | "hour" | "day"): string {
  const count = Math.abs(value);
  const label = `${unit}${count === 1 ? "" : "s"}`;
  return value < 0 ? `${count} ${label} ago` : `in ${count} ${label}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * When a publication counts on the calendar, mirroring the web app:
 * scheduled/publishing use scheduled_at; published prefers actual_run_at.
 */
export function calendarOccurrence(pub: {
  status: string;
  scheduled_at?: string | null;
  actual_run_at?: string | null;
  updated_at?: string | null;
}): Date | null {
  const iso =
    pub.status === "published"
      ? (pub.actual_run_at ?? pub.scheduled_at ?? pub.updated_at)
      : (pub.scheduled_at ?? null);
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}
