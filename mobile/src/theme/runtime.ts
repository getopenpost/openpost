import { BUILTIN_THEME_FAMILIES, validateNativeThemeManifest } from "./builtins";
import {
  NATIVE_THEME_CONTRACT_VERSION,
  type NativeResolvedThemeContract,
  type NativeStagedThemeResources,
  type NativeThemeFallbackReason,
  type NativeThemeManifest,
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
  stagedResources,
  systemScheme,
  workspaceId,
}: {
  contract: NativeResolvedThemeContract | null | undefined;
  preference: NativeThemePreference;
  stagedResources?: NativeStagedThemeResources | null;
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
    manifest.familyId !== contract.themeId ||
    !manifestResourcesMatch(manifest, contract)
  ) {
    return workshopFallback(workspaceId, preference, effectiveScheme, "invalid-contract");
  }
  if (!nativeThemeResourcesReady(contract, stagedResources)) {
    return workshopFallback(workspaceId, preference, effectiveScheme, "resources-unavailable");
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
    resources: cloneStagedResources(stagedResources),
    source: {
      kind: "contract",
      identity: contract.identity,
      revision: contract.revision,
      resolutionSource: contract.resolutionSource,
      ...(contract.fallbackReason ? { fallbackReason: contract.fallbackReason } : {}),
    },
  });
}

function manifestResourcesMatch(
  manifest: NativeThemeManifest,
  contract: NativeResolvedThemeContract,
): boolean {
  const fonts = new Map(contract.resources.fonts.map((font) => [font.id, font]));
  const fontsMatch = Object.values(manifest.typography).every((role) => {
    if (!role.fontResourceId && !role.fontFamily) return true;
    if (!role.fontResourceId || !role.fontFamily) return false;
    const font = fonts.get(role.fontResourceId);
    return (
      font?.family === role.fontFamily &&
      font.weight === Number(role.fontWeight) &&
      font.style === "normal"
    );
  });
  if (!fontsMatch) return false;

  const bindings = Object.entries(manifest.assetSlots);
  if (bindings.length !== contract.resources.assets.length) return false;
  return bindings.every(([slot, binding]) => {
    const asset = contract.resources.assets.find(
      (candidate) => candidate.id === binding.resourceId,
    );
    return asset?.slot === slot && asset.alt === binding.alt;
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
      `workshop@${family.revision}:fallback:${reason}`,
    ),
    workspaceId,
    preference,
    effectiveScheme,
    familyId: family.id,
    displayName: family.displayName,
    manifest,
    resources: null,
    source: { kind: "fallback", reason },
  });
}

export function resolveNativeThemeFallback({
  effectiveScheme,
  preference,
  reason,
  workspaceId,
}: {
  effectiveScheme: NativeThemeScheme;
  preference: NativeThemePreference;
  reason: NativeThemeFallbackReason;
  workspaceId: string | null;
}): NativeThemeSnapshot {
  return workshopFallback(workspaceId, preference, effectiveScheme, reason);
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
    contract.workspaceId.length > 0 &&
    contract.themeId.length > 0 &&
    contract.displayName.length > 0 &&
    contract.revision.length > 0 &&
    ["builtin", "organization", "fallback"].includes(contract.resolutionSource) &&
    contract.supportedSchemes.length > 0 &&
    contract.supportedSchemes.every((scheme) => scheme === "light" || scheme === "dark") &&
    validResources(contract)
  );
}

function validResources(contract: NativeResolvedThemeContract): boolean {
  const resources = contract.resources;
  if (
    !resources ||
    !resources.identity ||
    !Array.isArray(resources.fonts) ||
    !Array.isArray(resources.assets)
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const font of resources.fonts) {
    if (
      !font.id ||
      ids.has(font.id) ||
      !font.family ||
      !font.sourceUrl ||
      font.format !== "woff2" ||
      !font.nativeDerivative ||
      !font.nativeDerivative.sourceUrl ||
      (font.nativeDerivative.format !== "ttf" && font.nativeDerivative.format !== "otf") ||
      !/^[0-9a-f]{64}$/i.test(font.nativeDerivative.identity) ||
      !Number.isInteger(font.weight) ||
      font.weight < 100 ||
      font.weight > 900 ||
      font.weight % 100 !== 0 ||
      (font.style !== "normal" && font.style !== "italic") ||
      !["swap", "fallback", "optional"].includes(font.display)
    ) {
      return false;
    }
    ids.add(font.id);
  }
  const slots = new Set<string>();
  for (const asset of resources.assets) {
    if (
      !asset.id ||
      ids.has(asset.id) ||
      slots.has(asset.slot) ||
      !asset.sourceUrl ||
      ![
        "background-texture",
        "sidebar-decoration",
        "header-decoration",
        "empty-state-illustration",
        "loading-illustration",
      ].includes(asset.slot) ||
      !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(asset.mimeType)
    ) {
      return false;
    }
    ids.add(asset.id);
    slots.add(asset.slot);
  }
  return true;
}

export function nativeThemeResourcesReady(
  contract: NativeResolvedThemeContract,
  staged: NativeStagedThemeResources | null | undefined,
): boolean {
  const required = contract.resources;
  if (required.fonts.length === 0 && required.assets.length === 0) return true;
  if (
    !staged ||
    staged.contractIdentity !== contract.identity ||
    staged.resourceIdentity !== required.identity ||
    staged.workspaceId !== contract.workspaceId
  ) {
    return false;
  }
  const fontIds = required.fonts.map((font) => font.id).sort();
  const stagedFontIds = Object.keys(staged.fonts).sort();
  const assetIds = required.assets.map((asset) => asset.id).sort();
  const stagedAssetIds = Object.keys(staged.assets).sort();
  return (
    sameStrings(fontIds, stagedFontIds) &&
    sameStrings(assetIds, stagedAssetIds) &&
    required.fonts.every(
      (font) =>
        staged.fonts[font.id]?.family === font.family &&
        staged.fonts[font.id]?.format === font.nativeDerivative.format &&
        staged.fonts[font.id]?.derivativeIdentity === font.nativeDerivative.identity &&
        (staged.fonts[font.id]?.uri ?? "").startsWith("file://"),
    ) &&
    required.assets.every((asset) => (staged.assets[asset.id] ?? "").startsWith("file://"))
  );
}

function cloneStagedResources(
  staged: NativeStagedThemeResources | null | undefined,
): NativeStagedThemeResources | null {
  if (!staged) return null;
  return {
    contractIdentity: staged.contractIdentity,
    resourceIdentity: staged.resourceIdentity,
    workspaceId: staged.workspaceId,
    fonts: Object.fromEntries(Object.entries(staged.fonts).map(([id, font]) => [id, { ...font }])),
    assets: { ...staged.assets },
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
