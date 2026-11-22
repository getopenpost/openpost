import { describe, expect, test } from "bun:test";
import { analyticsAccountOptions } from "./analytics-accounts";
import { trendBars } from "./analytics-chart";
import { analyticsCalendarDate, analyticsPickerDate } from "./analytics-date-range";

describe("analytics helpers", () => {
  test("analytics dates stay on the UTC day across device timezone offsets", () => {
    expect(analyticsCalendarDate(new Date("2026-10-23T18:00:00-07:00"))).toBe("2026-10-24");
    expect(analyticsCalendarDate(new Date("2026-10-24T02:00:00+14:00"))).toBe("2026-10-23");
    expect(analyticsPickerDate("2026-10-24").toISOString()).toBe("2026-10-24T12:00:00.000Z");
  });

  test("follower losses extend below zero while gains extend above it", () => {
    const chart = trendBars([-10, 10, 0], 300, 100);
    expect(chart.baseline).toBe(50);
    expect(chart.bars).toEqual([
      { x: 0, y: 50, width: 98, height: 50 },
      { x: 100, y: 0, width: 98, height: 50 },
      { x: 200, y: 50, width: 98, height: 0 },
    ]);
  });

  test("preserves valid selected accounts and resets stale or empty selections", () => {
    const overviewAccounts = [
      { id: "account-1", platform: "mastodon", username: "alice" },
      { id: "account-2", platform: "x", username: "bob" },
    ];
    expect(analyticsAccountOptions(overviewAccounts, "account-2")).toMatchObject({
      effectiveAccountId: "account-2",
    });
    expect(analyticsAccountOptions([overviewAccounts[0]], "account-2").effectiveAccountId).toBe("");
    for (const empty of [undefined, null, []] as const) {
      expect(analyticsAccountOptions(empty, "account-2").effectiveAccountId).toBe("");
    }
    expect(analyticsAccountOptions(overviewAccounts, "").effectiveAccountId).toBe("");
  });
});
