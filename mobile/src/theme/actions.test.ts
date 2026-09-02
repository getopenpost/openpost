import { describe, expect, test } from "bun:test";

import { BUILTIN_THEME_FAMILIES } from "./builtins";
import { ACTION_INTENTS } from "./contract";
import {
  NATIVE_CONTROL_METRICS,
  NATIVE_MIN_TOUCH_TARGET,
  actionPresentation,
} from "./presentation";

describe("semantic native actions", () => {
  test("maps every intent without leaking component variants into callers", () => {
    const theme = BUILTIN_THEME_FAMILIES.workshop.manifests.light!;

    expect(ACTION_INTENTS).toEqual([
      "focal",
      "primary",
      "ordinary",
      "quiet",
      "destructive",
      "link",
    ]);
    for (const intent of ACTION_INTENTS) {
      const presentation = actionPresentation(theme, intent);
      expect(presentation.container.length).toBeGreaterThan(0);
      expect(presentation.content.length).toBeGreaterThan(0);
    }
    expect(actionPresentation(theme, "focal").depth).toBeGreaterThan(0);
    expect(actionPresentation(theme, "destructive").content).toBe(theme.colors.error);
    expect(NATIVE_MIN_TOUCH_TARGET).toBe(48);
    expect(NATIVE_CONTROL_METRICS).toEqual({
      buttonMinHeight: 48,
      iconButtonSize: 48,
      textFieldMinHeight: 52,
    });
  });
});
