import {
  ACTION_INTENTS,
  NATIVE_ICON_ROLES,
  PUBLICATION_STATUSES,
  type NativeIconPackId,
  type NativeTextRole,
  type NativeThemeManifest,
} from "./contract";
import { BUILTIN_ICON_ROLE_MAPS } from "./icon-packs";

const COLOR_KEYS = [
  "background",
  "surface",
  "surfaceContainer",
  "surfaceContainerHigh",
  "onSurface",
  "onSurfaceVariant",
  "outline",
  "outlineVariant",
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondaryContainer",
  "onSecondaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "success",
  "onSuccess",
  "warning",
  "onWarning",
  "link",
  "focus",
  "scrim",
  "shadow",
] as const;

const EDITOR_COLOR_KEYS = [
  "canvas",
  "canvasGrid",
  "canvasSelection",
  "canvasSelectionText",
  "transparencyLight",
  "transparencyDark",
  "timeline",
  "timelineTrack",
  "timelinePlayhead",
  "waveform",
  "handle",
  "safeArea",
  "mediaScrim",
] as const;

const TYPOGRAPHY_KEYS = [
  "displayLarge",
  "headlineLarge",
  "titleLarge",
  "titleMedium",
  "bodyLarge",
  "bodyMedium",
  "bodySmall",
  "labelLarge",
  "labelMedium",
] as const;

type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

export function validateNativeThemeManifest(
  value: NativeThemeManifest | null | undefined,
): value is NativeThemeManifest {
  if (
    !value ||
    !boundedText(value.id, 256) ||
    !boundedText(value.familyId, 256) ||
    !boundedText(value.displayName, 80) ||
    (value.scheme !== "light" && value.scheme !== "dark")
  ) {
    return false;
  }

  const colors = value.colors;
  if (
    !colors ||
    COLOR_KEYS.some((key) => !parseNativeColor(colors[key])) ||
    PUBLICATION_STATUSES.some((status) => !parseNativeColor(colors.status?.[status]))
  ) {
    return false;
  }

  if (
    !hasReadableContrast(colors.onSurface, colors.background, 4.5) ||
    !hasReadableContrast(colors.onSurface, colors.surface, 4.5) ||
    !hasReadableContrast(colors.onSurfaceVariant, colors.background, 4.5) ||
    !hasReadableContrast(colors.onSurfaceVariant, colors.surface, 4.5) ||
    !hasReadableContrast(colors.primary, colors.onPrimary, 4.5) ||
    PUBLICATION_STATUSES.some(
      (status) =>
        !hasReadableContrast(colors.status[status], colors.background, 4.5) ||
        !hasReadableContrast(colors.status[status], colors.surface, 4.5),
    )
  ) {
    return false;
  }

  if (
    ACTION_INTENTS.some((intent) => {
      const action = value.actions?.[intent];
      if (
        !action ||
        !parseNativeColor(action.container) ||
        !parseNativeColor(action.content) ||
        !parseNativeColor(action.border) ||
        !parseNativeColor(action.pressedContainer) ||
        !parseNativeColor(action.depthColor) ||
        !boundedNumber(action.borderWidth, 0, 4) ||
        !boundedNumber(action.depth, 0, 8) ||
        !boundedNumber(action.disabledOpacity, 0, 1) ||
        typeof action.underline !== "boolean"
      ) {
        return true;
      }
      return (
        ((intent === "focal" || intent === "primary" || intent === "ordinary") &&
          !hasReadableContrast(action.content, action.container, 4.5)) ||
        ((intent === "quiet" || intent === "destructive" || intent === "link") &&
          (!hasReadableContrast(action.content, colors.background, 4.5) ||
            !hasReadableContrast(action.content, colors.surface, 4.5)))
      );
    })
  ) {
    return false;
  }

  if (EDITOR_COLOR_KEYS.some((key) => !parseNativeColor(value.editor?.[key]))) return false;
  if (TYPOGRAPHY_KEYS.some((key) => !validTextRole(value.typography?.[key]))) return false;

  const shape = value.shape;
  if (
    !shape ||
    !boundedNumber(shape.extraSmall, 0, 16) ||
    !boundedNumber(shape.small, shape.extraSmall, 20) ||
    !boundedNumber(shape.medium, shape.small, 32) ||
    !boundedNumber(shape.large, shape.medium, 32) ||
    !boundedNumber(shape.extraLarge, shape.large, 32) ||
    !boundedNumber(shape.full, shape.extraLarge, 999)
  ) {
    return false;
  }

  const spacing = value.spacing;
  if (
    !spacing ||
    !boundedNumber(spacing.extraSmall, 2, 8) ||
    !boundedNumber(spacing.small, spacing.extraSmall, 16) ||
    !boundedNumber(spacing.medium, spacing.small, 20) ||
    !boundedNumber(spacing.large, spacing.medium, 24) ||
    !boundedNumber(spacing.extraLarge, spacing.large, 32) ||
    !boundedNumber(spacing.doubleExtraLarge, spacing.extraLarge, 48)
  ) {
    return false;
  }

  const motion = value.motion;
  if (
    !motion ||
    !boundedNumber(motion.quickMs, 0, 2000) ||
    !boundedNumber(motion.standardMs, motion.quickMs, 2000) ||
    !boundedNumber(motion.emphasizedMs, motion.standardMs, 2000)
  ) {
    return false;
  }

  const packId = value.iconography?.packId as NativeIconPackId | undefined;
  const protectedRoleMap = packId ? BUILTIN_ICON_ROLE_MAPS[packId] : undefined;
  return (
    Array.isArray(value.decoration?.celebration) &&
    value.decoration.celebration.length > 0 &&
    value.decoration.celebration.length <= 12 &&
    value.decoration.celebration.every((color) => parseNativeColor(color) !== null) &&
    protectedRoleMap !== undefined &&
    NATIVE_ICON_ROLES.every((role) => value.iconography?.roles?.[role] === protectedRoleMap[role])
  );
}

