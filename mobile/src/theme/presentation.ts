import type {
  NativeActionIntent,
  NativeActionStyle,
  NativeTextRole,
  NativeThemeAssetSlot,
  NativeThemeManifest,
  NativeThemeSnapshot,
} from "./contract";

export const NATIVE_MIN_TOUCH_TARGET = 48;
const ACCESSIBILITY_TEXT_LAYOUT_FONT_SCALE = 1.6;
export const NATIVE_CONTROL_METRICS = Object.freeze({
  buttonMinHeight: NATIVE_MIN_TOUCH_TARGET,
  iconButtonSize: NATIVE_MIN_TOUCH_TARGET,
  textFieldMinHeight: 52,
});

export function actionPresentation(
  manifest: NativeThemeManifest,
  intent: NativeActionIntent,
): NativeActionStyle {
  return manifest.actions[intent];
}

export interface NativeCardPresentation {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderRadius: number;
  readonly borderWidth: number;
  readonly elevation: number;
  readonly shadowColor: string;
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
}

export function cardPresentation(manifest: NativeThemeManifest): NativeCardPresentation {
  const recipe = manifest.components.card;
  return {
    backgroundColor:
      recipe === "paper" ? manifest.colors.surfaceContainerHigh : manifest.colors.surface,
    borderColor: manifest.colors.outlineVariant,
    borderRadius: recipe === "paper" ? manifest.shape.small : manifest.shape.medium,
    borderWidth: recipe === "flat" || recipe === "lifted" ? 0 : 1,
    elevation: recipe === "lifted" ? 4 : 0,
    shadowColor: manifest.colors.shadow,
    shadowOpacity: recipe === "lifted" ? 0.18 : 0,
    shadowRadius: recipe === "lifted" ? 10 : 0,
  };
}

export interface NativeInputPresentation {
  readonly backgroundColor: string;
  readonly borderBottomWidth: number;
  readonly borderColor: string;
  readonly borderRadius: number;
  readonly borderWidth: number;
}

export function inputPresentation(manifest: NativeThemeManifest): NativeInputPresentation {
  const recipe = manifest.components.input;
  return {
    backgroundColor: recipe === "filled" ? manifest.colors.surfaceContainerHigh : "transparent",
    borderBottomWidth: recipe === "underlined" ? 1 : 0,
    borderColor: manifest.colors.outline,
    borderRadius: recipe === "underlined" ? 0 : manifest.shape.small,
    borderWidth: recipe === "outlined" ? 1 : 0,
  };
}

export function buttonRadius(manifest: NativeThemeManifest): number {
  if (manifest.components.button === "pill") return manifest.shape.full;
  if (manifest.components.button === "precise") return manifest.shape.extraSmall;
  if (manifest.components.button === "tonal") return manifest.shape.large;
  return manifest.shape.medium;
}

export interface NativeLoadingStatePresentation {
  readonly animationDuration: number;
  readonly kind: NativeThemeManifest["components"]["loadingState"];
}

export function loadingStatePresentation(
  manifest: NativeThemeManifest,
): NativeLoadingStatePresentation {
  const kind = manifest.components.loadingState;
  return {
    animationDuration: kind === "spinner" ? manifest.motion.quickMs : manifest.motion.standardMs,
    kind,
  };
}

export interface NativeEmptyStatePresentation {
  readonly framed: boolean;
  readonly illustrated: boolean;
}

export function emptyStatePresentation(
  manifest: NativeThemeManifest,
): NativeEmptyStatePresentation {
  return {
    framed: manifest.components.emptyState === "framed",
    illustrated: manifest.components.emptyState === "illustrated",
  };
}

export interface NativeNavigationPresentation {
  readonly backgroundColor: string;
  readonly defaultColor: string;
  readonly disableIndicator: boolean;
  readonly indicatorColor: string;
  readonly requestedHeight: number;
  readonly selectedColor: string;
  readonly shadowColor: string;
}

export function navigationPresentation(
  manifest: NativeThemeManifest,
): NativeNavigationPresentation {
  const recipe = manifest.components.navigation;
  const tonal = recipe === "tonal";
  return {
    backgroundColor: tonal ? manifest.colors.surfaceContainer : manifest.colors.surface,
    defaultColor: manifest.colors.onSurfaceVariant,
    disableIndicator: !tonal,
    indicatorColor: tonal ? manifest.colors.primaryContainer : "transparent",
    requestedHeight: manifest.shell.mobileNavigationHeight,
    selectedColor: tonal ? manifest.colors.onPrimaryContainer : manifest.colors.primary,
    shadowColor: recipe === "outlined" ? manifest.colors.outline : manifest.colors.outlineVariant,
  };
}

export function sidebarDecorationWidth(
  manifest: NativeThemeManifest,
  viewportWidth: number,
): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  return Math.round(Math.min(manifest.shell.sidebarWidth, viewportWidth * 0.34) * 1000) / 1000;
}

export interface NativeAppearanceLayoutPresentation {
  readonly stackContent: boolean;
}

export function appearanceLayoutPresentation(
  fontScale: number,
): NativeAppearanceLayoutPresentation {
  return {
    stackContent: Number.isFinite(fontScale) && fontScale >= ACCESSIBILITY_TEXT_LAYOUT_FONT_SCALE,
  };
}

export interface NativeResolvedThemeAsset {
  readonly alt?: string;
  readonly uri: string;
}

export function themeAssetFor(
  snapshot: NativeThemeSnapshot,
  slot: NativeThemeAssetSlot,
): NativeResolvedThemeAsset | null {
  const binding = snapshot.manifest.assetSlots[slot];
  if (!binding) return null;
  const uri = snapshot.resources?.assets[binding.resourceId];
  if (!uri) return null;
  return { uri, ...(binding.alt ? { alt: binding.alt } : {}) };
}

export interface NativeThemePreviewPresentation {
  readonly frameRadius: number;
  readonly framePadding: number;
  readonly frameGap: number;
  readonly cardRadius: number;
  readonly cardPadding: number;
  readonly contentGap: number;
  readonly actionRadius: number;
  readonly title: NativeTextRole;
  readonly body: NativeTextRole;
  readonly metadata: NativeTextRole;
  readonly focalAction: NativeActionStyle;
  readonly ordinaryAction: NativeActionStyle;
  readonly buttonRecipe: NativeThemeManifest["components"]["button"];
  readonly cardRecipe: NativeThemeManifest["components"]["card"];
  readonly canvasTreatment: NativeThemeManifest["shell"]["canvasTreatment"];
  readonly iconPack: NativeThemeManifest["iconography"]["packId"];
  readonly card: NativeCardPresentation;
}

export function themePreviewPresentation(
  manifest: NativeThemeManifest,
): NativeThemePreviewPresentation {
  const card = cardPresentation(manifest);
  return {
    frameRadius: manifest.shape.large,
    framePadding: manifest.spacing.large,
    frameGap: manifest.spacing.medium,
    cardRadius: card.borderRadius,
    cardPadding: manifest.spacing.medium,
    contentGap: manifest.spacing.small,
    actionRadius: buttonRadius(manifest),
    title: manifest.typography.titleLarge,
    body: manifest.typography.bodyMedium,
    metadata: manifest.typography.labelMedium,
    focalAction: manifest.actions.focal,
    ordinaryAction: manifest.actions.ordinary,
    buttonRecipe: manifest.components.button,
    cardRecipe: manifest.components.card,
    canvasTreatment: manifest.shell.canvasTreatment,
    iconPack: manifest.iconography.packId,
    card,
  };
}
