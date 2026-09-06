import { describe, expect, it } from "bun:test";

import { applyPickerValue, firstPickerStep } from "./date-time-picker";

describe("Android schedule picker", () => {
  it("collects the date and time through supported native picker modes", () => {
    const initial = new Date(2026, 7, 27, 9, 30);

    expect(firstPickerStep("android")).toBe("date");
    expect(firstPickerStep("ios")).toBe("datetime");

    const afterDate = applyPickerValue(initial, new Date(2026, 7, 30, 0, 0), "date");
    expect(afterDate.value.toISOString()).toBe(new Date(2026, 7, 30, 9, 30).toISOString());
    expect(afterDate.nextStep).toBe("time");

    const afterTime = applyPickerValue(afterDate.value, new Date(2026, 7, 27, 14, 45), "time");
    expect(afterTime.value.toISOString()).toBe(new Date(2026, 7, 30, 14, 45).toISOString());
    expect(afterTime.nextStep).toBeNull();
  });
});
