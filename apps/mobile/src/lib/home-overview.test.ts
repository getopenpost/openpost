import { describe, expect, test } from "bun:test";

import {
  HOME_GOING_OUT_LIMIT,
  homeClosureLine,
  homeNeedsYouRows,
  homeScheduledPosts,
  homeStatusSentence,
  homeTodayCount,
} from "./home-overview";
import type { PublicationListItem } from "./queries";

const DAY = 86400000;

function scheduledPublication(id: string, daysFromNow: number, status = "scheduled") {
  return {
    id,
    status,
    scheduled_at: new Date(Date.now() + daysFromNow * DAY).toISOString(),
  } as unknown as PublicationListItem;
}

function scheduledPublicationAt(id: string, date: Date, status = "scheduled") {
  return { id, status, scheduled_at: date.toISOString() } as unknown as PublicationListItem;
}

describe("home scheduled posts", () => {
  test("keeps scheduled and publishing posts in authored time order", () => {
    const posts = homeScheduledPosts([
      scheduledPublication("draft", 2, "draft"),
      scheduledPublication("later", 3),
      scheduledPublication("next", 1),
      scheduledPublication("publishing", 0, "publishing"),
      scheduledPublication("failed", 1, "failed"),
    ]);
    expect(posts.map((post) => post.id)).toEqual(["publishing", "next", "later"]);
  });

  test("caps the going-out list without changing the schedule counts", () => {
    const posts = homeScheduledPosts(
      Array.from({ length: 8 }, (_, index) => scheduledPublication(`post-${index}`, index + 1)),
    );
    expect(posts.length).toBe(8);
    expect(posts.slice(0, HOME_GOING_OUT_LIMIT).length).toBe(5);
  });
});

describe("home status sentence", () => {
  const today = new Date();

  test("counts today's posts first", () => {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const posts = homeScheduledPosts([
      scheduledPublicationAt("today-early", new Date(noon.getTime() + 3 * 3600000)),
      scheduledPublicationAt("today-late", new Date(noon.getTime() + 4 * 3600000)),
      scheduledPublication("tomorrow", 1),
    ]);
    expect(
      homeStatusSentence({ todayCount: homeTodayCount(posts, today), nextOccurrence: null }),
    ).toBe("2 posts going out today");
  });

  test("falls back to the next post's weekday", () => {
    expect(
      homeStatusSentence({
        todayCount: 0,
        nextOccurrence: new Date(today.getTime() + 3 * DAY),
      }),
    ).toBe(
      `Next post goes out ${new Date(today.getTime() + 3 * DAY).toLocaleDateString("en", { weekday: "long" })}`,
    );
  });

  test("states calm when nothing is scheduled", () => {
    expect(homeStatusSentence({ todayCount: 0, nextOccurrence: null })).toBe(
      "Nothing scheduled yet",
    );
  });
});

describe("home closure line", () => {
  const today = new Date();

  test("closes the day when the last post is today", () => {
    expect(homeClosureLine({ lastOccurrence: today, today })).toBe("You're covered for today");
  });

  test("covers until the last post's weekday", () => {
    const thursday = new Date(today.getTime() + 4 * DAY);
    expect(homeClosureLine({ lastOccurrence: thursday, today })).toBe(
      `You're covered until ${thursday.toLocaleDateString("en", { weekday: "long" })}`,
    );
  });

  test("stays quiet without a schedule", () => {
    expect(homeClosureLine({ lastOccurrence: null, today })).toBeNull();
  });
});

describe("home needs you", () => {
  test("hides empty needs", () => {
    expect(
      homeNeedsYouRows({ failed: 0, unreadReplies: 0, unreadMessages: 0, disconnected: 0 }),
    ).toEqual([]);
  });

  test("labels each attention row with the web copy", () => {
    const rows = homeNeedsYouRows({
      failed: 2,
      unreadReplies: 1,
      unreadMessages: 3,
      disconnected: 1,
    });
    expect(rows).toEqual([
      { kind: "failed", label: "2 posts failed to publish" },
      { kind: "replies", label: "1 unread reply" },
      { kind: "messages", label: "3 unread messages" },
      { kind: "disconnected", label: "1 account is disconnected" },
    ]);
  });

  test("uses singular copy for one failed post", () => {
    expect(
      homeNeedsYouRows({ failed: 1, unreadReplies: 0, unreadMessages: 0, disconnected: 0 }),
    ).toEqual([{ kind: "failed", label: "1 post failed to publish" }]);
  });
});
