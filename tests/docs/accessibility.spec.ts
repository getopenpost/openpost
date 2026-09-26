import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("quickstart navigation has readable contrast and named icons", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/docs/guides/quickstart");
  const result = await new AxeBuilder({ page })
    .include("#nd-docs-layout")
    .withRules(["color-contrast", "svg-img-alt"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);
});
