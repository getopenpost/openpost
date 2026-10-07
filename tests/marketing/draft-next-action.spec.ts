import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("reviewed tool drafts keep their next action usable at desktop and phone widths", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tools/thread-splitter");
    await dismissTelemetryConsent(page);
    await page
      .getByLabel("Text to split into a thread")
      .fill("A launch lesson worth keeping in our own words.");
    for (const scheme of ["light", "dark"]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      const theme = page.getByRole("button", { name: `Use ${scheme} theme`, exact: true });
      if (await theme.count()) await theme.click();
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("html")).toHaveClass(
        scheme === "dark" ? /dark/ : /^(?!.*\bdark\b)/,
      );
      const action = page.getByRole("button", { name: "Schedule this thread", exact: true });
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const box = await action.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await action.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(action).toBeFocused();
      expect(
        await action.evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            style.boxShadow !== "none" ||
            (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0)
          );
        }),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`thread-${width}-${scheme}.png`),
        animations: "disabled",
      });
    }
  }
  expect(errors).toEqual([]);
});
