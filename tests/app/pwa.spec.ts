import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

test("service worker updates wait for every open app window to close", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    sessionStorage.removeItem("pwa-registration-complete");
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = async (...args) => {
      const registration = await register(...args);
      sessionStorage.setItem("pwa-registration-complete", "yes");
      return registration;
    };
  });
  await page.goto("/image-editor");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => sessionStorage.getItem("pwa-registration-complete") === "yes");
  const second = await context.newPage();
  await second.goto("/image-editor");
  await second.waitForFunction(() => sessionStorage.getItem("pwa-registration-complete") === "yes");
  await page.evaluate(async () => {
    await (await caches.open("openpost-pages-1")).put("/old-page", new Response("legacy"));
    await navigator.serviceWorker.register("/sw.js?update-test=1", { scope: "/" });
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.waiting?.scriptURL,
      ),
    )
    .toContain("?update-test=1");
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).not.toContain(
    "?update-test=1",
  );
  expect(await page.evaluate(() => caches.has("openpost-pages-1"))).toBe(true);
  await page.close();
  expect(
    await second.evaluate(
      async () => (await navigator.serviceWorker.getRegistration())?.waiting?.scriptURL,
    ),
  ).toContain("?update-test=1");
  await second.close();
  const reopened = await context.newPage();
  await reopened.goto("/manifest.webmanifest");
  await expect
    .poll(() => reopened.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toContain("?update-test=1");
  expect(await reopened.evaluate(() => caches.has("openpost-pages-1"))).toBe(false);
});

test("desktop PWA is discoverable and controls a direct editor visit", async ({ page }) => {
  await page.goto("/image-editor/local_design_pwa_probe");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.active?.scriptURL;
      }),
    )
    .toBe(`${new URL(page.url()).origin}/sw.js`);
  const manifest = await page.request.get("/manifest.webmanifest");
  const data = await manifest.json();
  expect(data.id).toBe("/");
  expect(data.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png" }),
    ]),
  );
  const session = await page.context().newCDPSession(page);
  await session.send("Page.enable");
  expect((await session.send("Page.getInstallabilityErrors")).installabilityErrors).toEqual([]);
});

test("a cached image editor restores and exports a design offline", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.goto("/image-editor");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole("button", { name: /Instagram square/ }).click();
  const title = page.getByRole("textbox", { name: "Design title" });
  await title.fill("Offline desktop design");
  const saveIndicator = page.getByTestId("image-editor-save-indicator");
  await expect(saveIndicator).toHaveAttribute("data-state", "saved");
  // The first visit used client routing. Exercise a controlled document request too.
  await page.reload();
  await expect(title).toHaveValue("Offline desktop design");
  await context.setOffline(true);
  await page.reload();
  await expect(title).toHaveValue("Offline desktop design");
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const png = await download;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  expect(await sharp(await png.path()).metadata()).toMatchObject({
    format: "png",
    width: 1080,
    height: 1080,
  });
  const assets = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/_app/immutable/"))
      .map((entry) => ({
        name: entry.name,
        bytes: (entry as PerformanceResourceTiming).transferSize,
      })),
  );
  expect(assets.length).toBeGreaterThan(5);
  expect(assets.every((entry) => entry.bytes === 0)).toBe(true);
});

test("unvisited app pages have an offline fallback and APIs stay out of caches", async ({
  page,
  context,
}) => {
  await page.goto("/image-editor");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.goto("/image-editor?code=pwa-test&token=pwa-test");
  await page.goto("/api/v1/version");
  const cacheURLs = await page.evaluate(async () => {
    const requests = await Promise.all(
      (await caches.keys()).map(async (name) => (await caches.open(name)).keys()),
    );
    return requests.flat().map((request) => request.url);
  });
  expect(cacheURLs.some((url) => url.includes("/api/"))).toBe(false);
  expect(cacheURLs.some((url) => url.includes("pwa-test"))).toBe(false);
  expect(cacheURLs.some((url) => url.includes("/image-editor-models/"))).toBe(false);
  expect(cacheURLs.some((url) => url.includes("/offline.html"))).toBe(true);
  await context.setOffline(true);
  await page.goto("/quick-cut");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`desktop install invitation appears once and remains available in the profile menu in ${scheme}`, async ({
    page,
    request,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const user = await registerUser(request, `pwa-${Date.now()}@example.com`);
    await createWorkspace(request, user.token, "Desktop PWA");
    await authenticatePage(page, user.token);
    await page.goto("/publications");
    await expect(page.getByTestId("profile-menu-trigger")).toBeVisible();
    const announceInstall = () =>
      page.evaluate(() => {
        const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: async () => {
            sessionStorage.setItem("install-prompt-called", "yes");
          },
          userChoice: Promise.resolve({ outcome: "dismissed" }),
        });
        window.dispatchEvent(event);
      });
    await announceInstall();
    await expect(page.getByText("Install OpenPost?", { exact: true })).toBeVisible();
    await expect(page.locator('[data-sonner-toast][data-mounted="true"]')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("desktop-install-toast.png"),
      animations: "disabled",
    });
    await page.reload();
    await expect(page.getByTestId("profile-menu-trigger")).toBeVisible();
    await announceInstall();
    await expect(page.getByText("Install OpenPost?", { exact: true })).not.toBeVisible();
    await page.getByTestId("profile-menu-trigger").click();
    const install = page.getByRole("menuitem", {
      name: "Install app",
      exact: true,
    });
    await expect(install).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("desktop-install-menu.png"),
      animations: "disabled",
    });
    await install.click();
    expect(await page.evaluate(() => sessionStorage.getItem("install-prompt-called"))).toBe("yes");
    await page.getByTestId("profile-menu-trigger").click();
    await expect(install).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(install).not.toBeVisible();
    await page.setViewportSize({ width: 600, height: 800 });
    await page.setViewportSize({ width: 1280, height: 800 });
    if (!(await page.getByRole("menuitem", { name: "Log out", exact: true }).isVisible())) {
      await page.getByTestId("profile-menu-trigger").click();
    }
    await expect(page.getByRole("menuitem", { name: "Log out", exact: true })).toBeVisible();
    await expect(install).not.toBeVisible();
  });
}

test("a cached local video project reopens and exports offline", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const folder = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(folder);
        for (const name of ["queryPermission", "requestPermission"]) {
          Object.defineProperty(prototype, name, {
            configurable: true,
            value: async () => "granted",
          });
        }
        return folder;
      },
    });
  });
  await page.goto("/video-editor");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Offline video proof");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await page
    .getByRole("complementary", { name: "Assets" })
    .getByRole("button", { name: "Add layer" })
    .click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Save", exact: true }).click();
  await expect(page.locator("header").getByText("Saving…", { exact: true })).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export MP4" }).click();
  await expect(page.getByText("Saved Offline video proof.mp4 to the exports folder.")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Exports" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Offline video proof.mp4" }).click();
  const file = await (await downloading).path();
  expect(file).not.toBeNull();
  const bytes = await readFile(file!);
  expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");
  expect(bytes.length).toBeGreaterThan(1000);
});

test("offline fallback respects language, theme, keyboard and narrow screens", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/image-editor");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.addCookies([
    { name: "PARAGLIDE_LOCALE", value: "pt", url: new URL(page.url()).origin },
  ]);
  await context.setOffline(true);
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/quick-cut");
      await expect(page.getByRole("heading", { name: "Está offline" })).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Tentar novamente" })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`offline-${width}-${colorScheme}.png`) });
    }
  }
});
