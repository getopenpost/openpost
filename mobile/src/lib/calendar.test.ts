import { describe, expect, it } from "bun:test";

import { calendarWeeks } from "./calendar";

describe("calendarWeeks", () => {
  it("keeps every month in exact seven-day rows", () => {
    const weeks = calendarWeeks(new Date(2026, 7, 1));

    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0].map((date) => date?.getDate() ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      1,
    ]);
    expect(weeks[5].map((date) => date?.getDate() ?? null)).toEqual([
      30,
      31,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
