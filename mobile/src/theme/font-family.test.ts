import { describe, expect, test } from "bun:test";

import { nativeThemeRuntimeFontFamily } from "./font-family";

describe("native theme font families", () => {
  test("creates a stable React Native registration name for each resource", () => {
    expect(nativeThemeRuntimeFontFamily("font-1")).toMatch(/^OpenPostTheme_font_1_[0-9a-f]{8}$/);
    expect(nativeThemeRuntimeFontFamily("font-1")).toBe(nativeThemeRuntimeFontFamily("font-1"));
    expect(nativeThemeRuntimeFontFamily("font/1")).not.toBe(nativeThemeRuntimeFontFamily("font-1"));
  });

  test("bounds long or non-ASCII resource IDs without losing identity", () => {
    const first = nativeThemeRuntimeFontFamily(`${"ø".repeat(80)}一`);
    const second = nativeThemeRuntimeFontFamily(`${"ø".repeat(80)}二`);

    expect(first.length).toBeLessThanOrEqual(64);
    expect(first).toMatch(/^OpenPostTheme_resource_[0-9a-f]{8}$/);
    expect(first).not.toBe(second);
  });
});
