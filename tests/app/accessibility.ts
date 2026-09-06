import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectNoSeriousAccessibilityViolations(page: Page) {
  const toasts = page.locator("[data-sonner-toast]");
  await expect
    .poll(
      () =>
        toasts.evaluateAll((nodes) =>
          nodes.every((node) => Number.parseFloat(getComputedStyle(node).opacity) >= 0.99),
        ),
      { timeout: 2_000 },
    )
    .toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const seriousViolations = results.violations
    .filter(({ impact }) => impact === "serious" || impact === "critical")
    .flatMap(({ help, id, impact, nodes }) => {
      const filteredNodes = nodes.filter((node) => {
        // Ignore known low-contrast tooltip placeholder that is not user-visible content
        if (id === "color-contrast" && node.target.some((t) => t.includes('div[data-title=""]')))
          return false;
        return true;
      });
      if (filteredNodes.length === 0) return [];
      return [
        {
          id,
          impact,
          help,
          nodes: filteredNodes.map(({ failureSummary, target }) => ({ failureSummary, target })),
        },
      ];
    });

  expect(seriousViolations).toEqual([]);
}
