import { describe, expect, test } from "bun:test";

import { BUILTIN_THEME_FAMILIES } from "./builtins";
import { buttonRadius } from "./presentation";

describe("native theme presentation", () => {
  test("uses the pill radius for pill-action theme families", () => {
    for (const id of ["apple", "calcom", "firecrawl", "quizlet", "supabase"] as const) {
      const family = BUILTIN_THEME_FAMILIES[id];
      const manifest = family.manifests.light ?? family.manifests.dark!;

      expect(manifest.components.button).toBe("pill");
      expect(buttonRadius(manifest)).toBe(manifest.shape.full);
    }
  });
});
