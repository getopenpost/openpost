import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Image Editor starts a blank project from the primary action", async ({ page }) => {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
});

test("Video Editor creates after folder choice and recovers from cancellation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        if (++attempts === 1) throw new DOMException("Canceled", "AbortError");
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        for (const method of ["queryPermission", "requestPermission"]) {
          Object.defineProperty(prototype, method, {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
  await page.goto("/video-editor");
  const create = page.getByRole("button", { name: "New project", exact: true });
  await create.click();
  await expect(create).toBeEnabled();
  await expect(page).toHaveURL(/\/video-editor$/);
  await page.getByRole("button", { name: /Shorts, TikTok and Reels/ }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Untitled project");
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
});

for (const signedIn of [false, true]) {
  test(`editor start pages fit both schemes and phone widths (${signedIn ? "workspace" : "guest"})`, async ({
    page,
    request,
  }, testInfo) => {
    if (signedIn) {
      const auth = await registerUser(request, `editor-start-${Date.now()}@example.com`);
      await createWorkspace(request, auth.token, "Editor start checks");
      await authenticatePage(page, auth.token);
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of [signedIn ? "image-editor/new" : "image-editor", "video-editor"]) {
      await page.goto(`/${route}`);
      const title = route.startsWith("image-editor") ? "Image Editor" : "Video Editor";
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Language", exact: true })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "New project", exact: true })).toBeEnabled();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
          await expect(page.locator("html")).toHaveCSS("color-scheme", colorScheme);
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toBe(true);
          const create = page.getByRole("button", { name: "New project", exact: true });
          await create.focus();
          await expect(create).toBeFocused();
          await page.screenshot({
            path: testInfo.outputPath(`${route.replaceAll("/", "-")}-${width}-${colorScheme}.png`),
          });
        }
      }
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
