import { BUILTIN_THEME_FAMILIES, validateNativeThemeManifest } from "./builtins";
import {
  NATIVE_THEME_CONTRACT_VERSION,
  type NativeResolvedThemeContract,
  type NativeThemeFallbackReason,
  type NativeThemePreference,
  type NativeThemeScheme,
  type NativeThemeSnapshot,
} from "./contract";
import { deepFreeze } from "./freeze";

export function resolveEffectiveScheme(
  preference: NativeThemePreference,
  systemScheme: NativeThemeScheme | null | undefined,
): NativeThemeScheme {
  if (preference !== "system") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}

export function resolveNativeTheme({
  contract,
  preference,
  systemScheme,
  workspaceId,
}: {
  contract: NativeResolvedThemeContract | null | undefined;
  preference: NativeThemePreference;
  systemScheme: NativeThemeScheme | null | undefined;
  workspaceId: string | null;
}): NativeThemeSnapshot {
  const effectiveScheme = resolveEffectiveScheme(preference, systemScheme);

  if (!contract) {
    return workshopFallback(workspaceId, preference, effectiveScheme, "contract-unavailable");
  }
  if (contract.workspaceId !== workspaceId) {
    return workshopFallback(workspaceId, preference, effectiveScheme, "stale-contract");
  }
  if (!validContractMetadata(contract)) {
    return workshopFallback(workspaceId, preference, effectiveScheme, "invalid-contract");
  }
  if (!contract.supportedSchemes.includes(effectiveScheme)) {
    return workshopFallback(workspaceId, preference, effectiveScheme, "unsupported-scheme");
  }

  const manifest = contract.manifests[effectiveScheme];
  if (
    !validateNativeThemeManifest(manifest) ||
    manifest.scheme !== effectiveScheme ||
    manifest.familyId !== contract.themeId
  ) {
    return workshopFallback(workspaceId, preference, effectiveScheme, "invalid-contract");
  }

  return deepFreeze({
    activationKey: activationKey(
      workspaceId,
      preference,
      effectiveScheme,
      `${contract.identity}@${contract.revision}`,
    ),
    workspaceId,
    preference,
    effectiveScheme,
    familyId: contract.themeId,
    displayName: contract.displayName,
    manifest,
    source: { kind: "contract", identity: contract.identity, revision: contract.revision },
  });
}

function workshopFallback(
  workspaceId: string | null,
  preference: NativeThemePreference,
  effectiveScheme: NativeThemeScheme,
  reason: NativeThemeFallbackReason,
): NativeThemeSnapshot {
  const family = BUILTIN_THEME_FAMILIES.workshop;
  const manifest = family.manifests[effectiveScheme]!;
  return deepFreeze({
    activationKey: activationKey(
      workspaceId,
      preference,
      effectiveScheme,
      `workshop@${family.builtinVersion}:fallback:${reason}`,
    ),
    workspaceId,
    preference,
    effectiveScheme,
    familyId: family.id,
    displayName: family.displayName,
    manifest,
    source: { kind: "fallback", reason },
  });
}

function activationKey(
  workspaceId: string | null,
  preference: NativeThemePreference,
  effectiveScheme: NativeThemeScheme,
  identity: string,
): string {
  return `${workspaceId ?? "unassigned"}:${effectiveScheme}:${preference}:${identity}`;
}

function validContractMetadata(contract: NativeResolvedThemeContract): boolean {
  return (
    contract.contractVersion === NATIVE_THEME_CONTRACT_VERSION &&
    contract.identity.length > 0 &&
    contract.organizationId.length > 0 &&
    contract.workspaceId.length > 0 &&
    contract.themeId.length > 0 &&
    contract.displayName.length > 0 &&
    contract.revision.length > 0 &&
    contract.supportedSchemes.length > 0 &&
    contract.supportedSchemes.every((scheme) => scheme === "light" || scheme === "dark")
  );
}
