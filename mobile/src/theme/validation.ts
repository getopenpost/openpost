import {
  ACTION_INTENTS,
  NATIVE_ICON_ROLES,
  NATIVE_MIN_TEXT_SIZE,
  PUBLICATION_STATUSES,
  type NativeIconPackId,
  type NativeActionStyle,
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

const MINIMUM_TEXT_CONTRAST = 4.5;
const MINIMUM_FOCUS_CONTRAST = 3;
const MINIMUM_SEMANTIC_ACTION_DISTANCE = 0.014;

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
    !hasReadableContrast(colors.onSurface, colors.background, MINIMUM_TEXT_CONTRAST) ||
    !hasReadableContrast(colors.onSurface, colors.surface, MINIMUM_TEXT_CONTRAST) ||
    !hasReadableContrast(colors.onSurfaceVariant, colors.background, MINIMUM_TEXT_CONTRAST) ||
    !hasReadableContrast(colors.onSurfaceVariant, colors.surface, MINIMUM_TEXT_CONTRAST) ||
    !hasReadableContrast(colors.primary, colors.onPrimary, MINIMUM_TEXT_CONTRAST) ||
    !hasReadableContrast(colors.focus, colors.background, MINIMUM_FOCUS_CONTRAST) ||
    !hasReadableContrast(colors.focus, colors.surface, MINIMUM_FOCUS_CONTRAST) ||
    PUBLICATION_STATUSES.some(
      (status) =>
        !hasReadableContrast(colors.status[status], colors.background, MINIMUM_TEXT_CONTRAST) ||
        !hasReadableContrast(colors.status[status], colors.surface, MINIMUM_TEXT_CONTRAST),
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
        !parseNativeColor(action.pressedContent) ||
        !parseNativeColor(action.depthColor) ||
        !boundedNumber(action.borderWidth, 0, 4) ||
        !boundedNumber(action.depth, 0, 8) ||
        !boundedNumber(action.disabledOpacity, 0, 1) ||
        typeof action.underline !== "boolean"
      ) {
        return true;
      }
      return !hasReadableActionContrast(action, colors.background, colors.surface);
    })
  ) {
    return false;
  }

  if (!hasDistinctDestructiveAction(value.actions, colors.background, colors.surface)) return false;

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

function hasReadableActionContrast(
  action: NativeActionStyle,
  background: string,
  surface: string,
): boolean {
  return [background, surface].every(
    (underlay) =>
      hasReadableContrastOn(action.content, action.container, underlay, MINIMUM_TEXT_CONTRAST) &&
      hasReadableContrastOn(
        action.pressedContent,
        action.pressedContainer,
        underlay,
        MINIMUM_TEXT_CONTRAST,
      ),
  );
}

function hasDistinctDestructiveAction(
  actions: NativeThemeManifest["actions"],
  background: string,
  surface: string,
): boolean {
  const destructive = actions.destructive;
  return (["focal", "primary", "ordinary", "quiet"] as const).every((intent) => {
    const safe = actions[intent];
    return [background, surface].every((underlay) => {
      const containerDistance = perceptualColorDistanceOn(
        destructive.container,
        safe.container,
        underlay,
      );
      const contentDistance = perceptualColorDistanceOn(
        destructive.content,
        safe.content,
        underlay,
      );
      return (
        (containerDistance !== null && containerDistance >= MINIMUM_SEMANTIC_ACTION_DISTANCE) ||
        (contentDistance !== null && contentDistance >= MINIMUM_SEMANTIC_ACTION_DISTANCE)
      );
    });
  });
}

function hasReadableContrastOn(
  foreground: string,
  container: string,
  underlay: string,
  minimum: number,
): boolean {
  const foregroundColor = parseNativeColor(foreground);
  const containerColor = parseNativeColor(container);
  const underlayColor = parseNativeColor(underlay);
  if (
    !foregroundColor ||
    !containerColor ||
    !underlayColor ||
    foregroundColor[3] !== 1 ||
    underlayColor[3] !== 1
  ) {
    return false;
  }
  return contrastRatio(foregroundColor, compositeColor(containerColor, underlayColor)) >= minimum;
}

function perceptualColorDistanceOn(first: string, second: string, underlay: string): number | null {
  const firstColor = parseNativeColor(first);
  const secondColor = parseNativeColor(second);
  const underlayColor = parseNativeColor(underlay);
  if (!firstColor || !secondColor || !underlayColor || underlayColor[3] !== 1) return null;
  const firstLab = toOklab(compositeColor(firstColor, underlayColor));
  const secondLab = toOklab(compositeColor(secondColor, underlayColor));
  return Math.hypot(
    firstLab[0] - secondLab[0],
    firstLab[1] - secondLab[1],
    firstLab[2] - secondLab[2],
  );
}

function compositeColor(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
}

function toOklab(color: Rgba): readonly [number, number, number] {
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const red = linear(color[0]);
  const green = linear(color[1]);
  const blue = linear(color[2]);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function validTextRole(value: NativeTextRole | null | undefined): boolean {
  if (
    !value ||
    !boundedNumber(value.fontSize, NATIVE_MIN_TEXT_SIZE, 64) ||
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
  return contrastRatio(foregroundColor, backgroundColor) >= minimum;
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
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
