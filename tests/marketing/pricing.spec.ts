import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dismissTelemetryConsent } from "./helpers";

test.describe("pricing accessibility", () => {
  for (const scheme of ["light"] as const) {
    test(`pricing is readable and operable in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/pricing");
      await dismissTelemetryConsent(page);
      await page.setViewportSize({ width: 1440, height: 1000 });
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
          billing === "Monthly" ? "- text: $29" : "- text: $290",
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
    });
  }
});
