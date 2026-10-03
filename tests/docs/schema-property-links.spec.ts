import { expect, test } from "@playwright/test";

for (const [route, property] of [
  ["workflows/create-workflow", "workspace_id"],
  ["publications/create-publication", "Idempotency-Key"],
]) {
  test(`schema ${property} link has a discoverable name and keyboard action`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.copiedPropertyLink = text;
          },
        },
      });
    });
    await page.goto(`/docs/api-reference/${route}`);
    const field = page.getByText(property, { exact: true }).first();
    const button = field.locator("xpath=../..").getByRole("button").last();
    await expect(button).toHaveAccessibleName(`Copy link to ${property}`, { timeout: 2000 });
    await button.focus();
    await button.press("Enter");
    await expect
      .poll(async () => {
        const value = await page.locator("html").getAttribute("data-copied-property-link");
        return value ? new URL(value).searchParams.get("s-highlight") : null;
      })
      .toBe(property);
    await expect(button).toBeFocused();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`property-${width}-${scheme}.png`) });
      }
    }
  });
}
