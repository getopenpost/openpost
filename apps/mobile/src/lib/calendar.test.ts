import { describe, expect, it } from "bun:test";

import { calendarWeeks, shiftCalendarMonth } from "./calendar";

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

it("preserves the selected day when moving between months, clamping only when needed", () => {
  for (const [year, month, day, delta, expected] of [
    [2026, 0, 31, 1, [2026, 1, 28]],
    [2024, 0, 31, 1, [2024, 1, 29]],
    [2026, 11, 15, 1, [2027, 0, 15]],
    [2026, 0, 15, -1, [2025, 11, 15]],
  ] as const) {
    const result = shiftCalendarMonth(new Date(year, month, day), delta);
    expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([...expected]);
  }
});
