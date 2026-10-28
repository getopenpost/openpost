import {
  NATIVE_THEME_CONTRACT_VERSION,
  type NativeResolvedThemeContract,
  type NativeThemeFamily,
} from "./contract";
import {
  GENERATED_BUILTIN_THEME_FAMILIES,
  GENERATED_BUILTIN_THEME_IDS,
} from "./builtins.generated";
import { deepFreeze } from "./freeze";

export { validateNativeThemeManifest } from "./validation";

export const BUILTIN_THEME_IDS = GENERATED_BUILTIN_THEME_IDS;
export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number];

export const BUILTIN_THEME_FAMILIES: Readonly<Record<BuiltinThemeId, NativeThemeFamily>> =
  deepFreeze(GENERATED_BUILTIN_THEME_FAMILIES);

export function createBuiltinThemeContract({
  familyId,
  identity,
  workspaceId,
}: {
  familyId: BuiltinThemeId;
  identity: string;
  workspaceId: string;
}): NativeResolvedThemeContract {
  const family = BUILTIN_THEME_FAMILIES[familyId];
  return deepFreeze({
    contractVersion: NATIVE_THEME_CONTRACT_VERSION,
    identity,
    workspaceId,
    themeId: family.id,
    displayName: family.displayName,
    revision: family.revision,
    resolutionSource: "builtin",
    supportedSchemes: family.supportedSchemes,
    manifests: family.manifests,
    resources: {
      identity: `${identity}:resources:[]`,
      fonts: [],
      assets: [],
    },
  });
}
