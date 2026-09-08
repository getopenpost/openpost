import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers.js";

test("repeat visits do not accumulate screenshot click listeners", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  const listenerCount = async () => {
    const document = await session.send("Runtime.evaluate", { expression: "document" });
    const { listeners } = await session.send("DOMDebugger.getEventListeners", {
      objectId: document.result.objectId!,
    });
    return listeners.filter((listener) => listener.type === "click").length;
  };
  await page.goto("/");
  await dismissTelemetryConsent(page);
  await expect(page.locator(".rough-annotation")).toHaveCount(1);
  const originalListeners = await listenerCount();
  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole("link", { name: "Features", exact: true }).first().click();
    await expect(page).toHaveURL(/\/features$/);
    await page.getByRole("link", { name: "OpenPost home", exact: true }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".rough-annotation")).toHaveCount(1);
    expect(await listenerCount()).toBe(originalListeners);
  }
  await page.getByRole("link", { name: "Enlarge Video Editor screenshot" }).press("Enter");
  await expect(page.getByRole("button", { name: "Close Video Editor screenshot" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".medium-zoom-image--opened")).toHaveCount(0);
  await session.detach();
});

test("screenshot pointer clicks preserve new-tab links and remember an early Escape", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await dismissTelemetryConsent(page);
  const trigger = page.getByRole("link", { name: "Enlarge Image Editor screenshot" });
  const newPage = context.waitForEvent("page");
  await trigger.locator("img").click({ modifiers: ["ControlOrMeta"] });
  const imageTab = await newPage;
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Close Image Editor screenshot" })).toHaveCount(0);
  await imageTab.close();
  await trigger.locator("img").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".medium-zoom-image--opened")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const width of [1440, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`product screenshots support keyboard zoom at ${width}px in ${scheme}`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({
        colorScheme: scheme,
        reducedMotion: width === 320 ? "reduce" : "no-preference",
      });
      await page.goto("/");
      await dismissTelemetryConsent(page);
      await expect(page.locator(".rough-annotation")).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath("hero.png") });
      for (const editor of ["Image Editor", "Video Editor"]) {
        const trigger = page.getByRole("link", {
          name: `Enlarge ${editor} screenshot`,
        });
        await trigger.scrollIntoViewIfNeeded();
        await expect(trigger.locator("img")).toHaveJSProperty("complete", true);
        const original = await trigger.locator("img").boundingBox();
        await trigger.press("Enter");
        const close = page.getByRole("button", {
          name: `Close ${editor} screenshot`,
        });
        await expect(close).toBeFocused();
        const enlarged = page.locator(".medium-zoom-image--opened");
        await expect(enlarged).toBeVisible();
        await expect
          .poll(async () => {
            const box = await enlarged.boundingBox();
            return box
              ? box.width > original!.width * 1.1 &&
                  Math.abs(box.y + box.height / 2 - 450) < 2 &&
                  box.x >= 0 &&
                  box.x + box.width <= width + 1
              : false;
          })
          .toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`${editor}-zoom.png`),
        });
        await close.press("Escape");
        await expect(enlarged).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath("studio.png") });
      expect(errors).toEqual([]);
    });
  }
}

test("screenshots remain direct image links without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  for (const editor of ["Image Editor", "Video Editor"]) {
    await expect(page.getByRole("link", { name: `Enlarge ${editor} screenshot` })).toHaveAttribute(
      "href",
      /\/assets\/screenshots\/.+\.webp$/,
    );
    await expect(page.getByRole("link", { name: new RegExp(`Open the ${editor}`) })).toBeVisible();
  }
  await context.close();
});
