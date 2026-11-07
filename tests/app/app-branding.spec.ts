import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect as baseExpect, test } from "@playwright/test";
import { authenticatePage, assignBuiltInTheme, createWorkspace, registerUser } from "./helpers";
const expect = baseExpect.configure({ timeout: 20000 });

test("organization branding saves, previews, reloads and stays separate from public entry identity", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { token } = await registerUser(request, `branding-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, token, "Branding studio");
  await authenticatePage(page, token);
  await page.goto("/settings?tab=appearance");
  await page.getByRole("tab", { name: "App branding", exact: true }).click();
  await expect(page.getByLabel("App display name", { exact: true })).toHaveValue("OpenPost");
  await page.getByLabel("App display name", { exact: true }).fill("Studio Social");
  await page.getByLabel("Square logo", { exact: true }).setInputFiles({
    name: "studio.png",
    mimeType: "image/png",
    buffer: await readFile("assets/brand/apple-touch-icon.png"),
  });
  await page.getByLabel("Allow workspace branding overrides", { exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("App branding saved.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName("Studio Social home", {
    timeout: 20000,
  });
  // The calm sidebar shows the logo only; the brand name lives in the
  // accessible name and the document title.
  await expect(page).toHaveTitle("Settings - Studio Social");
  const logo = page.getByTestId("sidebar-home-brand").locator("img");
  await expect(logo).toBeVisible();
  const logoURL = await logo.getAttribute("src");
  expect(logoURL).toContain("/app-branding/");
  await assignBuiltInTheme(request, token, workspace.id, "workshop");
  await page.reload();
  await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName("Studio Social home", {
    timeout: 20000,
  });
  await page.goto("/settings?tab=app-branding");
  await expect(page.getByText("Using organization branding.", { exact: false })).toBeVisible();
  await page.getByLabel("App display name", { exact: true }).fill("Client Social");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName("Client Social home");
  await page.getByRole("button", { name: "Use organization branding", exact: true }).click();
  await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName("Studio Social home", {
    timeout: 20000,
  });
  await page.goto("/draft-import");
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute(
    "href",
    /\/assets\/brand\/icon\.svg$/,
  );
  await expect(page).not.toHaveTitle(/Studio Social/);
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute(
    "href",
    /\/assets\/brand\/icon\.svg$/,
  );
  await expect(page.getByText("Studio Social", { exact: true })).toHaveCount(0);
});

test("branding controls and previews fit desktop and narrow screens in both schemes", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const { token } = await registerUser(request, `branding-layout-${randomUUID()}@example.com`);
  await createWorkspace(request, token, "Branding layout");
  await authenticatePage(page, token);
  await page.goto("/settings?tab=appearance");
  await page.getByRole("tab", { name: "App branding", exact: true }).click();
  await page
    .getByLabel("App display name", { exact: true })
    .fill("A studio with a deliberately long display name for previews");
  for (const scheme of ["light"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("mode-watcher-mode", value);
    }, scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByLabel("App display name", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Preview", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page
        .locator('section[aria-labelledby="app-branding-heading"]')
        .screenshot({ path: testInfo.outputPath(`branding-settings-${scheme}-${width}.png`) });
      await page
        .getByRole("region", { name: "Preview", exact: true })
        .screenshot({ path: testInfo.outputPath(`branding-preview-${scheme}-${width}.png`) });
    }
  }
});

test("a delayed branding read cannot replace a successful save", async ({ page, request }) => {
  test.setTimeout(120000);
  const { token } = await registerUser(request, `branding-race-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, token, "Branding race");
  const endpoint = `/api/v1/app-branding/${workspace.id}`;
  const previous = await (
    await request.get(endpoint, { headers: { Authorization: `Bearer ${token}` } })
  ).json();
  await authenticatePage(page, token);
  await page.goto("/settings?tab=appearance");
  await page.getByRole("tab", { name: "App branding", exact: true }).click();
  await expect(page.getByLabel("App display name", { exact: true })).toHaveValue("OpenPost");
  let releaseRead = () => {};
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const released = new Promise<void>((resolve) => (releaseRead = resolve));
  let complete: Promise<unknown> = Promise.resolve();
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const delayed = route.request();
    complete = Promise.race([
      page.waitForEvent("requestfinished", { predicate: (request) => request === delayed }),
      page.waitForEvent("requestfailed", { predicate: (request) => request === delayed }),
    ]);
    markStarted();
    await released;
    await route.fulfill({ json: previous }).catch(() => {});
  });
  await page.clock.install();
  await page.clock.fastForward(31000);
  await page.clock.resume();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await started;
  await page.getByLabel("App display name", { exact: true }).fill("Fresh Branding");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("App branding saved.", { exact: true })).toBeVisible();
  releaseRead();
  await complete;
  await page.clock.resume();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName("Fresh Branding home");
});
