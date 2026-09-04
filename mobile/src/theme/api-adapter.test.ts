import { describe, expect, test } from "bun:test";

import { adaptResolvedThemeResponse, type ApiResolvedThemeResponse } from "./api-adapter";
import { nativeThemeRuntimeFontFamily } from "./font-family";

describe("resolved theme API adapter", () => {
  test("converts a complete canonical scheme into React Native-safe values", () => {
    const adapted = adaptResolvedThemeResponse({
      cacheIdentity: '"organization:theme-1:7:light"',
      response: resolvedThemeFixture(),
      workspaceId: "workspace-1",
    });

    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;

    const manifest = adapted.contract.manifests.light!;
    expect(manifest.colors.primary).toBe("#b74c05ff");
    expect(manifest.colors.onPrimary).toBe("#fbfaf9ff");
    expect(manifest.colors.scrim).toBe("#1a151285");
    expect(manifest.actions.focal.pressedContainer).toBe("#a6470cff");
    expect(manifest.actions.focal.pressedContent).toBe("#fbfaf9ff");
    expect(manifest.actions.link).toMatchObject({
      pressedContainer: "#00000000",
      pressedContent: "#973900ff",
    });
    expect(manifest.typography.bodyMedium).toMatchObject({
      fontFamily: nativeThemeRuntimeFontFamily("font-1"),
      fontSize: 14,
      fontWeight: "400",
      letterSpacing: 0,
      lineHeight: 21,
    });
    expect(manifest.shape.medium).toBe(10);
    expect(manifest.spacing.extraSmall).toBe(4);
    expect(manifest.motion.quickMs).toBe(100);
    expect(manifest.shell).toEqual({
      contentMaxWidth: 1152,
      sidebarWidth: 256,
      headerHeight: 56,
      mobileNavigationHeight: 72,
      canvasTreatment: "plain",
    });
    expect(manifest.components).toMatchObject({
      button: "solid",
      card: "outlined",
      emptyState: "plain",
      loadingState: "skeleton",
    });
    expect(manifest.assetSlots).toEqual({
      "background-texture": {
        resourceId: "texture-1",
        alt: "Subtle paper texture",
      },
    });
    expect(manifest.iconography.packId).toBe("phosphor");
    expect(adapted.contract.resources.fonts).toEqual([
      {
        display: "swap",
        family: nativeThemeRuntimeFontFamily("font-1"),
        format: "woff2",
        id: "font-1",
        nativeDerivative: {
          format: "ttf",
          identity: "8f".repeat(32),
          sourceUrl:
            "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1&theme_id=theme-1&revision=7&format=ttf",
        },
        sourceUrl:
          "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1&theme_id=theme-1&revision=7",
        sourceFamily: "Example Sans",
        style: "normal",
        weight: 400,
      },
    ]);
    expect(adapted.contract.resources.assets[0]).toMatchObject({
      id: "texture-1",
      slot: "background-texture",
    });
    expect(adapted.contract.resources.identity).toContain(
      '"organization:theme-1:7:light":resources:',
    );
    expect(Object.isFrozen(adapted.contract.resources.fonts)).toBe(true);
  });

  test("rejects invalid responses instead of returning a partial native theme", () => {
    const invalidResponses: [string, () => ReturnType<typeof resolvedThemeFixture>][] = [
      [
        "unsafe color",
        () => {
          const response = resolvedThemeFixture();
          response.manifest.colors.actionFocalActive = "var(--missing)";
          return response;
        },
      ],
      [
        "unsupported shell recipe",
        () => {
          const response = resolvedThemeFixture();
          response.manifest.shell.canvasTreatment = "glassy" as never;
          return response;
        },
      ],
      [
        "unsupported component recipe",
        () => {
          const response = resolvedThemeFixture();
          response.manifest.components.card = "neumorphic" as never;
          return response;
        },
      ],
      [
        "unreadable destructive text",
        () => {
          const response = resolvedThemeFixture();
          response.manifest.colors.actionDestructive = response.manifest.colors.ink;
          response.manifest.colors.actionDestructiveActive = response.manifest.colors.ink;
          response.manifest.colors.actionDestructiveInk = response.manifest.colors.ink;
          return response;
        },
      ],
      [
        "wrong requested scheme",
        () => ({
          ...resolvedThemeFixture(),
          requestedScheme: "dark" as unknown as "light",
        }),
      ],
      [
        "font without a native derivative",
        () => {
          const response = resolvedThemeFixture();
          response.fonts[0]!.nativeDerivative = undefined as never;
          return response;
        },
      ],
      [
        "WOFF2 native font derivative",
        () => {
          const response = resolvedThemeFixture();
          response.fonts[0]!.nativeDerivative = {
            ...response.fonts[0]!.nativeDerivative,
            format: "woff2" as never,
          };
          return response;
        },
      ],
      [
        "illustration without alternative text",
        () => {
          const response = resolvedThemeFixture();
          response.assets[0]!.slot = "empty-state-illustration" as never;
          response.assets[0]!.alt = undefined as never;
          return response;
        },
      ],
      [
        "asset URL outside the resolved revision",
        () => {
          const response = resolvedThemeFixture();
          response.assets[0]!.sourceUrl =
            "/api/v1/theme-assets/texture-1/content?workspace_id=workspace-1&theme_id=theme-1&revision=6";
          return response;
        },
      ],
      [
        "derivative URL with missing revision scope",
        () => {
          const response = resolvedThemeFixture();
          response.fonts[0]!.nativeDerivative.sourceUrl =
            "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1&theme_id=theme-1&format=ttf";
          return response;
        },
      ],
      [
        "derivative URL with extra query scope",
        () => {
          const response = resolvedThemeFixture();
          response.fonts[0]!.nativeDerivative.sourceUrl =
            "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1&theme_id=theme-1&revision=7&format=ttf&cache=1";
          return response;
        },
      ],
    ];

    for (const [name, build] of invalidResponses) {
      expect(
        adaptResolvedThemeResponse({
          cacheIdentity: "theme-1:7:light",
          response: build(),
          workspaceId: "workspace-1",
        }),
        name,
      ).toEqual({ ok: false, reason: "invalid-response" });
    }
  });

  test("uses the theme text role when an accent is unsafe as native status text", () => {
    const response = resolvedThemeFixture();
    response.manifest.colors.actionFocal = "oklch(0.8 0.1 80)";
    response.manifest.colors.actionFocalHover = "oklch(0.85 0.085 80)";
    response.manifest.colors.actionFocalActive = "oklch(0.9 0.07 80)";
    response.manifest.colors.actionFocalInk = response.manifest.colors.ink;

    const adapted = adaptResolvedThemeResponse({
      cacheIdentity: "theme-1:7:light",
      response,
      workspaceId: "workspace-1",
    });

    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.contract.manifests.light!.colors.status.publishing).toBe("#897047ff");
  });

  test("clamps desktop-safe dimensions to usable native metrics", () => {
    const response = resolvedThemeFixture();
    response.manifest.typography.title.size = "16rem";
    response.manifest.typography.metadata.size = "0.5rem";
    response.manifest.shape.radiusMd = "16rem";
    response.manifest.spacing.sectionGap = "16rem";

    const adapted = adaptResolvedThemeResponse({
      cacheIdentity: "theme-1:7:light",
      response,
      workspaceId: "workspace-1",
    });

    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.contract.manifests.light!.typography.titleLarge.fontSize).toBe(64);
    expect(adapted.contract.manifests.light!.typography.bodySmall.fontSize).toBe(11);
    expect(adapted.contract.manifests.light!.shape.medium).toBe(32);
    expect(adapted.contract.manifests.light!.spacing.extraLarge).toBe(32);
    expect(adapted.contract.manifests.light!.spacing.doubleExtraLarge).toBe(48);
  });

  test("carries focal action elevation into the native presentation", () => {
    const response = resolvedThemeFixture();
    response.manifest.elevation.focalAction =
      "0 5px 14px -8px color-mix(in oklch, black 72%, transparent)";

    const adapted = adaptResolvedThemeResponse({
      cacheIdentity: "theme-1:7:light",
      response,
      workspaceId: "workspace-1",
    });

    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    const manifest = adapted.contract.manifests.light!;
    expect(manifest.actions.focal).toMatchObject({
      depth: 5,
      depthColor: manifest.colors.shadow,
    });
  });
});

