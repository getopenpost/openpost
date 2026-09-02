import { expect, test } from "bun:test";

import heroiconsOutlinePack from "./icon-packs/heroicons-outline.generated";
import heroiconsSolidPack from "./icon-packs/heroicons-solid.generated";
import lucidePack from "./icon-packs/lucide.generated";
import phosphorPack from "./icon-packs/phosphor.generated";
import tablerPack from "./icon-packs/tabler.generated";
import { createBuiltinThemeContract } from "./builtins";
import { NATIVE_ICON_ROLES, type NativeIconPackId, type NativeThemeSnapshot } from "./contract";
import type { NativeThemeIconData, NativeThemeIconPack } from "./icon-data";
import {
  activateNativeThemeSnapshotIcons,
  createNativeThemeIconRegistry,
  createNativeThemeIconStager,
  loadNativeThemeIconPack,
  resolveNativeThemeIcon,
} from "./icons";
import { NATIVE_PROTECTED_ICON_ROLES, resolveNativeProtectedIcon } from "./protected-icons";
import { resolveNativeThemeNavigationIconPack } from "./native-tab-icon-selection";
import { resolveNativeTheme } from "./runtime";

const PACKS = [
  lucidePack,
  heroiconsOutlinePack,
  heroiconsSolidPack,
  phosphorPack,
  tablerPack,
] as const;

test("gives every mobile semantic role genuinely different geometry in all five packs", () => {
  for (const role of NATIVE_ICON_ROLES) {
    const geometry = PACKS.map((pack) => geometryFingerprint(pack.icons[role].body));
    expect(new Set(geometry).size, role).toBe(PACKS.length);
    expect(new Set(PACKS.map((pack) => pack.icons[role].sourceGlyphId)).size, role).toBeGreaterThan(
      2,
    );
  }
});

test("loads only the requested pack and coalesces concurrent requests", async () => {
  const calls = Object.fromEntries(PACKS.map((pack) => [pack.id, 0])) as Record<
    NativeIconPackId,
    number
  >;
  const registry = createNativeThemeIconRegistry(
    packLoaders((pack) => {
      calls[pack.id] += 1;
      return Promise.resolve({ default: pack });
    }),
  );

  expect(registry.resolve("tabler", "edit").packId).toBe("lucide");
  await Promise.all([registry.loadPack("tabler"), registry.loadPack("tabler")]);
  expect(calls).toEqual({
    lucide: 0,
    "heroicons-outline": 0,
    "heroicons-solid": 0,
    phosphor: 0,
    tabler: 1,
  });
  expect(registry.resolve("tabler", "edit")).toMatchObject({
    packId: "tabler",
    usedFallback: false,
  });
});

test("rejects an incomplete pack as a unit instead of mixing it with Lucide", async () => {
  const icons: Partial<Record<(typeof NATIVE_ICON_ROLES)[number], NativeThemeIconData>> = {
    ...tablerPack.icons,
  };
  delete icons.edit;
  const incompletePack = { ...tablerPack, icons } as NativeThemeIconPack;
  const registry = createNativeThemeIconRegistry(
    packLoaders((pack) =>
      Promise.resolve({ default: pack.id === "tabler" ? incompletePack : pack }),
    ),
  );

  await expect(registry.loadPack("tabler")).rejects.toThrow(
    "tabler has an invalid edit native theme icon",
  );
  expect(registry.resolve("tabler", "edit").packId).toBe("lucide");
  expect(registry.resolve("tabler", "settings").packId).toBe("lucide");
  expect(registry.resolve("not-a-pack", "not-a-role")).toMatchObject({
    packId: "lucide",
    resolvedRole: "settings",
    usedFallback: true,
  });
});

