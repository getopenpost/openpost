import { resolve as resolveCssColor } from "@asamuzakjp/css-color";
import type { components } from "@openpost/api-contract";

import { BUILTIN_ICON_ROLE_MAPS } from "./icon-packs";
import {
  NATIVE_CANVAS_TREATMENTS,
  NATIVE_COMPONENT_RECIPE_OPTIONS,
  NATIVE_MIN_TEXT_SIZE,
  NATIVE_THEME_CONTRACT_VERSION,
  type NativeActionStyle,
  type NativeColorRoles,
  type NativeFontWeight,
  type NativeIconPackId,
  type NativeProtectedEditorRoles,
  type NativeResolvedThemeContract,
  type NativeTextRole,
  type NativeThemeAssetResource,
  type NativeThemeFontResource,
  type NativeThemeManifest,
  type NativeThemeScheme,
} from "./contract";
import { deepFreeze } from "./freeze";
import { nativeThemeRuntimeFontFamily } from "./font-family";
import { readableThemeForeground, validateNativeThemeManifest } from "./validation";

const ICON_PACKS = new Set<NativeIconPackId>([
  "lucide",
  "heroicons-outline",
  "heroicons-solid",
  "phosphor",
  "tabler",
]);

const ASSET_SLOTS = new Set<NativeThemeAssetResource["slot"]>([
  "background-texture",
  "sidebar-decoration",
  "header-decoration",
  "empty-state-illustration",
  "loading-illustration",
]);

