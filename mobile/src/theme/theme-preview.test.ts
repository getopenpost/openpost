import { describe, expect, test } from "bun:test";

import { BUILTIN_THEME_FAMILIES, BUILTIN_THEME_IDS } from "./builtins";
import { themePreviewPresentation } from "./presentation";

describe("native Appearance theme preview", () => {
  test("exposes the active semantic type, spacing, shape, and action recipes", () => {
    const playroom = BUILTIN_THEME_FAMILIES.playroom.manifests.light!;
    const preview = themePreviewPresentation(playroom);

    expect(preview).toMatchObject({
      actionRadius: playroom.shape.medium,
      body: playroom.typography.bodyMedium,
      cardPadding: playroom.spacing.medium,
      cardRadius: playroom.shape.medium,
      contentGap: playroom.spacing.small,
      focalAction: { borderWidth: 2, depth: 4 },
      frameGap: playroom.spacing.medium,
      framePadding: playroom.spacing.large,
      frameRadius: playroom.shape.large,
      metadata: playroom.typography.labelMedium,
      ordinaryAction: { depth: 1 },
      title: playroom.typography.titleLarge,
    });
  });

  test("renders a structurally distinct recipe for every built-in family", () => {
    const signatures = BUILTIN_THEME_IDS.map((familyId) => {
      const family = BUILTIN_THEME_FAMILIES[familyId];
      const manifest = family.manifests.light ?? family.manifests.dark!;
      const preview = themePreviewPresentation(manifest);
      return JSON.stringify({
        actionRadius: preview.actionRadius,
        body: preview.body,
        cardPadding: preview.cardPadding,
        cardRadius: preview.cardRadius,
        contentGap: preview.contentGap,
        focalAction: {
          borderWidth: preview.focalAction.borderWidth,
          depth: preview.focalAction.depth,
        },
        frameGap: preview.frameGap,
        framePadding: preview.framePadding,
        frameRadius: preview.frameRadius,
        metadata: preview.metadata,
        ordinaryAction: {
          borderWidth: preview.ordinaryAction.borderWidth,
          depth: preview.ordinaryAction.depth,
        },
        title: preview.title,
      });
    });

    expect(new Set(signatures).size).toBe(BUILTIN_THEME_IDS.length);
  });
});
