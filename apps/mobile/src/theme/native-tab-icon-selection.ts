import type { NativeThemeManifest } from "./contract";
import { completeNativeThemeManifestIconPack } from "./icons";

export const NATIVE_TAB_ICON_ROLES = ["drafts", "calendar", "queue"] as const;
export type NativeTabIconRole = (typeof NATIVE_TAB_ICON_ROLES)[number];

export function resolveNativeThemeNavigationIconPack(manifest: NativeThemeManifest) {
  return completeNativeThemeManifestIconPack(manifest);
}
