import type { ImageSourcePropType } from "react-native";

import type { NativeThemeManifest } from "./contract";
import { NATIVE_TAB_ICON_SOURCES } from "./native-tab-icon-sources.generated";
import {
  resolveNativeThemeNavigationIconPack,
  type NativeTabIconRole,
} from "./native-tab-icon-selection";

export { NATIVE_TAB_ICON_ROLES, type NativeTabIconRole } from "./native-tab-icon-selection";

export function resolveNativeThemeNavigationIcon(
  manifest: NativeThemeManifest,
  role: NativeTabIconRole,
): ImageSourcePropType {
  return NATIVE_TAB_ICON_SOURCES[resolveNativeThemeNavigationIconPack(manifest)][role];
}
