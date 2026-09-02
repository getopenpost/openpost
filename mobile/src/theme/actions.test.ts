import { describe, expect, test } from "bun:test";

import { BUILTIN_THEME_FAMILIES } from "./builtins";
import { ACTION_INTENTS, type NativeThemeManifest } from "./contract";
import {
  NATIVE_CONTROL_METRICS,
  NATIVE_MIN_TOUCH_TARGET,
  actionPresentation,
  appearanceLayoutPresentation,
  buttonRadius,
  cardPresentation,
  emptyStatePresentation,
  inputPresentation,
  loadingStatePresentation,
  navigationPresentation,
  sidebarDecorationWidth,
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

  test("renders each loading and empty-state recipe without letting assets choose the recipe", () => {
    const workshop = BUILTIN_THEME_FAMILIES.workshop.manifests.light!;
    const withRecipes = (
      loadingState: NativeThemeManifest["components"]["loadingState"],
      emptyState: NativeThemeManifest["components"]["emptyState"],
    ): NativeThemeManifest => ({
      ...workshop,
      components: { ...workshop.components, emptyState, loadingState },
    });

    expect(loadingStatePresentation(withRecipes("spinner", "plain"))).toEqual({
      animationDuration: workshop.motion.quickMs,
      kind: "spinner",
    });
    expect(loadingStatePresentation(withRecipes("pulse", "plain"))).toEqual({
      animationDuration: workshop.motion.standardMs,
      kind: "pulse",
    });
    expect(loadingStatePresentation(withRecipes("skeleton", "plain"))).toEqual({
      animationDuration: workshop.motion.standardMs,
      kind: "skeleton",
    });
    expect(emptyStatePresentation(withRecipes("spinner", "plain"))).toEqual({
      framed: false,
      illustrated: false,
    });
    expect(emptyStatePresentation(withRecipes("spinner", "illustrated"))).toEqual({
      framed: false,
      illustrated: true,
    });
    expect(emptyStatePresentation(withRecipes("spinner", "framed"))).toEqual({
      framed: true,
      illustrated: false,
    });
  });

  test("maps native navigation recipes while preserving the platform-owned height", () => {
    const playroom = BUILTIN_THEME_FAMILIES.playroom.manifests.light!;
    const studyHall = BUILTIN_THEME_FAMILIES["study-hall"].manifests.light!;

    expect(navigationPresentation(playroom)).toMatchObject({
      backgroundColor: playroom.colors.surfaceContainer,
      disableIndicator: false,
      indicatorColor: playroom.colors.primaryContainer,
      requestedHeight: 72,
      selectedColor: playroom.colors.onPrimaryContainer,
    });
    expect(navigationPresentation(studyHall)).toMatchObject({
      backgroundColor: studyHall.colors.surface,
      disableIndicator: true,
      requestedHeight: 72,
      selectedColor: studyHall.colors.primary,
      shadowColor: studyHall.colors.outline,
    });
  });

  test("bounds decorative sidebar art by the resolved shell width and narrow viewport", () => {
    const workshop = BUILTIN_THEME_FAMILIES.workshop.manifests.light!;

    expect(sidebarDecorationWidth(workshop, 320)).toBe(108.8);
    expect(sidebarDecorationWidth(workshop, 1024)).toBe(256);
  });

  test("reflows appearance content before accessibility text can squeeze horizontal rows", () => {
    expect(appearanceLayoutPresentation(1)).toEqual({ stackContent: false });
    expect(appearanceLayoutPresentation(1.6)).toEqual({ stackContent: true });
    expect(appearanceLayoutPresentation(Number.NaN)).toEqual({ stackContent: false });
  });
});
