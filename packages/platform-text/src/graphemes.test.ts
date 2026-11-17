import { describe, expect, it } from "vitest";
import { countPlatformText } from "./index";

describe("Threads long grapheme clusters", () => {
  it("preserves character and emoji byte weights for long combining sequences", () => {
    const marks = "\u0301".repeat(50_000);
    expect(countPlatformText("threads", `a${marks}`)).toBe(1);
    expect(countPlatformText("threads", `👋${marks}`)).toBe(100_004);
  });
});
