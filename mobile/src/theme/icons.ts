import { BUILTIN_ICON_ROLE_MAPS } from "./icon-packs";
import lucidePack from "./icon-packs/lucide.generated";
import {
  NATIVE_ICON_ROLES,
  type NativeIconPackId,
  type NativeIconRole,
  type NativeThemeManifest,
  type NativeThemeSnapshot,
} from "./contract";
import type { NativeThemeIconData, NativeThemeIconPack } from "./icon-data";

type NativeThemeIconPackModule = { default: NativeThemeIconPack };
type NativeThemeIconPackLoader = () => Promise<NativeThemeIconPackModule>;
type NativeThemeIconPackLoaders = Readonly<Record<NativeIconPackId, NativeThemeIconPackLoader>>;

const NATIVE_ICON_PACK_IDS = [
  "lucide",
  "heroicons-outline",
  "heroicons-solid",
  "phosphor",
  "tabler",
] as const satisfies readonly NativeIconPackId[];

const packLoaders = {
  lucide: () => import("./icon-packs/lucide.generated"),
  "heroicons-outline": () => import("./icon-packs/heroicons-outline.generated"),
  "heroicons-solid": () => import("./icon-packs/heroicons-solid.generated"),
  phosphor: () => import("./icon-packs/phosphor.generated"),
  tabler: () => import("./icon-packs/tabler.generated"),
} satisfies NativeThemeIconPackLoaders;

export interface NativeThemeIconSelection {
  readonly data: NativeThemeIconData;
  readonly packId: NativeIconPackId;
  readonly requestedPackId: string;
  readonly requestedRole: string;
  readonly resolvedRole: NativeIconRole;
  readonly usedFallback: boolean;
}

export interface NativeThemeIconRegistry {
  loadPack(id: NativeIconPackId): Promise<NativeThemeIconPack>;
  isPackLoaded(id: NativeIconPackId): boolean;
  resolve(packId: string, role: string): NativeThemeIconSelection;
}

export function createNativeThemeIconRegistry(
  loaders: NativeThemeIconPackLoaders,
  fallback: NativeThemeIconPack = lucidePack,
): NativeThemeIconRegistry {
  assertCompletePack(fallback.id, fallback);
  const loaded = new Map<NativeIconPackId, NativeThemeIconPack>([[fallback.id, fallback]]);
  const pending = new Map<NativeIconPackId, Promise<NativeThemeIconPack>>();

  function fallbackSelection(requestedPackId: string, requestedRole: string) {
    const resolvedRole = isNativeIconRole(requestedRole) ? requestedRole : "settings";
    return {
      data: fallback.icons[resolvedRole],
      packId: fallback.id,
      requestedPackId,
      requestedRole,
      resolvedRole,
      usedFallback: requestedPackId !== fallback.id || requestedRole !== resolvedRole,
    } satisfies NativeThemeIconSelection;
  }

  return {
    loadPack(id) {
      const ready = loaded.get(id);
      if (ready) return Promise.resolve(ready);
      const activeRequest = pending.get(id);
      if (activeRequest) return activeRequest;

      const request = (async () => {
        try {
          const module = await loaders[id]();
          assertCompletePack(id, module.default);
          loaded.set(id, module.default);
          return module.default;
        } finally {
          pending.delete(id);
        }
      })();
      pending.set(id, request);
      return request;
    },
    isPackLoaded(id) {
      return loaded.has(id);
    },
    resolve(packId, role) {
      if (!isNativeIconPackId(packId) || !isNativeIconRole(role)) {
        return fallbackSelection(packId, role);
      }
      const pack = loaded.get(packId);
      const data = pack?.icons[role];
      if (!pack || !data) return fallbackSelection(packId, role);
      return {
        data,
        packId: pack.id,
        requestedPackId: packId,
        requestedRole: role,
        resolvedRole: role,
        usedFallback: false,
      };
    },
  };
}

const registry = createNativeThemeIconRegistry(packLoaders);

