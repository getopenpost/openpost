import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const [label, preference] of [
  ["Decline", "off"],
  ["Accept", "persistent"],
  ["Use cookie-free analytics", "cookieless"],
] as const) {
  test(`cookie choice ${label} persists and can be changed`, async ({ page, context }) => {
    await page.goto("/");
    const banner = page.getByTestId("telemetry-consent");
    await expect(banner).toBeVisible();
    if (preference === "cookieless")
      await banner.getByText("More options", { exact: true }).click();
    await banner.getByRole("button", { name: label, exact: true }).click();
    await expect(banner).toBeHidden();
    expect(
      (await context.cookies()).find((cookie) => cookie.name === "openpost_analytics")?.value,
    ).toBe(`v1%3A${preference}`);
    await page.getByRole("button", { name: "Cookie preferences", exact: true }).click();
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Cookie preferences", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    if (preference === "cookieless")
      await banner.getByText("More options", { exact: true }).click();
    await expect(banner.getByRole("button", { name: label, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await banner
      .getByRole("button", { name: preference === "off" ? "Accept" : "Decline", exact: true })
      .click();
    await expect(banner).toBeHidden();
    expect(
      (await context.cookies()).find((cookie) => cookie.name === "openpost_analytics")?.value,
    ).toBe(`v1%3A${preference === "off" ? "persistent" : "off"}`);
    await page.reload();
    await expect(banner).toBeHidden();
  });
}

for (const width of [320, 390, 1280]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`cookie banner fits ${width}px in ${scheme} @desktop`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/");
      const banner = page.getByTestId("telemetry-consent");
      await expect(banner).toBeVisible();
      await banner.screenshot({ path: testInfo.outputPath(`cookies-${width}-${scheme}.png`) });
      const bounds = await banner.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await banner.getByText("More options", { exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(banner.getByRole("button", { name: "Use cookie-free analytics" })).toBeVisible();
      expect(await banner.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      for (const button of await banner.getByRole("button").all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await banner.screenshot({
        path: testInfo.outputPath(`cookies-options-${width}-${scheme}.png`),
      });
      const accessibility = await new AxeBuilder({ page })
        .include('[data-testid="telemetry-consent"]')
        .analyze();
      expect(accessibility.violations).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
