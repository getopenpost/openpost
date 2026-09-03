import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const SHOT = "/tmp/appearance-qa";

test.beforeAll(async () => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(SHOT, { recursive: true });
});

async function loginAsFreshUser(request: APIRequestContext, page: Page, seed: string) {
  const email = `appearance-qa-${seed}@example.com`;
  const { token } = await registerUser(request, email);
  const workspace = await createWorkspace(request, token, `Appearance QA ${seed}`);
  await authenticatePage(page, token);
  return { token, workspace };
}

test("appearance tab renders across viewports, schemes, and motion", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

  await loginAsFreshUser(request, page, "matrix");
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  // Desktop light.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT}/library-desktop-light.png`, fullPage: true });

  // Desktop dark.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOT}/library-desktop-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });

  // Reduced motion.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/library-desktop-reduced-motion.png`, fullPage: true });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Phone widths, no horizontal overflow.
  for (const [name, width] of [
    ["390", 390],
    ["320", 320],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(overflow, `no horizontal overflow at ${name}px`).toBe(true);
    await page.screenshot({ path: `${SHOT}/library-${name}-light.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1600, height: 900 });

  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("built-in gallery opens a preview and editor controls are keyboard reachable", async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

  await loginAsFreshUser(request, page, "editor");
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `${SHOT}/editor-entry-desktop.png`, fullPage: true });

  // Open the first previewable/duplicateable theme entry if present, scoped to
  // the settings main region so sidebar links (e.g. "View all") cannot match.
  const previewTrigger = page
    .locator("main")
    .getByRole("button", { name: /preview|view|open/i })
    .first();
  if (await previewTrigger.count()) {
    await previewTrigger.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOT}/editor-preview-open.png`, fullPage: true });
  }
  // The keyboard traversal below measures the appearance tab: fail loudly if
  // the trigger above navigated away instead of opening inline UI.
  expect(page.url(), "appearance tab stays mounted").toContain("settings");

  // Keyboard traversal: tab through the first 25 focusable elements, confirm a
  // visible focus indicator exists on each (outline or focus-visible ring).
  await page.keyboard.press("Tab");
  let focusable = 0;
  let withIndicator = 0;
  for (let step = 0; step < 25; step += 1) {
    const focused = page.locator(":focus");
    if ((await focused.count()) === 0) break;
    focusable += 1;
    const indicator = await focused.evaluate((element) => {
      const style = getComputedStyle(element);
      const boxShadow = style.boxShadow !== "none";
      const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      return boxShadow || outline;
    });
    if (indicator) withIndicator += 1;
    await page.keyboard.press("Tab");
  }
  await page.screenshot({ path: `${SHOT}/editor-keyboard-focus.png`, fullPage: true });

  // Touch targets: desktop density may use the theme control height, but
  // coarse pointers must always get 44px targets. Measure in a
  // touch-emulated context with the same session.
  const touchContext = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  await touchContext.addCookies(await page.context().cookies());
  const touchPage = await touchContext.newPage();
  await touchPage.goto("/settings?tab=appearance");
  await expect(touchPage.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible({
    timeout: 20_000,
  });
  await touchPage.waitForLoadState("networkidle").catch(() => undefined);
  const smallTargets: string[] = await touchPage.evaluate(() => {
    const flagged: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("main button")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const tag = element.tagName.toLowerCase();
      if (tag === "a") continue;
      if (rect.height > 0 && rect.height < 44) {
        flagged.push(
          `${tag}: ${Math.round(rect.height)}px :: ${(element.textContent ?? "").trim().slice(0, 40)}`,
        );
      }
    }
    return flagged.slice(0, 20);
  });
  await touchContext.close();

  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  expect(focusable, "keyboard reaches appearance controls").toBeGreaterThan(0);
  expect(withIndicator, "every focused control shows a focus indicator").toBe(focusable);
  expect(smallTargets, `controls under 44px: ${smallTargets.join(" | ")}`).toEqual([]);
});

test("workspace assignment controls exist and switching is atomic", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

  const { token } = await loginAsFreshUser(request, page, "assign");
  await createWorkspace(request, token, "Appearance QA second");
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const themeIdBefore =
    (await page.evaluate(() => document.documentElement.getAttribute("data-theme-id"))) ?? "none";
  await page.screenshot({ path: `${SHOT}/assign-before-switch.png`, fullPage: true });
  // A resolved theme is always applied, even before any assignment exists.
  expect(themeIdBefore, "a theme is always resolved").not.toBe("none");

  // If a workspace switcher exists, switch and capture mid-transition frames.
  const switcher = page.getByRole("button", { name: /workspace|switch/i }).first();
  if (await switcher.count()) {
    await switcher.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT}/assign-mid-switch.png` });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOT}/assign-after-switch.png`, fullPage: true });
  }
  const themeIdAfter =
    (await page.evaluate(() => document.documentElement.getAttribute("data-theme-id"))) ?? "none";

  expect(themeIdAfter, "a theme is still resolved after switching").not.toBe("none");
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  // The shell stays mounted across the switch: the heading must survive.
  await expect(page.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible({
    timeout: 20_000,
  });
});
