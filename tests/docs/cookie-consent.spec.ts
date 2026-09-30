import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ storageState: { cookies: [], origins: [] } });

for (const scheme of ["light", "dark"] as const) {
  test(`docs cookie choices work in ${scheme}`, async ({ page, context }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/docs/");
    const banner = page.getByTestId("telemetry-consent");
    await expect(banner).toBeVisible();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await banner.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await banner.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await banner.screenshot({ path: testInfo.outputPath(`docs-cookies-${width}-${scheme}.png`) });
    }
    const accessibility = await new AxeBuilder({ page })
      .include('[data-testid="telemetry-consent"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await banner.getByText("More options", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await banner.getByRole("button", { name: "Use cookie-free analytics" }).click();
    await expect(banner).toBeHidden();
    expect(
      (await context.cookies()).find((cookie) => cookie.name === "openpost_analytics")?.value,
    ).toBe("v1%3Acookieless");
    await page.setViewportSize({ width: 1280, height: 844 });
    const preferences = page.getByRole("button", { name: "Cookie preferences" });
    await preferences.click();
    await banner.getByRole("button", { name: "Close", exact: true }).click();
    await expect(preferences).toBeFocused();
    await page.keyboard.press("Enter");
    await banner.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(async () => {
      await preferences.click();
      await expect(banner).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await expect(banner.getByRole("button", { name: "Decline", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await banner.getByRole("button", { name: "Accept", exact: true }).click();
    expect(
      (await context.cookies()).find((cookie) => cookie.name === "openpost_analytics")?.value,
    ).toBe("v1%3Apersistent");
    await page.reload();
    await expect(banner).toBeHidden();
  });
}