export function loadNativeThemeIconPack(id: NativeIconPackId): Promise<NativeThemeIconPack> {
  return registry.loadPack(id);
}

export function isNativeThemeIconPackLoaded(id: NativeIconPackId): boolean {
  return registry.isPackLoaded(id);
}

export function resolveNativeThemeIcon(
  manifest: NativeThemeManifest,
  requestedRole: NativeIconRole,
): NativeThemeIconSelection {
  return registry.resolve(completeNativeThemeManifestIconPack(manifest), requestedRole);
}

export type NativeThemeIconStageResult =
  | Readonly<{ status: "ready"; packId: NativeIconPackId }>
  | Readonly<{ status: "failed"; packId: NativeIconPackId; error: unknown }>
  | Readonly<{ status: "stale"; packId: NativeIconPackId }>;

export interface NativeThemeIconStager {
  stage(packId: NativeIconPackId): Promise<NativeThemeIconStageResult>;
  cancel(): void;
}

export function createNativeThemeIconStager(
  iconRegistry: Pick<NativeThemeIconRegistry, "loadPack"> = registry,
): NativeThemeIconStager {
  let generation = 0;
  return {
    async stage(packId) {
      const requestGeneration = ++generation;
      try {
        await iconRegistry.loadPack(packId);
        if (requestGeneration !== generation) return { status: "stale", packId };
        return { status: "ready", packId };
      } catch (error) {
        if (requestGeneration !== generation) return { status: "stale", packId };
        return { status: "failed", packId, error };
      }
    },
    cancel() {
      generation += 1;
    },
  };
}

export async function activateNativeThemeSnapshotIcons({
  fallback,
  isCurrent = () => true,
  publish,
  snapshot,
  stager,
}: {
  fallback: () => NativeThemeSnapshot;
  isCurrent?: () => boolean;
  publish: (snapshot: NativeThemeSnapshot) => void;
  snapshot: NativeThemeSnapshot;
  stager: NativeThemeIconStager;
}): Promise<NativeThemeIconStageResult> {
  const result = await stager.stage(snapshot.manifest.iconography.packId);
  if (!isCurrent() || result.status === "stale") return result;
  publish(result.status === "ready" ? snapshot : fallback());
  return result;
}

function assertCompletePack(expectedId: NativeIconPackId, value: NativeThemeIconPack): void {
  if (!value || value.id !== expectedId) {
    throw new Error(`${expectedId} returned the wrong native theme icon pack`);
  }
  for (const role of NATIVE_ICON_ROLES) {
    const icon = value.icons?.[role];
    if (
      !icon ||
      icon.sourceGlyphId !== BUILTIN_ICON_ROLE_MAPS[expectedId][role] ||
      !safeGeneratedSvgBody(icon.body) ||
      !/^\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/.test(icon.viewBox)
    ) {
      throw new Error(`${expectedId} has an invalid ${role} native theme icon`);
    }
  }
}

function safeGeneratedSvgBody(body: string): boolean {
  return (
    body.length > 0 &&
    body.length <= 16_384 &&
    body.includes("<") &&
    !/<\/?(?:script|svg|foreignObject)\b/i.test(body) &&
    !/\b(?:href|on\w+)\s*=/i.test(body) &&
    !/url\s*\(/i.test(body)
  );
}

function isNativeIconPackId(value: string): value is NativeIconPackId {
  return NATIVE_ICON_PACK_IDS.some((candidate) => candidate === value);
}

function isNativeIconRole(value: string): value is NativeIconRole {
  return NATIVE_ICON_ROLES.some((candidate) => candidate === value);
}

export function completeNativeThemeManifestIconPack(
  manifest: NativeThemeManifest,
): NativeIconPackId {
  const packId = manifest.iconography?.packId;
  if (!isNativeIconPackId(packId)) return "lucide";
  const expected = BUILTIN_ICON_ROLE_MAPS[packId];
  return NATIVE_ICON_ROLES.every((role) => manifest.iconography.roles?.[role] === expected[role])
    ? packId
    : "lucide";
}