function resolvedThemeFixture(): ApiResolvedThemeResponse {
  const ink = "oklch(0.2 0.01 50)";
  const canvas = "oklch(0.985 0.002 80)";
  const brand = "oklch(0.55 0.155 45)";
  const surface = "oklch(1 0 0)";
  const sunken = "oklch(0.95 0.003 80)";
  const border = "oklch(0.9 0.005 80)";
  const muted = "oklch(0.52 0.015 55)";
  const danger = "oklch(0.57 0.22 25)";

  return {
    id: "theme-1",
    revision: "7",
    name: "Northstar",
    iconPack: "phosphor" as const,
    source: "organization" as const,
    requestedScheme: "light" as const,
    scheme: "light" as const,
    fallbackReason: undefined,
    manifest: {
      colors: {
        brand,
        brandInk: canvas,
        workspace: "oklch(0.93 0.04 45)",
        workspaceInk: ink,
        canvas,
        ink,
        surface,
        surfaceRaised: surface,
        surfaceSunken: sunken,
        mutedInk: muted,
        border,
        input: border,
        focus: brand,
        selection: "oklch(0.93 0.04 45)",
        selectionInk: ink,
        caret: brand,
        link: brand,
        danger,
        dangerInk: canvas,
        success: "oklch(0.92 0.035 155)",
        successInk: "oklch(0.39 0.12 160)",
        warning: "oklch(0.94 0.055 80)",
        warningInk: "oklch(0.42 0.105 70)",
        info: "oklch(0.93 0.035 245)",
        infoInk: "oklch(0.4 0.12 245)",
        actionFocal: brand,
        actionFocalInk: canvas,
        actionFocalHover: "oklch(0.52 0.15 45)",
        actionFocalActive: "color-mix(in oklch, oklch(0.55 0.155 45) 90%, oklch(0.2 0.01 50))",
        actionPrimary: ink,
        actionPrimaryInk: canvas,
        actionPrimaryHover: "oklch(0.28 0.01 50)",
        actionPrimaryActive: "oklch(0.32 0.01 50)",
        actionOrdinary: sunken,
        actionOrdinaryInk: ink,
        actionOrdinaryBorder: border,
        actionOrdinaryHover: border,
        actionOrdinaryActive: "oklch(0.85 0.005 80)",
        actionQuiet: "transparent",
        actionQuietInk: ink,
        actionQuietHover: sunken,
        actionQuietActive: border,
        actionDestructive: "oklch(0.96 0.02 25)",
        actionDestructiveInk: "oklch(0.43 0.2 25)",
        actionDestructiveHover: "oklch(0.92 0.04 25)",
        actionDestructiveActive: "oklch(0.88 0.06 25)",
        actionLink: brand,
        actionLinkHover: "oklch(0.47 0.14 45)",
        disabled: sunken,
        disabledInk: muted,
        field: surface,
        fieldInk: ink,
        fieldBorder: border,
        fieldHover: sunken,
        fieldFocus: surface,
        fieldDisabled: sunken,
        fieldDisabledInk: muted,
        cardHover: sunken,
        navigationHover: sunken,
        navigationActive: "oklch(0.93 0.04 45)",
        navigationActiveInk: ink,
        sidebar: canvas,
        sidebarInk: ink,
        sidebarActive: "oklch(0.93 0.04 45)",
        sidebarActiveInk: ink,
        sidebarBorder: border,
        chrome: surface,
        chromeInk: ink,
        browserSurface: canvas,
        browserChrome: surface,
        overlay: "color-mix(in oklch, oklch(0.2 0.01 50) 12%, transparent)",
        scrim: "color-mix(in oklch, oklch(0.2 0.01 50) 52%, transparent)",
        chart1: brand,
        chart2: "oklch(0.54 0.12 165)",
        chart3: "oklch(0.54 0.12 245)",
        chart4: "oklch(0.63 0.13 80)",
        chart5: "oklch(0.52 0.13 320)",
      },
      protectedEditor: {
        editorCanvas: ink,
        editorPanel: ink,
        editorControl: muted,
        editorControlHover: muted,
        editorBorder: muted,
        editorMuted: border,
        editorText: canvas,
        editorFocus: brand,
        editorFocusBorder: brand,
        timelineTrack: ink,
        timelineClip: "oklch(0.31 0.04 250)",
        timelineWaveform: "oklch(0.74 0.04 245)",
        timelinePlayhead: brand,
        timelineSelection: brand,
        canvasPasteboard: ink,
        canvasGrid: muted,
        canvasHandle: surface,
        canvasSelection: brand,
        canvasSafeArea: "oklch(0.78 0.03 245 / 0.72)",
        protectedGlyph: canvas,
      },
      typography: {
        display: typeRole("2rem", "1.05", 600, "-0.035em"),
        title: typeRole("1.5rem", "1.15", 600, "-0.025em"),
        body: typeRole("0.875rem", "1.5", 400, "0em"),
        label: typeRole("0.8125rem", "1.25", 600, "0em"),
        metadata: typeRole("0.75rem", "1.35", 500, "0.015em"),
        code: typeRole("0.8125rem", "1.45", 400, "0em"),
      },
      spacing: {
        density: "comfortable" as const,
        base: "0.25rem",
        controlHeight: "2.25rem",
        compactControlHeight: "2rem",
        touchTarget: "3rem",
        pageGutter: "1rem",
        sectionGap: "1.5rem",
        componentGap: "0.75rem",
      },
      shape: {
        radius: "0.75rem",
        radiusSm: "0.5rem",
        radiusMd: "0.625rem",
        radiusLg: "0.75rem",
        radiusMedia: "0.875rem",
        radiusPill: "9999px",
        borderWidth: "1px",
        borderStyle: "solid" as const,
      },
      elevation: {
        card: "none",
        popover: "none",
        dialog: "none",
        focalAction: "none",
      },
      motion: {
        press: motion("100ms", "1px", 1),
        hover: motion("160ms", "0px", 1),
        selection: motion("160ms", "0px", 1),
        entry: motion("240ms", "8px", 0),
        exit: motion("160ms", "4px", 0),
        loading: motion("900ms", "0px", 0.45),
        pageTransition: motion("240ms", "12px", 0),
        reducedMotion: "instant" as const,
      },
      shell: {
        contentMaxWidth: "72rem",
        sidebarWidth: "16rem",
        headerHeight: "3.5rem",
        mobileNavigationHeight: "4.5rem",
        canvasTreatment: "plain" as const,
      },
      components: {
        button: "solid",
        link: "underlined",
        tabs: "underline",
        navigation: "quiet",
        input: "outlined",
        select: "outlined",
        card: "outlined",
        container: "flat",
        table: "ruled",
        list: "divided",
        badge: "tonal",
        chip: "tonal",
        dialog: "elevated",
        popover: "elevated",
        toast: "outlined",
        switch: "solid",
        checkbox: "solid",
        radio: "solid",
        toolbar: "flat",
        pagination: "quiet",
        emptyState: "plain",
        loadingState: "skeleton",
        editorChrome: "neutral",
        decoration: "none",
      },
    },
    fonts: [
      {
        id: "font-1",
        family: "Example Sans",
        sourceUrl:
          "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1&theme_id=theme-1&revision=7",
        format: "woff2" as const,
        nativeDerivative: {
          sourceUrl:
            "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1&theme_id=theme-1&revision=7&format=ttf",
          format: "ttf" as const,
          identity: "8f".repeat(32),
        },
        weight: 400,
        style: "normal" as const,
        display: "swap" as const,
      },
    ],
    assets: [
      {
        id: "texture-1",
        slot: "background-texture" as const,
        sourceUrl:
          "/api/v1/theme-assets/texture-1/content?workspace_id=workspace-1&theme_id=theme-1&revision=7",
        mimeType: "image/avif",
        alt: "Subtle paper texture",
      },
    ],
  };
}

function typeRole(size: string, lineHeight: string, weight: number, tracking: string) {
  return {
    family: "Example Sans",
    fallbacks: ["system-ui", "sans-serif"],
    weight,
    size,
    lineHeight,
    tracking,
  };
}

function motion(duration: string, distance: string, opacity: number) {
  return {
    duration,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    distance,
    opacity,
  };
}
