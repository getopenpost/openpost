import { describe, expect, test } from "bun:test";

import { BUILTIN_THEME_FAMILIES } from "./builtins";
import { ACTION_INTENTS } from "./contract";
import {
  NATIVE_CONTROL_METRICS,
  NATIVE_MIN_TOUCH_TARGET,
  actionPresentation,
  buttonRadius,
  cardPresentation,
  inputPresentation,
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
    expect(actionPresentation(theme, "destructive").content).toBe(theme.colors.onErrorContainer);
    expect(NATIVE_MIN_TOUCH_TARGET).toBe(48);
    expect(NATIVE_CONTROL_METRICS).toEqual({
      buttonMinHeight: 48,
      iconButtonSize: 48,
      textFieldMinHeight: 52,
    });
  });

  test("turns canonical component recipes into distinct native chrome", () => {
    const workshop = BUILTIN_THEME_FAMILIES.workshop.manifests.light!;
    const notebook = BUILTIN_THEME_FAMILIES.notebook.manifests.light!;
    const playroom = BUILTIN_THEME_FAMILIES.playroom.manifests.light!;
    const cloudGarden = BUILTIN_THEME_FAMILIES["cloud-garden"].manifests.light!;

    expect(cardPresentation(workshop)).toMatchObject({ borderWidth: 1, elevation: 0 });
    expect(cardPresentation(notebook)).toMatchObject({
      backgroundColor: notebook.colors.surfaceContainerHigh,
      borderRadius: notebook.shape.small,
      borderWidth: 1,
    });
    expect(cardPresentation(cloudGarden)).toMatchObject({ borderWidth: 0, elevation: 4 });
    expect(inputPresentation(notebook)).toMatchObject({
      backgroundColor: "transparent",
      borderBottomWidth: 1,
      borderRadius: 0,
      borderWidth: 0,
    });
    expect(buttonRadius(playroom)).toBe(playroom.shape.large);
  });
});
