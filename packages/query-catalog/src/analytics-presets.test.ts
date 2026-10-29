import { describe, expect, it } from "vitest";
import {
  analyticsCalendarPresetRange,
  analyticsOverviewQueryOptions,
  analyticsQueryKeys,
} from "./analytics";

describe("shared analytics calendar ranges", () => {
  it.each([
    ["month_to_date", "2026-10-29T00:30:00+01:00", "2026-10-01", "2026-10-28"],
    ["last_month", "2026-01-04T12:00:00Z", "2025-12-01", "2025-12-31"],
    ["last_month", "2024-03-01T00:00:00Z", "2024-02-01", "2024-02-29"],
    ["month_to_date", "2026-03-01T00:30:00+09:00", "2026-02-01", "2026-02-28"],
  ] as const)("resolves %s at %s to inclusive UTC dates", (preset, now, from, to) => {
    expect(analyticsCalendarPresetRange(preset, new Date(now))).toEqual({ days: 0, from, to });
  });

  it("keeps preset boundaries and visibility sorting isolated in the shared cache", () => {
    const range = analyticsCalendarPresetRange("last_month", new Date("2026-10-29T12:00:00Z"));
    const key = analyticsQueryKeys.overview("workspace", { ...range, sort: "visibility" });
    expect(key).not.toEqual(analyticsQueryKeys.overview("workspace", { ...range, sort: "views" }));
    expect(key).not.toEqual(
      analyticsQueryKeys.overview("other-workspace", { ...range, sort: "visibility" }),
    );
    expect(key).not.toEqual(
      analyticsQueryKeys.overview("workspace", { days: 0, sort: "visibility" }),
    );
  });

  it("bridges a filter change only within the same workspace", () => {
    const options = analyticsOverviewQueryOptions(
      {
        getAnalyticsOverview: async () => {
          throw new Error("not called");
        },
      },
      "workspace-a",
      { days: 30, accountId: "selected" },
    );
    const previous = { pages: [], pageParams: [""] };
    expect(
      options.placeholderData(previous, {
        queryKey: analyticsQueryKeys.overview("workspace-a", { days: 7 }),
      }),
    ).toBe(previous);
    expect(
      options.placeholderData(previous, {
        queryKey: analyticsQueryKeys.overview("workspace-b", { days: 7 }),
      }),
    ).toBeUndefined();
    expect(options.placeholderData(previous, undefined)).toBeUndefined();
  });
});
