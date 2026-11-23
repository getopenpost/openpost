import { expect, test } from "@playwright/test";

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
  const updateWorkerCreated = context.waitForEvent("serviceworker", (worker) =>
    worker.url().endsWith("/sw.js?update-test=1"),
  );
  await page.evaluate(async () => {
    await (await caches.open("openpost-pages-1")).put("/old-page", new Response("legacy"));
    await navigator.serviceWorker.register("/sw.js?update-test=1", { scope: "/" });
  });
  const updateWorker = await updateWorkerCreated;
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
  // Closing a page and activating its waiting worker are separate browser tasks.
  // Observe activation without opening another client that could keep the old worker alive.
  await expect
    .poll(() =>
      updateWorker.evaluate(
        "({ url: self.registration.active?.scriptURL, state: self.registration.active?.state })",
      ),
    )
    .toEqual({ url: updateWorker.url(), state: "activated" });
  const reopened = await context.newPage();
  await reopened.goto("/manifest.webmanifest");
  await expect
    .poll(() => reopened.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toContain("?update-test=1");
  expect(await reopened.evaluate(() => caches.has("openpost-pages-1"))).toBe(false);
});

test("desktop PWA is discoverable and controls a direct editor visit", async ({
  playwright,
  launchOptions,
  headless,
  channel,
  baseURL,
}) => {
  // Installation requires a regular profile. Playwright owns and removes this temporary one.
  const context = await playwright.chromium.launchPersistentContext("", {
    ...launchOptions,
    headless,
    channel,
    baseURL,
  });
  try {
    const page = context.pages()[0];
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
  } finally {
    await context.close();
  }
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
