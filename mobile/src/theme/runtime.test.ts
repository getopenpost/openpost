import { describe, expect, test } from "bun:test";

import { createBuiltinThemeContract } from "./builtins";
import type { NativeThemeManifest } from "./contract";
import { resolveEffectiveScheme, resolveNativeTheme } from "./runtime";

describe("native theme runtime", () => {
  test("resolves system locally and treats an unavailable device scheme as light", () => {
    expect(resolveEffectiveScheme("system", "dark")).toBe("dark");
    expect(resolveEffectiveScheme("system", "light")).toBe("light");
    expect(resolveEffectiveScheme("system", null)).toBe("light");
    expect(resolveEffectiveScheme("dark", "light")).toBe("dark");
  });

  test("falls back atomically instead of retaining a prior workspace theme", () => {
    const priorContract = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@1",
      organizationId: "org-1",
      workspaceId: "workspace-1",
    });
    const prior = resolveNativeTheme({
      contract: priorContract,
      preference: "light",
      systemScheme: "dark",
      workspaceId: "workspace-1",
    });
    const afterSwitch = resolveNativeTheme({
      contract: priorContract,
      preference: "light",
      systemScheme: "dark",
      workspaceId: "workspace-2",
    });

    expect(prior.familyId).toBe("studio");
    expect(afterSwitch.familyId).toBe("workshop");
    expect(afterSwitch.source).toEqual({ kind: "fallback", reason: "stale-contract" });
    expect(afterSwitch.activationKey).toContain("workspace-2:light:");
    expect(Object.isFrozen(afterSwitch)).toBe(true);
    expect(Object.isFrozen(afterSwitch.manifest.colors)).toBe(true);
  });

  test("falls back as one complete theme when the selected family lacks the effective scheme", () => {
    const contract = createBuiltinThemeContract({
      familyId: "midnight",
      identity: "midnight@1",
      organizationId: "org-1",
      workspaceId: "workspace-1",
    });

    const resolved = resolveNativeTheme({
      contract,
      preference: "system",
      systemScheme: "light",
      workspaceId: "workspace-1",
    });

    expect(resolved.effectiveScheme).toBe("light");
    expect(resolved.familyId).toBe("workshop");
    expect(resolved.source).toEqual({ kind: "fallback", reason: "unsupported-scheme" });
    expect(resolved.manifest.id).toBe("workshop-light");
  });

  test("rejects an incomplete contract manifest before it reaches React Native", () => {
    const contract = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@1",
      organizationId: "org-1",
      workspaceId: "workspace-1",
    });
    const { shape: _shape, ...incomplete } = contract.manifests.light!;

    const resolved = resolveNativeTheme({
      contract: {
        ...contract,
        manifests: { light: incomplete as unknown as NativeThemeManifest },
      },
      preference: "light",
      systemScheme: "light",
      workspaceId: "workspace-1",
    });

    expect(resolved.familyId).toBe("workshop");
    expect(resolved.source).toEqual({ kind: "fallback", reason: "invalid-contract" });
  });
});
