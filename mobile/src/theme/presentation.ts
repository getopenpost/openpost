import type { NativeActionIntent, NativeActionStyle, NativeThemeManifest } from "./contract";

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