const ASSET_MEDIA_TYPES = new Set<NativeThemeAssetResource["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);

const ILLUSTRATION_SLOTS = new Set<NativeThemeAssetResource["slot"]>([
  "empty-state-illustration",
  "loading-illustration",
]);

export type ApiThemeTypographyRole = components["schemas"]["ThemeTypographyRoleTokens"];

// Wire types come from the generated OpenAPI contract so a domain change
// breaks this adapter at build time instead of drifting silently.
export type ApiThemeMotionRecipe = components["schemas"]["ThemeMotionRecipe"];

export type ApiResolvedThemeResponse = components["schemas"]["ResolvedTheme"];

export type NativeThemeAdaptation =
  | Readonly<{ ok: true; contract: NativeResolvedThemeContract }>
  | Readonly<{ ok: false; reason: "invalid-response" }>;

export function adaptResolvedThemeResponse({
  cacheIdentity,
  response,
  workspaceId,
}: {
  cacheIdentity: string;
  response: ApiResolvedThemeResponse;
  workspaceId: string;
}): NativeThemeAdaptation {
  try {
    const identity = cacheIdentity.trim();
    if (
      !identity ||
      !isText(workspaceId) ||
      !isText(response.id) ||
      !isText(response.revision) ||
      !isText(response.name) ||
      !["builtin", "organization", "fallback"].includes(response.source) ||
      (response.fallbackReason !== undefined && typeof response.fallbackReason !== "string") ||
      response.requestedScheme !== response.scheme ||
      (response.scheme !== "light" && response.scheme !== "dark") ||
      !ICON_PACKS.has(response.iconPack as NativeIconPackId)
    ) {
      return invalidResponse();
    }

    const iconPack = response.iconPack as NativeIconPackId;
    const resourceScope = {
      revision: response.revision,
      themeId: response.id,
      workspaceId,
    };
    const fonts = adaptFonts(response.fonts, resourceScope);
    const assets = adaptAssets(response.assets, resourceScope);
    if (!fonts || !assets) return invalidResponse();

    const manifest = adaptScheme({
      assets,
      displayName: response.name,
      familyId: response.id,
      fonts,
      iconPack,
      revision: response.revision,
      scheme: response.scheme,
      value: response.manifest,
    });
    if (!manifest) return invalidResponse();

    const resourceIdentity = `${identity}:resources:${JSON.stringify({
      assets: assets.map(({ alt, id, mimeType, slot, sourceUrl }) => [
        id,
        slot,
        sourceUrl,
        mimeType,
        alt ?? null,
      ]),
      fonts: fonts.map(
        ({ display, family, id, nativeDerivative, sourceFamily, sourceUrl, style, weight }) => [
          id,
          sourceFamily,
          family,
          sourceUrl,
          weight,
          style,
          display,
          nativeDerivative.sourceUrl,
          nativeDerivative.format,
          nativeDerivative.identity,
        ],
      ),
    })}`;
    const contract: NativeResolvedThemeContract = {
      contractVersion: NATIVE_THEME_CONTRACT_VERSION,
      identity,
      workspaceId,
      themeId: response.id,
      displayName: response.name,
      revision: response.revision,
      resolutionSource: response.source,
      ...(response.fallbackReason ? { fallbackReason: response.fallbackReason } : {}),
      supportedSchemes: [response.scheme],
      manifests: { [response.scheme]: manifest },
      resources: {
        identity: resourceIdentity,
        fonts,
        assets,
      },
    };
    return deepFreeze({ ok: true, contract });
  } catch {
    return invalidResponse();
  }
}

function adaptScheme({
  assets,
  displayName,
  familyId,
  fonts,
  iconPack,
  revision,
  scheme,
  value,
}: {
  assets: readonly NativeThemeAssetResource[];
  displayName: string;
  familyId: string;
  fonts: readonly NativeThemeFontResource[];
  iconPack: NativeIconPackId;
  revision: string;
  scheme: NativeThemeScheme;
  value: ApiResolvedThemeResponse["manifest"];
}): NativeThemeManifest | null {
  const colors = adaptColors(value.colors);
  const editor = adaptEditor(value.protectedEditor, value.colors.scrim);
  const typography = adaptTypography(value.typography, fonts);
  const shape = adaptShape(value.shape);
  const spacing = adaptSpacing(value.spacing);
  const motion = adaptMotion(value.motion);
  const shell = adaptShell(value.shell);
  const components = adaptComponents(value.components);
  if (!colors || !editor || !typography || !shape || !spacing || !motion || !shell || !components)
    return null;

  if (
    !isCompleteRecord(value.elevation, ["card", "popover", "dialog", "focalAction"]) ||
    !isCompleteRecord(value.shell, Object.keys(shell)) ||
    !isCompleteRecord(value.components, Object.keys(components))
  ) {
    return null;
  }

  const borderWidth = cssPixels(value.shape.borderWidth);
  const focalDepth = nativeElevationDepth(value.elevation.focalAction);
  if (borderWidth === null || borderWidth < 0 || borderWidth > 4 || focalDepth === null)
    return null;

  const manifest: NativeThemeManifest = {
    id: `${familyId}-${scheme}-${revision}`,
    familyId,
    displayName,
    scheme,
    colors,
    actions: {
      focal: action({
        border: colors.primary,
        borderWidth,
        container: nativeColor(value.colors.actionFocal),
        content: nativeColor(value.colors.actionFocalInk),
        depth: focalDepth,
        depthColor: colors.shadow,
        pressedContainer: nativeColor(value.colors.actionFocalActive),
      }),
      primary: action({
        border: nativeColor(value.colors.actionPrimary),
        borderWidth,
        container: nativeColor(value.colors.actionPrimary),
        content: nativeColor(value.colors.actionPrimaryInk),
        pressedContainer: nativeColor(value.colors.actionPrimaryActive),
      }),
      ordinary: action({
        border: nativeColor(value.colors.actionOrdinaryBorder),
        borderWidth,
        container: nativeColor(value.colors.actionOrdinary),
        content: nativeColor(value.colors.actionOrdinaryInk),
        pressedContainer: nativeColor(value.colors.actionOrdinaryActive),
      }),
      quiet: action({
        container: nativeColor(value.colors.actionQuiet),
        content: nativeColor(value.colors.actionQuietInk),
        pressedContainer: nativeColor(value.colors.actionQuietActive),
      }),
      destructive: action({
        container: nativeColor(value.colors.actionDestructive),
        content: nativeColor(value.colors.actionDestructiveInk),
        pressedContainer: nativeColor(value.colors.actionDestructiveActive),
      }),
      link: action({
        container: "#00000000",
        content: nativeColor(value.colors.actionLink),
        pressedContainer: "#00000000",
        pressedContent: nativeColor(value.colors.actionLinkHover),
        underline: true,
      }),
    },
    editor,
    typography,
    shape,
    spacing,
    motion,
    shell,
    components,
    assetSlots: Object.fromEntries(
      assets.map(({ alt, id, slot }) => [
        slot,
        {
          resourceId: id,
          ...(alt ? { alt } : {}),
        },
      ]),
    ),
    decoration: {
      celebration: [
        nativeColor(value.colors.chart1),
        nativeColor(value.colors.chart2),
        nativeColor(value.colors.chart3),
        nativeColor(value.colors.chart4),
        nativeColor(value.colors.chart5),
      ],
    },
    iconography: {
      packId: iconPack,
      roles: BUILTIN_ICON_ROLE_MAPS[iconPack],
    },
  };
  return validateNativeThemeManifest(manifest) ? manifest : null;
}

function adaptColors(value: Record<string, string>): NativeColorRoles | null {
  const background = nativeColor(value.canvas);
  const surface = nativeColor(value.surface);
  const onSurface = nativeColor(value.ink);
  const readable = (candidate: string) =>
    readableThemeForeground(candidate, onSurface, background, surface);
  const mapped = {
    background,
    surface,
    surfaceContainer: nativeColor(value.surfaceSunken),
    surfaceContainerHigh: nativeColor(value.surfaceRaised),
    onSurface,
    onSurfaceVariant: nativeColor(value.mutedInk),
    outline: nativeColor(value.border),
    outlineVariant: nativeColor(value.input),
    primary: nativeColor(value.brand),
    onPrimary: nativeColor(value.brandInk),
    primaryContainer: nativeColor(value.navigationActive),
    onPrimaryContainer: nativeColor(value.navigationActiveInk),
    secondaryContainer: nativeColor(value.selection),
    onSecondaryContainer: nativeColor(value.selectionInk),
    error: readable(nativeColor(value.danger)),
    onError: nativeColor(value.dangerInk),
    errorContainer: nativeColor(value.actionDestructive),
    onErrorContainer: nativeColor(value.actionDestructiveInk),
    success: nativeColor(value.success),
    onSuccess: nativeColor(value.successInk),
    warning: nativeColor(value.warning),
    onWarning: nativeColor(value.warningInk),
    link: readable(nativeColor(value.link)),
    focus: nativeColor(value.focus),
    scrim: nativeColor(value.scrim),
    shadow: nativeColor(value.ink),
    status: {
      draft: readable(nativeColor(value.mutedInk)),
      ready: readable(nativeColor(value.infoInk)),
      scheduled: readable(nativeColor(value.warningInk)),
      publishing: readable(nativeColor(value.actionFocal)),
      published: readable(nativeColor(value.successInk)),
      failed: readable(nativeColor(value.danger)),
    },
  };
  return allNativeColors(mapped) ? mapped : null;
}

function adaptEditor(
  value: Record<string, string>,
  scrim: string,
): NativeProtectedEditorRoles | null {
  const mapped = {
    canvas: nativeColor(value.editorCanvas),
    canvasGrid: nativeColor(value.canvasGrid),
    canvasSelection: nativeColor(value.canvasSelection),
    canvasSelectionText: nativeColor(value.protectedGlyph),
    transparencyLight: nativeColor(value.canvasPasteboard),
    transparencyDark: nativeColor(value.editorCanvas),
    timeline: nativeColor(value.editorPanel),
    timelineTrack: nativeColor(value.timelineTrack),
    timelinePlayhead: nativeColor(value.timelinePlayhead),
    waveform: nativeColor(value.timelineWaveform),
    handle: nativeColor(value.canvasHandle),
    safeArea: nativeColor(value.canvasSafeArea),
    mediaScrim: nativeColor(scrim),
  };
  return allNativeColors(mapped) ? mapped : null;
}

function adaptTypography(
  value: Record<string, ApiThemeTypographyRole>,
  fonts: readonly NativeThemeFontResource[],
): NativeThemeManifest["typography"] | null {
  const display = textRole(value.display, fonts);
  const title = textRole(value.title, fonts);
  const body = textRole(value.body, fonts);
  const label = textRole(value.label, fonts);
  const metadata = textRole(value.metadata, fonts);
  if (!display || !title || !body || !label || !metadata || !textRole(value.code, fonts)) {
    return null;
  }
  return {
    displayLarge: display,
    headlineLarge: title,
    titleLarge: title,
    titleMedium: label,
    bodyLarge: body,
    bodyMedium: body,
    bodySmall: metadata,
    labelLarge: label,
    labelMedium: metadata,
  };
}

function textRole(
  value: ApiThemeTypographyRole | undefined,
  fonts: readonly NativeThemeFontResource[],
): NativeTextRole | null {
  if (!value || !isText(value.family) || !Array.isArray(value.fallbacks)) return null;
  const parsedFontSize = cssPixels(value.size);
  const lineHeight = Number(value.lineHeight);
  const fontWeight = String(value.weight) as NativeFontWeight;
  if (
    parsedFontSize === null ||
    parsedFontSize <= 0 ||
    !Number.isFinite(lineHeight) ||
    lineHeight < 1 ||
    lineHeight > 2.5 ||
    !/^[1-9]00$/.test(fontWeight)
  ) {
    return null;
  }
  const fontSize = clampMetric(parsedFontSize, NATIVE_MIN_TEXT_SIZE, 64);
  const letterSpacing = cssTrackingPixels(value.tracking, fontSize);
  if (letterSpacing === null) return null;
  const face = fonts.find(
    (font) =>
      font.sourceFamily === value.family && font.weight === value.weight && font.style === "normal",
  );
  return {
    ...(face ? { fontFamily: face.family, fontResourceId: face.id } : {}),
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight: roundMetric(fontSize * lineHeight),
  };
}

function adaptShape(value: Record<string, string>): NativeThemeManifest["shape"] | null {
  const mapped = {
    extraSmall: cssPixels(value.radiusSm),
    small: cssPixels(value.radiusSm),
    medium: cssPixels(value.radiusMd),
    large: cssPixels(value.radiusLg),
    extraLarge: cssPixels(value.radiusMedia),
    full: cssPixels(value.radiusPill),
  };
  if (!allFiniteMetrics(mapped)) return null;
  const extraSmall = clampMetric(mapped.extraSmall!, 0, 16);
  const small = clampMetric(Math.max(mapped.small!, extraSmall), 0, 20);
  const medium = clampMetric(Math.max(mapped.medium!, small), 0, 32);
  const large = clampMetric(Math.max(mapped.large!, medium), 0, 32);
  const extraLarge = clampMetric(Math.max(mapped.extraLarge!, large), 0, 32);
  return {
    extraSmall,
    small,
    medium,
    large,
    extraLarge,
    full: clampMetric(Math.max(mapped.full!, extraLarge), 0, 999),
  };
}

function adaptSpacing(value: Record<string, string>): NativeThemeManifest["spacing"] | null {
  const base = cssPixels(value.base);
  const componentGap = cssPixels(value.componentGap);
  const sectionGap = cssPixels(value.sectionGap);
  const touchTarget = cssPixels(value.touchTarget);
  if (
    base === null ||
    componentGap === null ||
    sectionGap === null ||
    touchTarget === null ||
    touchTarget < 44
  ) {
    return null;
  }
  return {
    extraSmall: clampMetric(base, 2, 8),
    small: clampMetric(Math.max(base * 2, componentGap * (2 / 3)), 4, 16),
    medium: clampMetric(componentGap, 8, 20),
    large: clampMetric(Math.max(base * 4, componentGap * (4 / 3)), 12, 24),
    extraLarge: clampMetric(sectionGap, 16, 32),
    doubleExtraLarge: clampMetric(sectionGap + componentGap, 24, 48),
  };
}

function adaptMotion(value: Record<string, ApiThemeMotionRecipe | string>) {
  const press = motionMilliseconds(value.press);
  const selection = motionMilliseconds(value.selection);
  const page = motionMilliseconds(value.pageTransition);
  if (press === null || selection === null || page === null) return null;
  return { quickMs: press, standardMs: selection, emphasizedMs: page };
}

function adaptShell(value: Record<string, string>): NativeThemeManifest["shell"] | null {
  const contentMaxWidth = cssPixels(value.contentMaxWidth);
  const sidebarWidth = cssPixels(value.sidebarWidth);
  const headerHeight = cssPixels(value.headerHeight);
  const mobileNavigationHeight = cssPixels(value.mobileNavigationHeight);
  if (
    contentMaxWidth === null ||
    sidebarWidth === null ||
    headerHeight === null ||
    mobileNavigationHeight === null ||
    !NATIVE_CANVAS_TREATMENTS.some((candidate) => candidate === value.canvasTreatment)
  ) {
    return null;
  }
  return {
    contentMaxWidth: clampMetric(contentMaxWidth, 320, 4096),
    sidebarWidth: clampMetric(sidebarWidth, 160, 1024),
    headerHeight: clampMetric(headerHeight, 44, 256),
    mobileNavigationHeight: clampMetric(mobileNavigationHeight, 44, 256),
    canvasTreatment: value.canvasTreatment as NativeThemeManifest["shell"]["canvasTreatment"],
  };
}

function adaptComponents(value: Record<string, string>): NativeThemeManifest["components"] | null {
  const components: NativeThemeManifest["components"] = {
    button: value.button as NativeThemeManifest["components"]["button"],
    link: value.link as NativeThemeManifest["components"]["link"],
    tabs: value.tabs as NativeThemeManifest["components"]["tabs"],
    navigation: value.navigation as NativeThemeManifest["components"]["navigation"],
    input: value.input as NativeThemeManifest["components"]["input"],
    select: value.select as NativeThemeManifest["components"]["select"],
    card: value.card as NativeThemeManifest["components"]["card"],
    container: value.container as NativeThemeManifest["components"]["container"],
    table: value.table as NativeThemeManifest["components"]["table"],
    list: value.list as NativeThemeManifest["components"]["list"],
    badge: value.badge as NativeThemeManifest["components"]["badge"],
    chip: value.chip as NativeThemeManifest["components"]["chip"],
    dialog: value.dialog as NativeThemeManifest["components"]["dialog"],
    popover: value.popover as NativeThemeManifest["components"]["popover"],
    toast: value.toast as NativeThemeManifest["components"]["toast"],
    switch: value.switch as NativeThemeManifest["components"]["switch"],
    checkbox: value.checkbox as NativeThemeManifest["components"]["checkbox"],
    radio: value.radio as NativeThemeManifest["components"]["radio"],
    toolbar: value.toolbar as NativeThemeManifest["components"]["toolbar"],
    pagination: value.pagination as NativeThemeManifest["components"]["pagination"],
    emptyState: value.emptyState as NativeThemeManifest["components"]["emptyState"],
    loadingState: value.loadingState as NativeThemeManifest["components"]["loadingState"],
    editorChrome: value.editorChrome as NativeThemeManifest["components"]["editorChrome"],
    decoration: value.decoration as NativeThemeManifest["components"]["decoration"],
  };
  for (const key of Object.keys(
    NATIVE_COMPONENT_RECIPE_OPTIONS,
  ) as (keyof typeof NATIVE_COMPONENT_RECIPE_OPTIONS)[]) {
    if (!NATIVE_COMPONENT_RECIPE_OPTIONS[key].some((candidate) => candidate === components[key])) {
      return null;
    }
  }
  return components;
}

function adaptFonts(
  values: ApiResolvedThemeResponse["fonts"],
  resourceScope: ThemeResourceScope,
): readonly NativeThemeFontResource[] | null {
  if (!Array.isArray(values) || values.length > 16) return null;
  const seen = new Set<string>();
  const result: NativeThemeFontResource[] = [];
  for (const value of values) {
    if (
      !isText(value.id) ||
      seen.has(value.id) ||
      !isText(value.family) ||
      !validResourceUrl(value.sourceUrl, value.id, resourceScope) ||
      value.format !== "woff2" ||
      !value.nativeDerivative ||
      !validNativeFontUrl(
        value.nativeDerivative.sourceUrl,
        value.id,
        resourceScope,
        value.nativeDerivative.format,
      ) ||
      !/^[0-9a-f]{64}$/i.test(value.nativeDerivative.identity) ||
      !Number.isInteger(value.weight) ||
      value.weight < 100 ||
      value.weight > 900 ||
      value.weight % 100 !== 0 ||
      (value.style !== "normal" && value.style !== "italic") ||
      !["swap", "fallback", "optional"].includes(value.display)
    ) {
      return null;
    }
    seen.add(value.id);
    result.push({
      id: value.id,
      sourceFamily: value.family,
      family: nativeThemeRuntimeFontFamily(value.id),
      sourceUrl: value.sourceUrl,
      format: "woff2",
      nativeDerivative: {
        sourceUrl: value.nativeDerivative.sourceUrl,
        format: value.nativeDerivative.format as "ttf" | "otf",
        identity: value.nativeDerivative.identity.toLowerCase(),
      },
      weight: value.weight,
      style: value.style,
      display: value.display as NativeThemeFontResource["display"],
    });
  }
  return result;
}

function adaptAssets(
  values: ApiResolvedThemeResponse["assets"],
  resourceScope: ThemeResourceScope,
): readonly NativeThemeAssetResource[] | null {
  if (!Array.isArray(values) || values.length > ASSET_SLOTS.size) return null;
  const seen = new Set<string>();
  const slots = new Set<string>();
  const result: NativeThemeAssetResource[] = [];
  for (const value of values) {
    if (
      !isText(value.id) ||
      seen.has(value.id) ||
      slots.has(value.slot) ||
      !ASSET_SLOTS.has(value.slot as NativeThemeAssetResource["slot"]) ||
      !ASSET_MEDIA_TYPES.has(value.mimeType as NativeThemeAssetResource["mimeType"]) ||
      !validResourceUrl(value.sourceUrl, value.id, resourceScope) ||
      (value.alt !== undefined && (!isText(value.alt) || Array.from(value.alt).length > 240)) ||
      (ILLUSTRATION_SLOTS.has(value.slot as NativeThemeAssetResource["slot"]) && !isText(value.alt))
    ) {
      return null;
    }
    seen.add(value.id);
    slots.add(value.slot);
    result.push({
      id: value.id,
      slot: value.slot as NativeThemeAssetResource["slot"],
      sourceUrl: value.sourceUrl,
      mimeType: value.mimeType as NativeThemeAssetResource["mimeType"],
      ...(value.alt ? { alt: value.alt } : {}),
    });
  }
  return result;
}

interface ThemeResourceScope {
  revision: string;
  themeId: string;
  workspaceId: string;
}

function validResourceUrl(
  value: string,
  resourceId: string,
  { revision, themeId, workspaceId }: ThemeResourceScope,
): boolean {
  try {
    const url = new URL(value, "https://openpost.invalid");
    const parameters = [...url.searchParams.entries()];
    return (
      url.origin === "https://openpost.invalid" &&
      !url.hash &&
      url.pathname === `/api/v1/theme-assets/${encodeURIComponent(resourceId)}/content` &&
      parameters.length === 3 &&
      url.searchParams.get("workspace_id") === workspaceId &&
      url.searchParams.get("theme_id") === themeId &&
      url.searchParams.get("revision") === revision
    );
  } catch {
    return false;
  }
}

function validNativeFontUrl(
  value: string,
  resourceId: string,
  { revision, themeId, workspaceId }: ThemeResourceScope,
  format: string,
): boolean {
  if (format !== "ttf" && format !== "otf") return false;
  try {
    const url = new URL(value, "https://openpost.invalid");
    const parameters = [...url.searchParams.entries()];
    return (
      url.origin === "https://openpost.invalid" &&
      !url.hash &&
      url.pathname === `/api/v1/theme-assets/${encodeURIComponent(resourceId)}/content` &&
      parameters.length === 4 &&
      url.searchParams.get("workspace_id") === workspaceId &&
      url.searchParams.get("theme_id") === themeId &&
      url.searchParams.get("revision") === revision &&
      url.searchParams.get("format") === format
    );
  } catch {
    return false;
  }
}

function nativeColor(value: unknown): string {
  if (typeof value !== "string") return "";
  const converted = resolveCssColor(value, { format: "hexAlpha" });
  if (typeof converted !== "string") return "";
  if (/^#[0-9a-f]{6}$/i.test(converted)) return `${converted.toLowerCase()}ff`;
  return /^#[0-9a-f]{8}$/i.test(converted) ? converted.toLowerCase() : "";
}

function cssPixels(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const candidate = value.startsWith("clamp(")
    ? value.slice("clamp(".length, -1).split(",", 1)[0].trim()
    : value.trim();
  if (candidate === "0") return 0;
  const match = /^(-?[0-9]+(?:\.[0-9]+)?)(px|rem|em)$/.exec(candidate);
  if (!match) return null;
  const number = Number(match[1]);
  return roundMetric(match[2] === "px" ? number : number * 16);
}

function cssTrackingPixels(value: unknown, fontSize: number | null): number | null {
  if (typeof value !== "string" || fontSize === null) return null;
  if (value === "0") return 0;
  const match = /^(-?[0-9]+(?:\.[0-9]+)?)(px|rem|em)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  if (match[2] === "px") return roundMetric(number);
  return roundMetric(number * (match[2] === "em" ? fontSize : 16));
}

function motionMilliseconds(value: ApiThemeMotionRecipe | string | undefined): number | null {
  if (!value || typeof value === "string") return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)(ms|s)$/.exec(value.duration);
  if (!match) return null;
  const duration = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
  return Number.isFinite(duration) && duration >= 0 && duration <= 2000 ? duration : null;
}

function nativeElevationDepth(value: string): number | null {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length === 1 && tokens[0] === "none") return 0;
  const offsetIndex = tokens[0] === "inset" ? 1 : 0;
  const horizontalOffset = cssPixels(tokens[offsetIndex]);
  const verticalOffset = cssPixels(tokens[offsetIndex + 1]);
  if (horizontalOffset === null || verticalOffset === null) return null;
  return clampMetric(Math.max(0, verticalOffset), 0, 8);
}

