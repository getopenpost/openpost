import { expect, test } from "@playwright/test";
import { themeColorContrastRatio } from "../../apps/web/src/lib/themes/validation";

test("documentation shares the dither interaction without changing reader layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/docs/");
    const button = page.getByRole("link", { name: "Open OpenPost", exact: true });
    const mask = () => button.evaluate((el) => getComputedStyle(el, "::before").maskImage);
    await page.mouse.move(0, 0);
    await expect.poll(mask).toContain("data:image/svg+xml");
    const colors = await button.evaluate((el) => ({
      ink: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundColor,
      opacity: Number(getComputedStyle(el, "::before").opacity),
    }));
    expect(
      themeColorContrastRatio(
        colors.ink,
        `color-mix(in srgb, ${colors.ink} ${colors.opacity * 100}%, ${colors.background})`,
      ),
    ).toBeGreaterThanOrEqual(4.5);
    const rest = await mask();
    await button.hover();
    expect(await mask()).not.toBe(rest);
    await page.mouse.move(0, 0);
    expect(await mask()).toBe(rest);
    await page.keyboard.press("Tab");
    await button.focus();
    expect(await mask()).not.toBe(rest);
    await page.screenshot({ path: `.impeccable/review/dither-unified/docs-${scheme}-1440.png` });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.impeccable/review/dither-unified/docs-${scheme}-${width}.png`,
      });
    }
  }
  expect(errors).toEqual([]);
});