export function isReadableOnThemeSurfaces(
  foreground: string,
  background: string,
  surface: string,
): boolean {
  return (
    hasReadableContrast(foreground, background, 4.5) &&
    hasReadableContrast(foreground, surface, 4.5)
  );
}

export function readableThemeForeground(
  preferred: string,
  fallback: string,
  background: string,
  surface: string,
): string {
  if (isReadableOnThemeSurfaces(preferred, background, surface)) return preferred;

  const preferredColor = parseNativeColor(preferred);
  const fallbackColor = parseNativeColor(fallback);
  if (
    !preferredColor ||
    !fallbackColor ||
    preferredColor[3] !== 1 ||
    fallbackColor[3] !== 1 ||
    !isReadableOnThemeSurfaces(fallback, background, surface)
  ) {
    return fallback;
  }

  let lower = 0;
  let upper = 1;
  let result = fallback;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const amount = (lower + upper) / 2;
    const blend = (index: 0 | 1 | 2) =>
      preferredColor[index] + (fallbackColor[index] - preferredColor[index]) * amount;
    const candidate = serializeNativeColor([blend(0), blend(1), blend(2), 1]);
    if (isReadableOnThemeSurfaces(candidate, background, surface)) {
      result = candidate;
      upper = amount;
    } else {
      lower = amount;
    }
  }
  return result;
}

function validTextRole(value: NativeTextRole | null | undefined): boolean {
  if (
    !value ||
    !boundedNumber(value.fontSize, 10, 64) ||
    !boundedNumber(value.lineHeight, value.fontSize, value.fontSize * 2.5) ||
    !boundedNumber(value.letterSpacing, value.fontSize * -0.04, value.fontSize * 0.2) ||
    !/^[1-9]00$/.test(value.fontWeight)
  ) {
    return false;
  }
  const hasFamily = value.fontFamily !== undefined;
  const hasResource = value.fontResourceId !== undefined;
  return (
    hasFamily === hasResource &&
    (!hasFamily || (boundedText(value.fontFamily, 120) && boundedText(value.fontResourceId, 256)))
  );
}

function parseNativeColor(value: unknown): Rgba | null {
  if (value === "transparent") return [0, 0, 0, 0];
  if (typeof value !== "string") return null;

  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (hex) {
    return [
      Number.parseInt(hex[1]!.slice(0, 2), 16),
      Number.parseInt(hex[1]!.slice(2, 4), 16),
      Number.parseInt(hex[1]!.slice(4, 6), 16),
      hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1,
    ];
  }

  const rgba =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/i.exec(
      value,
    );
  if (!rgba) return null;
  const channels = rgba.slice(1, 4).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) return null;
  return [channels[0]!, channels[1]!, channels[2]!, Number(rgba[4])];
}

function serializeNativeColor([red, green, blue, alpha]: Rgba): string {
  return `#${[red, green, blue, alpha * 255]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hasReadableContrast(foreground: string, background: string, minimum: number): boolean {
  const foregroundColor = parseNativeColor(foreground);
  const backgroundColor = parseNativeColor(background);
  if (
    !foregroundColor ||
    !backgroundColor ||
    foregroundColor[3] !== 1 ||
    backgroundColor[3] !== 1
  ) {
    return false;
  }
  const [lighter, darker] = [luminance(foregroundColor), luminance(backgroundColor)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05) >= minimum;
}

function luminance([red, green, blue]: Rgba): number {
  const channels = [red, green, blue]
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels.reduce(
    (total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!,
    0,
  );
}

function boundedText(value: unknown, maximumCodePoints: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= maximumCodePoints
  );
}

function boundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}