function action({
  border = "#00000000",
  borderWidth = 0,
  container,
  content,
  depth = 0,
  depthColor = "#00000000",
  pressedContainer,
  pressedContent = content,
  underline = false,
}: {
  border?: string;
  borderWidth?: number;
  container: string;
  content: string;
  depth?: number;
  depthColor?: string;
  pressedContainer: string;
  pressedContent?: string;
  underline?: boolean;
}): NativeActionStyle {
  return {
    border,
    borderWidth,
    container,
    content,
    pressedContainer,
    pressedContent,
    depthColor,
    depth,
    disabledOpacity: 0.42,
    underline,
  };
}

function allNativeColors(value: object): boolean {
  return Object.values(value).every((candidate) => {
    if (typeof candidate === "string") return /^#[0-9a-f]{8}$/i.test(candidate);
    return candidate && typeof candidate === "object" && allNativeColors(candidate);
  });
}

function allFiniteMetrics(value: Record<string, number | null>): value is Record<string, number> {
  return Object.values(value).every(
    (candidate) => candidate !== null && Number.isFinite(candidate) && candidate >= 0,
  );
}

function isCompleteRecord(value: Record<string, string>, keys: readonly string[]): boolean {
  return keys.every((key) => isText(value[key]));
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidResponse(): NativeThemeAdaptation {
  return Object.freeze({ ok: false, reason: "invalid-response" });
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampMetric(value: number, minimum: number, maximum: number): number {
  return roundMetric(Math.min(Math.max(value, minimum), maximum));
}