test("a corrupt manifest role map selects complete Lucide for every role", async () => {
  await loadNativeThemeIconPack("tabler");
  const manifest = builtinSnapshot("midnight", "dark").manifest;
  const corruptManifest = {
    ...manifest,
    iconography: {
      ...manifest.iconography,
      roles: { ...manifest.iconography.roles, edit: "not-the-tabler-edit-icon" },
    },
  };

  expect(resolveNativeThemeIcon(corruptManifest, "edit").packId).toBe("lucide");
  expect(resolveNativeThemeIcon(corruptManifest, "settings").packId).toBe("lucide");
  expect(resolveNativeThemeNavigationIconPack(corruptManifest)).toBe("lucide");
});

test("publishes a native theme snapshot only after its complete pack is staged", async () => {
  let releasePack: (() => void) | undefined;
  const requestedPack = new Promise<{ default: NativeThemeIconPack }>((resolve) => {
    releasePack = () => resolve({ default: phosphorPack });
  });
  const registry = createNativeThemeIconRegistry(
    packLoaders((pack) =>
      pack.id === "phosphor" ? requestedPack : Promise.resolve({ default: pack }),
    ),
  );
  const stager = createNativeThemeIconStager(registry);
  const requested = builtinSnapshot("playroom", "light");
  const fallback = builtinSnapshot("workshop", "light");
  const published: NativeThemeSnapshot[] = [];

  const activation = activateNativeThemeSnapshotIcons({
    fallback: () => fallback,
    publish: (snapshot) => published.push(snapshot),
    snapshot: requested,
    stager,
  });
  await Promise.resolve();
  expect(published).toEqual([]);

  releasePack!();
  await expect(activation).resolves.toEqual({ status: "ready", packId: "phosphor" });
  expect(published).toEqual([requested]);
});

test("drops stale icon staging before it can publish an older theme", async () => {
  const pending = new Map<NativeIconPackId, () => void>();
  const registry = createNativeThemeIconRegistry(
    packLoaders(
      (pack) =>
        new Promise((resolve) => {
          pending.set(pack.id, () => resolve({ default: pack }));
        }),
    ),
  );
  const stager = createNativeThemeIconStager(registry);
  const first = stager.stage("tabler");
  const second = stager.stage("phosphor");

  pending.get("tabler")!();
  await expect(first).resolves.toEqual({ status: "stale", packId: "tabler" });
  pending.get("phosphor")!();
  await expect(second).resolves.toEqual({ status: "ready", packId: "phosphor" });
});

test("keeps status and media-control glyphs outside organization packs", () => {
  for (const role of [
    "camera",
    "download",
    "error",
    "gallery",
    "image",
    "info",
    "loading",
    "pause",
    "play",
    "success",
    "upload",
    "video",
    "warning",
  ] as const) {
    expect(NATIVE_PROTECTED_ICON_ROLES).toContain(role);
    expect(NATIVE_ICON_ROLES as readonly string[]).not.toContain(role);
  }
  const warning = resolveNativeProtectedIcon("warning");
  for (const pack of PACKS) {
    expect(resolveNativeProtectedIcon("warning"), pack.id).toEqual(warning);
  }
});

function builtinSnapshot(
  familyId: Parameters<typeof createBuiltinThemeContract>[0]["familyId"],
  preference: "light" | "dark",
): NativeThemeSnapshot {
  return resolveNativeTheme({
    contract: createBuiltinThemeContract({
      familyId,
      identity: `${familyId}@test`,
      workspaceId: "workspace-1",
    }),
    preference,
    systemScheme: preference,
    workspaceId: "workspace-1",
  });
}

function packLoaders(
  load: (pack: NativeThemeIconPack) => Promise<{ default: NativeThemeIconPack }>,
) {
  return {
    lucide: () => load(lucidePack),
    "heroicons-outline": () => load(heroiconsOutlinePack),
    "heroicons-solid": () => load(heroiconsSolidPack),
    phosphor: () => load(phosphorPack),
    tabler: () => load(tablerPack),
  };
}

function geometryFingerprint(body: string): string {
  return body
    .replace(
      /\s(?:color|fill|stroke|stroke-linecap|stroke-linejoin|stroke-width)=(?:"[^"]*"|'[^']*')/g,
      "",
    )
    .replace(/\s+/g, "");
}
