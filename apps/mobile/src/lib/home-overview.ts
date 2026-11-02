import { calendarOccurrence, dayKey } from "./format";
import type { PublicationListItem } from "./queries";

/**
 * Shared Home projection for the native app. The sentence and row copy mirror
 * the web Home owner `apps/web/src/routes/home/+page.svelte` and its
 * `home_*` messages, so both surfaces answer the same questions the same way.
 */

export const HOME_HORIZON_DAYS = 14;
export const HOME_GOING_OUT_LIMIT = 5;

export interface HomeScheduledPost {
  id: string;
  publication: PublicationListItem;
  occurrence: Date;
}

export interface HomeNeedsYouCounts {
  failed: number;
  unreadReplies: number;
  unreadMessages: number;
  disconnected: number;
}

export type HomeNeedsYouKind = "failed" | "replies" | "messages" | "disconnected";

export interface HomeNeedsYouRow {
  kind: HomeNeedsYouKind;
  label: string;
}

function plural(count: number, one: string, many: (count: number) => string): string {
  return count === 1 ? one : many(count);
}

export function dayLabel(date: Date): string {
  return date.toLocaleDateString("en", { weekday: "long" });
}

/** Scheduled and publishing posts in the horizon, in authored time order. */
export function homeScheduledPosts(
  publications: readonly PublicationListItem[],
): HomeScheduledPost[] {
  const posts: HomeScheduledPost[] = [];
  for (const publication of publications) {
    if (publication.status !== "scheduled" && publication.status !== "publishing") continue;
    const occurrence = calendarOccurrence(publication);
    if (!occurrence) continue;
    posts.push({ id: publication.id, publication, occurrence });
  }
  return posts.sort((a, b) => a.occurrence.getTime() - b.occurrence.getTime());
}

export function homeTodayCount(posts: readonly HomeScheduledPost[], today: Date): number {
  const key = dayKey(today);
  return posts.filter((post) => dayKey(post.occurrence) === key).length;
}

/** One-sentence status, mirroring the web Home greeting. */
export function homeStatusSentence(input: {
  todayCount: number;
  nextOccurrence: Date | null;
}): string {
  if (input.todayCount > 0)
    return plural(
      input.todayCount,
      "1 post going out today",
      (count) => `${count} posts going out today`,
    );
  if (input.nextOccurrence) return `Next post goes out ${dayLabel(input.nextOccurrence)}`;
  return "Nothing scheduled yet";
}

/** Quiet closure line under the schedule, mirroring the web Home closure. */
export function homeClosureLine(input: {
  lastOccurrence: Date | null;
  today: Date;
}): string | null {
  if (!input.lastOccurrence) return null;
  if (dayKey(input.lastOccurrence) === dayKey(input.today)) return "You're covered for today";
  return `You're covered until ${dayLabel(input.lastOccurrence)}`;
}

/** Needs-you rows; empty counts hide, matching the web NeedsYouSection. */
export function homeNeedsYouRows(counts: HomeNeedsYouCounts): HomeNeedsYouRow[] {
  const rows: HomeNeedsYouRow[] = [];
  if (counts.failed > 0)
    rows.push({
      kind: "failed",
      label: plural(
        counts.failed,
        "1 post failed to publish",
        (count) => `${count} posts failed to publish`,
      ),
    });
  if (counts.unreadReplies > 0)
    rows.push({
      kind: "replies",
      label: plural(counts.unreadReplies, "1 unread reply", (count) => `${count} unread replies`),
    });
  if (counts.unreadMessages > 0)
    rows.push({
      kind: "messages",
      label: plural(
        counts.unreadMessages,
        "1 unread message",
        (count) => `${count} unread messages`,
      ),
    });
  if (counts.disconnected > 0)
    rows.push({
      kind: "disconnected",
      label: plural(
        counts.disconnected,
        "1 account is disconnected",
        (count) => `${count} accounts are disconnected`,
      ),
    });
  return rows;
}
