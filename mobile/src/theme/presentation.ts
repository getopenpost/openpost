import type {
  NativeActionIntent,
  NativeActionStyle,
  NativeTextRole,
  NativeThemeManifest,
} from "./contract";

export const NATIVE_MIN_TOUCH_TARGET = 48;
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
}

export function themePreviewPresentation(
  manifest: NativeThemeManifest,
): NativeThemePreviewPresentation {
  return {
    frameRadius: manifest.shape.large,
    framePadding: manifest.spacing.large,
    frameGap: manifest.spacing.medium,
    cardRadius: manifest.shape.medium,
    cardPadding: manifest.spacing.medium,
    contentGap: manifest.spacing.small,
    actionRadius: manifest.shape.medium,
    title: manifest.typography.titleLarge,
    body: manifest.typography.bodyMedium,
    metadata: manifest.typography.labelMedium,
    focalAction: manifest.actions.focal,
    ordinaryAction: manifest.actions.ordinary,
  };
}
