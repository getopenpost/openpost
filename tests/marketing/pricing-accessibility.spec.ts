import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("pricing exposes readable amounts for both billing periods", async ({ page }) => {
  await page.goto("/pricing");
  for (const billing of ["Monthly", "Yearly"]) {
    await page.getByRole("button", { name: new RegExp(`^${billing}`) }).click();
    await page.locator(".billing-toggle").evaluate(async (toggle) => {
      await Promise.all(
        toggle.getAnimations({ subtree: true }).map((animation) => animation.finished),
      );
    });
    const results = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    const starter = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Starter", exact: true }) });
    await expect(starter.locator(".animated-price")).toMatchAriaSnapshot(
      billing === "Monthly" ? "- text: $15" : "- text: $12.50",
    );
  }
});
