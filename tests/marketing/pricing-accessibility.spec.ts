import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dismissTelemetryConsent } from "./helpers.js";

for (const scheme of ["light", "dark"] as const) {
  test(`pricing is readable and operable in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/pricing");
    await dismissTelemetryConsent(page);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const billing of ["Monthly", "Yearly"]) {
        const toggle = page.getByRole("button", { name: new RegExp(`^${billing}`) });
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        const solo = page
          .getByRole("columnheader")
          .filter({ has: page.getByRole("heading", { name: "Solo", exact: true }) });
        await expect(solo.locator(".animated-price")).toMatchAriaSnapshot(
          billing === "Monthly" ? "- text: $29" : "- text: $24.17",
        );
        const results = await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(results.violations).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      }
      if (width < 768) {
        const team = page.getByRole("button", { name: "Team", exact: true });
        await team.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("link", { name: "Start Team", exact: true })).toBeVisible();
        await expect(
          page.getByRole("row", { name: "People, including you 5", exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Solo", exact: true }).click();
      }
    }
  });
}
