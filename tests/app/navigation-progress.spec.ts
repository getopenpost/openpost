import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`navigation progress follows slow routes with ${reducedMotion} motion`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({
      reducedMotion,
      colorScheme: reducedMotion === "reduce" ? "dark" : "light",
    });
    await page.goto("/login");
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    let release!: () => void;
    const download = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*.js", async (route) => {
      await download;
      await route.continue();
    });
    try {
      await page.locator('a[href="/register"]').click();
      await expect(page.locator(".navigation-progress .bar")).toBeVisible();
      if (reducedMotion === "reduce")
        await expect(page.locator(".navigation-progress .bar")).toHaveCSS(
          "transition-duration",
          "0s",
        );
      await page.screenshot({ path: testInfo.outputPath("navigation-loading.png") });
    } finally {
      release();
    }
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
    await expect(page.locator(".navigation-progress .bar")).toHaveCount(0);
    await page.unroute("**/*.js");
    // Cached history navigation should finish without showing another bar.
    await page.evaluate(() => {
      const bars: number[] = [];
      Object.assign(window, { navigationBars: bars });
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.classList.contains("bprogress"))
              bars.push(performance.now());
          }
      }).observe(document.querySelector(".navigation-progress")!, { childList: true });
    });
    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => (window as Window & { navigationBars: number[] }).navigationBars),
    ).toEqual([]);
  });
}

test("a superseded slow navigation cannot clear the current progress", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('a[href="/register"]')).toBeVisible();
  await page.waitForLoadState("networkidle");
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const second = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  let phase = first;
  await page.route("**/*.js", async (route) => {
    const pending = phase;
    await pending;
    await route.continue();
  });
  try {
    await page.locator('a[href="/register"]').click();
    await expect(page.locator(".navigation-progress .bar")).toBeVisible();
    phase = second;
    await page.locator('a[href="/forgot-password"]').click();
    releaseFirst();
    await expect(page.locator(".navigation-progress .bar")).toBeVisible();
    // Keep the replacement route stalled beyond the previous bar's completion animation.
    await page.waitForTimeout(700);
    await expect(page.locator(".navigation-progress .bar")).toBeVisible();
  } finally {
    releaseFirst();
    releaseSecond();
  }
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.locator(".navigation-progress .bar")).toHaveCount(0);
});
