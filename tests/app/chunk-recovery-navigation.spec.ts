import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("a later transient route import recovers after a healthy navigation", async ({ page }) => {
  test.setTimeout(60_000);
  let failedAsset = "";
  let failures = 0;
  let failNext = false;
  await page.route("**/_app/immutable/nodes/*.js", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (failNext && (!failedAsset || failedAsset === pathname)) {
      failedAsset = pathname;
      failures++;
      failNext = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

  failNext = true;
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

  failNext = true;
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  expect(failures).toBe(2);
});

test("two consecutive transient route imports recover within the retry limit", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

  let failedAsset = "";
  let failures = 0;
  let forgotNavigationCount = 0;
  let lastFailedNavigation = 0;
  await page.route("**/forgot-password", async (route) => {
    if (route.request().isNavigationRequest()) forgotNavigationCount++;
    await route.continue();
  });
  await page.route("**/_app/immutable/nodes/*.js", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      failures < 2 &&
      forgotNavigationCount > lastFailedNavigation &&
      (!failedAsset || failedAsset === pathname)
    ) {
      failedAsset = pathname;
      failures++;
      lastFailedNavigation = forgotNavigationCount;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  expect(failures).toBe(2);
  expect(forgotNavigationCount).toBeGreaterThanOrEqual(3);
});

test("a persistent route import failure stops at a visible error", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

  let failedAsset = "";
  let failures = 0;
  let forgotNavigationCount = 0;
  let lastFailedNavigation = 0;
  await page.route("**/forgot-password", async (route) => {
    if (route.request().isNavigationRequest()) forgotNavigationCount++;
    await route.continue();
  });
  await page.route("**/_app/immutable/nodes/*.js", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      forgotNavigationCount > lastFailedNavigation &&
      (!failedAsset || failedAsset === pathname)
    ) {
      failedAsset = pathname;
      failures++;
      lastFailedNavigation = forgotNavigationCount;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/forgot-password");
  await expect.poll(() => failures, { timeout: 15_000 }).toBe(4);
  await expect(
    page.getByRole("heading", { name: /^(OpenPost could not show this page|Internal Error)$/ }),
  ).toBeVisible({ timeout: 30_000 });
  expect(forgotNavigationCount).toBe(4);
});
