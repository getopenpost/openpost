import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  expect as baseExpect,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  authenticatePage,
  composerDestinations,
  createWorkspace,
  openComposerPlatformSettings,
  registerUser,
  assignBuiltInTheme,
} from "./helpers";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  fixtureDirectory,
  rasterFixtureFiles,
  uploadImageFixture,
  prepareProductPage,
} from "./product-capture-fixtures";
import { expectNoSeriousAccessibilityViolations } from "./accessibility";

test.describe("integration settings", () => {
  async function openDiscordPublication(
    page: Page,
    request: APIRequestContext,
    width: number,
    scheme: "light" | "dark",
  ) {
    const { token } = await registerUser(request, `bot-settings-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Integration settings");
    const accountID = randomUUID();
    const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      databasePath,
      `INSERT INTO social_accounts
      (id, workspace_id, slug, platform, account_id, account_username, access_token_encrypted,
       capability_state_json, is_active)
      VALUES ('${accountID}', '${workspace.id}', 'discord-test', 'discord', 'guild-test',
      'Test server', X'00', '{"connection_type":"bot"}', 1);`,
    ]);
    const created = await request.post("/api/v1/publications", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        workspace_id: workspace.id,
        title: "Integration settings check",
        source_text: "A clearly labelled local test draft.",
        content_profile: "short_text",
        social_account_ids: [accountID],
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    await page.route(`**/api/v1/accounts/${accountID}/publishing-options/**`, (route) =>
      route.fulfill({
        json: {
          options: [
            { value: "channel-test", label: "#test-posts" },
            { value: "channel-updates", label: "#updates" },
          ],
        },
      }),
    );
    await authenticatePage(page, token);
    await page.addInitScript((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/publications/${publication.id}`);
  }

  test(`Discord settings keep required feedback usable at 1440px in light`, async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openDiscordPublication(page, request, 1440, "light");
    await composerDestinations(page)
      .getByRole("tab", { name: /^Test server/ })
      .click();
    await openComposerPlatformSettings(page);
    const dialog = page.getByRole("dialog", { name: "Discord settings", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("[data-sonner-toast]")).toContainText("Channel");
    await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    await expect(
      page.locator(
        "[data-sonner-toaster][data-y-position=top][data-x-position=right] [data-sonner-toast]",
      ),
    ).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Channel", exact: true })).toBeFocused();
    const toastBounds = await page.locator("[data-sonner-toast]").boundingBox();
    expect(toastBounds!.x).toBeGreaterThanOrEqual(0);
    expect(toastBounds!.x + toastBounds!.width).toBeLessThanOrEqual(1440);

    const requiredAccessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .include("[data-sonner-toast]")
      .analyze();
    expect(requiredAccessibility.violations).toEqual([]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await openComposerPlatformSettings(page);
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440);
    await dialog.getByRole("combobox", { name: "Channel", exact: true }).click();
    await page.getByRole("option", { name: "#test-posts", exact: true }).click();
    await dialog.getByRole("button", { name: "Add embed", exact: true }).click();
    await dialog.getByLabel("Title", { exact: true }).fill("Launch notes");
    await dialog.getByLabel("Description", { exact: true }).fill("A structured embed preview.");
    const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(accessibility.violations).toEqual([]);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`Discord Social Set defaults persist at 1440px in light`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openDiscordPublication(page, request, 1440, "light");
    const dialog = page.getByRole("dialog", { name: "Discord settings", exact: true });
    await page.getByTestId("composer-account-control").click();
    await page.getByRole("button", { name: "Manage Social Sets", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "Manage Social Sets", exact: true });
    await manager.getByRole("textbox", { name: "Set name", exact: true }).fill("Launch updates");
    await manager.getByLabel("Format for Test server", { exact: true }).click();
    await page.getByRole("option", { name: "Discord message", exact: true }).click();
    await manager.getByRole("button", { name: "Edit post settings", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Channel", exact: true }).click();
    await page.getByRole("option", { name: "#test-posts", exact: true }).click();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/social-sets") && response.request().method() === "POST",
    );
    await manager.getByRole("button", { name: "Save", exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
    const socialSet = await savedResponse.json();
    expect(socialSet.accounts[0].default_settings).toEqual({ channel_id: "channel-test" });
    await expect(manager.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(manager).not.toBeVisible();
    await page.getByTestId("composer-account-control").click();
    await page.getByRole("button", { name: "Manage Social Sets", exact: true }).click();
    await manager.getByRole("button", { name: "Edit post settings", exact: true }).click();
    await expect(dialog.getByRole("combobox", { name: "Channel", exact: true })).toContainText(
      "#test-posts",
    );
    await dialog.getByRole("combobox", { name: "Channel", exact: true }).click();
    await page.getByRole("option", { name: "#updates", exact: true }).click();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    const updated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/social-sets/${socialSet.id}`) &&
        response.request().method() === "PUT",
    );
    await manager.getByRole("button", { name: "Save", exact: true }).click();
    const updatedResponse = await updated;
    expect(updatedResponse.ok(), await updatedResponse.text()).toBe(true);
    expect((await updatedResponse.json()).accounts[0].default_settings).toEqual({
      channel_id: "channel-updates",
    });
    await expect(manager.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(manager).not.toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("composer-account-control")).toContainText("Launch updates");
    await composerDestinations(page)
      .getByRole("tab", { name: /^Test server/ })
      .click();
    await openComposerPlatformSettings(page);
    await expect(dialog.getByRole("combobox", { name: "Channel", exact: true })).toContainText(
      "#updates",
    );
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    expect(errors).toEqual([]);
  });
});

test.describe("workspace settings", () => {
  const onePixelPNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
    "base64",
  );

  test("workspace image settings upload a device image and save it", async ({ page, request }) => {
    const auth = await registerUser(request, `workspace-image-${Date.now()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Workspace image settings");
    await authenticatePage(page, auth.token);
    await page.goto(`/settings?tab=general&workspace=${workspace.id}`);

    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change image", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Change image", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Workspace image" });
    await expect(dialog.getByRole("tab", { name: "Device", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "workspace.png",
      mimeType: "image/png",
      buffer: onePixelPNG,
    });
    await dialog.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    const save = page.getByRole("button", { name: "Save changes", exact: true });
    await expect(save).toBeEnabled();
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes(`/api/v1/workspaces/${workspace.id}/settings`),
    );
    await save.click();
    expect((await saveResponse).ok()).toBeTruthy();

    const settingsResponse = await request.get(`/api/v1/workspaces/${workspace.id}/settings`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(settingsResponse.ok()).toBeTruthy();
    const settings = (await settingsResponse.json()) as { avatar_url?: string };
    expect(settings.avatar_url).toMatch(/^\/media\/[a-zA-Z0-9_-]+$/);
  });

  test("workspace timezone and required client review survive a reload", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `workspace-review-${Date.now()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Canadian workspace");
    await authenticatePage(page, auth.token);
    await page.goto(`/settings?tab=general&workspace=${workspace.id}`);

    const timezone = page.getByRole("button", { name: "Timezone", exact: true });
    const review = page.getByRole("checkbox", { name: "Require client review for every post" });
    const save = page.getByRole("button", { name: "Save changes", exact: true });
    for (const zone of [
      { id: "America/Halifax", label: /Halifax \(Atlantic Time\)/ },
      { id: "America/St_Johns", label: /St Johns \(Newfoundland Time\)/ },
    ]) {
      await timezone.click();
      await page.getByRole("option", { name: zone.label }).click();
      await review.setChecked(true);
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes(`/api/v1/workspaces/${workspace.id}/settings`),
      );
      await save.click();
      expect((await saved).ok()).toBeTruthy();
      await page.reload();
      await expect(timezone).toHaveText(zone.label);
      await expect(review).toBeChecked();
      const settings = await request.get(`/api/v1/workspaces/${workspace.id}/settings`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      expect(settings.ok()).toBeTruthy();
      expect(await settings.json()).toMatchObject({
        timezone: zone.id,
        require_client_review: true,
      });
    }

    await review.uncheck();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes(`/api/v1/workspaces/${workspace.id}/settings`),
    );
    await save.click();
    expect((await saved).ok()).toBeTruthy();
    await page.reload();
    await expect(review).not.toBeChecked();
  });
});

test.describe("app branding", () => {
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
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName(
      "Studio Social home",
      {
        timeout: 20000,
      },
    );
    // The calm sidebar shows the logo only; the brand name lives in the
    // accessible name and the document title.
    await expect(page).toHaveTitle("Settings - Studio Social");
    const logo = page.getByTestId("sidebar-home-brand").locator("img");
    await expect(logo).toBeVisible();
    const logoURL = await logo.getAttribute("src");
    expect(logoURL).toContain("/app-branding/");
    await assignBuiltInTheme(request, token, workspace.id, "workshop");
    await page.reload();
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName(
      "Studio Social home",
      {
        timeout: 20000,
      },
    );
    await page.goto("/settings?tab=app-branding");
    await expect(page.getByText("Using organization branding.", { exact: false })).toBeVisible();
    await page.getByLabel("App display name", { exact: true }).fill("Client Social");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName("Client Social home");
    await page.getByRole("button", { name: "Use organization branding", exact: true }).click();
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName(
      "Studio Social home",
      {
        timeout: 20000,
      },
    );
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
  }) => {
    test.setTimeout(120_000);
    const { token } = await registerUser(request, `branding-layout-${randomUUID()}@example.com`);
    await createWorkspace(request, token, "Branding layout");
    await authenticatePage(page, token);
    await page.goto("/settings?tab=appearance");
    await page.getByRole("tab", { name: "App branding", exact: true }).click();
    await page
      .getByLabel("App display name", { exact: true })
      .fill("A studio with a deliberately long display name for previews");
    await page.evaluate((value) => {
      localStorage.setItem("mode-watcher-mode", value);
    }, "light");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await expect(page.getByLabel("App display name", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Preview", exact: true })).toBeVisible();
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
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName(
      "Fresh Branding home",
    );
  });
});

test.describe("brand font upload", () => {
  test.use({ hasTouch: true });

  test("invalid brand fonts explain the file problem and allow a valid upload afterwards", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `font-upload-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Font upload recovery");
    await authenticatePage(page, auth.token);
    // Playwright enables chooser interception asynchronously when the listener is added.
    // Arm it before navigation so the keyboard shortcut cannot overtake that setup.
    const chooseFont = page.waitForEvent("filechooser");
    await page.goto(`/settings?tab=brand&workspace=${workspace.id}`);
    await page.getByText("Add a custom font", { exact: true }).click();
    await page.getByRole("textbox", { name: "Family name", exact: true }).fill("Recovery Geist");
    const license = page.getByRole("checkbox", { name: /I confirm that this workspace/ });
    await license.check();
    const input = page.getByLabel("Upload font", { exact: true });
    await license.focus();
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    const uploadLabel = input.locator("..");
    expect(await uploadLabel.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
      "none",
    );
    const bounds = (await uploadLabel.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const invalid = { name: "broken.ttf", mimeType: "font/ttf", buffer: Buffer.from("not a font") };
    await page.keyboard.press("Space");
    await (await chooseFont).setFiles(invalid);
    const alert = page.getByRole("alert").filter({ hasText: /font|network/i });
    await expect(alert).toHaveText(
      "This font file could not be read. Choose a valid WOFF2, TTF, or OTF file.",
    );
    await expect(input).toHaveValue("");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await alert.scrollIntoViewIfNeeded();
    await expect(alert).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1280,
    );
    await input.setInputFiles(invalid);
    await expect(alert).toBeVisible();
    await expect(input).toBeEnabled();
    const fontPath = fileURLToPath(
      new URL("../../assets/brand/fonts/Geist-Regular.ttf", import.meta.url),
    );
    await page.route(/\/api\/v1\/media\/upload(?:-session)?(?:\?|$)/, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Font storage is full." }),
      }),
    );
    await input.setInputFiles(fontPath);
    await expect(alert).toHaveText("Font storage is full.");
    await expect(input).toHaveValue("");
    await page.unroute(/\/api\/v1\/media\/upload(?:-session)?(?:\?|$)/);
    await input.setInputFiles(fontPath);
    await expect(page.getByText("Recovery Geist", { exact: true })).toBeVisible();
    await expect(alert).toHaveCount(0);
    await page.getByRole("button", { name: "Save brand kit", exact: true }).click();
    await expect(page.getByText("Brand kit saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Recovery Geist", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("youtube branding", () => {
  test(`YouTube attribution fits 1440px in light`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const auth = await registerUser(request, `youtube-brand-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Brand review");
    const media = await uploadImageFixture(
      request,
      auth.token,
      workspace.id,
      "logo.png",
      await readFile(join(fixtureDirectory, rasterFixtureFiles["openpost-logo"])),
    );
    await prepareProductPage({
      page,
      request,
      auth,
      workspace,
      backgroundMediaID: media,
      logoMediaID: media,
      scheme: "light",
    });
    await page.goto("/accounts");
    await page.getByTestId("provider-search").fill("YouTube");
    await expect(page.getByTestId("provider-list").locator("li")).toHaveCount(1);
    const card = page.getByTestId("provider-card-youtube");
    await expect(card.getByRole("link", { name: "YouTube", exact: true })).toBeVisible();
    const geometry = await card.locator("svg").evaluate((svg) => {
      const mark = svg.querySelector("path")! as SVGGraphicsElement;
      const matrix = (svg as SVGGraphicsElement).getScreenCTM()!;
      const triangle = (svg.querySelectorAll("path")[1] as SVGGraphicsElement).getBBox();
      const markBox = mark.getBBox();
      const viewBox = (svg as SVGSVGElement).viewBox.baseVal;
      const box = svg.getBoundingClientRect();
      const cardBox = svg.closest('[data-testid="provider-card-youtube"]')!.getBoundingClientRect();
      return {
        paintedHeight: markBox.height * matrix.d,
        aspectRatio: box.width / box.height,
        canonicalAspectRatio: viewBox.width / viewBox.height,
        clearSpace: [
          markBox.x,
          markBox.y,
          viewBox.width - markBox.x - markBox.width,
          viewBox.height - markBox.y - markBox.height,
        ],
        triangleWidth: triangle.width,
        triangleColor: getComputedStyle(svg.querySelectorAll("path")[1]).fill,
        right: box.right,
        left: box.left,
        top: box.top,
        bottom: box.bottom,
        cardLeft: cardBox.left,
        cardRight: cardBox.right,
        cardTop: cardBox.top,
        cardBottom: cardBox.bottom,
        color: getComputedStyle(mark).fill,
      };
    });
    expect(geometry.cardBottom - geometry.cardTop).toBeLessThanOrEqual(112);
    expect(geometry.paintedHeight).toBeGreaterThanOrEqual(20);
    expect(geometry.paintedHeight).toBeLessThanOrEqual(28);
    expect(geometry.aspectRatio).toBeCloseTo(geometry.canonicalAspectRatio, 2);
    for (const margin of geometry.clearSpace) {
      expect(margin).toBeGreaterThanOrEqual(geometry.triangleWidth - 0.01);
    }
    expect(geometry.triangleColor).toBe("rgb(255, 255, 255)");
    expect(geometry.right).toBeLessThanOrEqual(1440);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.cardLeft);
    expect(geometry.right).toBeLessThanOrEqual(geometry.cardRight);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.cardTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.cardBottom);
    expect(geometry.color).toBe("rgb(255, 0, 51)");
    const title = card.getByRole("heading", { name: "YouTube", exact: true });
    const action = card.getByRole("button");
    await expect(title).toBeVisible();
    await expect(action).toBeVisible();
    const titleBox = (await title.boundingBox())!;
    const actionBox = (await action.boundingBox())!;
    expect(titleBox.width).toBeGreaterThanOrEqual(48);
    expect(titleBox.x).toBeGreaterThanOrEqual(geometry.right);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actionBox.x);
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(geometry.cardRight);
    expect(
      Math.abs((geometry.top + geometry.bottom) / 2 - (actionBox.y + actionBox.height / 2)),
    ).toBeLessThanOrEqual(1);
    await expect(page.getByText("YouTube", { exact: true }).first()).toBeVisible();
    const accountActions = page
      .getByTestId("account-card-account-youtube")
      .getByRole("button", { name: /^Actions for / });
    await accountActions.click();
    await expect(
      page.getByRole("menuitem", { name: "Account details", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountActions).toBeFocused();
    await page.goto("/");
    await expect(
      page.locator("#composer-destination-account-youtube [data-slot=social-account-platform]"),
    ).toBeVisible();
    await expect(
      page.locator("#composer-destination-account-youtube [data-slot=social-account-platform]"),
    ).toHaveText("· YouTube");
  });
});

test.describe("post imports", () => {
  test.use({ hasTouch: true });

  // A connected account and a stored external post keep this acceptance flow
  // independent of real provider credentials. Setting changes use the real API.
  test("account details expose new-provider imports and keep X disabled", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(request, `post-imports-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Imports acceptance");
    const accountID = randomUUID();
    const xID = randomUUID();
    const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
    const sql = (statement: string) =>
      execFileSync("sqlite3", ["-cmd", ".timeout 5000", database, statement]);
    sql(`INSERT INTO social_accounts (id, workspace_id, slug, platform, account_id, account_username, access_token_encrypted, granted_scopes, is_active, created_at)
      VALUES ('${accountID}', '${workspace.id}', 'threads-imports', 'threads', '42', 'imports-owner', X'00', 'threads_basic', 1, datetime('now')),
      ('${xID}', '${workspace.id}', 'x-imports', 'x', '43', 'x-owner', X'00', '', 1, datetime('now'));`);
    await authenticatePage(page, token);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/settings?tab=accounts");
    const openDetails = async (id: string) => {
      await page.getByTestId(`account-card-${id}`).getByRole("button").click();
      await page.getByRole("menuitem", { name: "Account details", exact: true }).click();
    };
    await openDetails(accountID);
    const drawer = page.getByTestId("account-settings-drawer");
    const imports = drawer.getByRole("region", { name: "Imported posts" });
    await expect(imports).toBeVisible();
    const enable = imports.getByRole("button", { name: "Turn on", exact: true });
    await expect(enable).toBeEnabled();
    await enable.focus();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/${accountID}/post-imports`),
    );
    await page.keyboard.press("Enter");
    expect((await saved).status()).toBe(200);
    await expect(imports.getByRole("button", { name: "Turn off", exact: true })).toBeEnabled();
    sql(`INSERT INTO imported_posts (id, workspace_id, social_account_id, platform, provider_post_id, title, text, external_url, published_at, origin, first_seen_at, last_seen_at, created_at, updated_at)
      VALUES ('${randomUUID()}', '${workspace.id}', '${accountID}', 'threads', 'native-new', '', 'A launch written directly on Threads.', 'https://www.threads.net/@imports-owner/post/native-new', datetime('now'), 'external', datetime('now'), datetime('now'), datetime('now'), datetime('now'));`);
    await page.keyboard.press("Escape");
    await page.reload();
    await openDetails(accountID);
    await expect(
      imports.getByRole("link", { name: "A launch written directly on Threads." }),
    ).toBeVisible();
    await imports.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeEnabled();
    await expect(
      imports.getByRole("link", { name: "A launch written directly on Threads." }),
    ).toBeVisible();
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await openDetails(accountID);
    await expect(
      imports.getByRole("link", { name: "A launch written directly on Threads." }),
    ).toBeVisible();
    await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const toggle = imports.getByRole("button", { name: "Turn on", exact: true });
    const bounds = await toggle.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("Escape");
    await openDetails(xID);
    await expect(
      imports.getByText("X imports are disabled by the provider read-cost policy."),
    ).toBeVisible();
    await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  });
});

test.describe("queue reminders", () => {
  test("an editor can configure queue reminder emails on desktop and phone", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300));
    });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

    const { token } = await registerUser(request, "queue-reminders@example.com");
    const workspace = await createWorkspace(request, token, "Queue reminders");
    await authenticatePage(page, token);
    await page.goto("/settings?tab=notifications");

    const section = page.getByRole("region", { name: "Queue reminders" });
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(
      section.getByText("Reminders start after this Workspace queues its first post."),
    ).toBeVisible();
    await section.getByRole("checkbox", { name: "Low queue runway" }).check();
    await section.getByRole("checkbox", { name: "Queue emptied" }).check();
    await section.getByRole("spinbutton", { name: "Days of runway" }).fill("14");
    await section.getByRole("button", { name: "Save queue reminders" }).click();
    await expect(page.getByText("Queue reminders saved.")).toBeVisible();

    const saved = await request.get(`/api/v1/notifications/queue-reminders/${workspace.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(saved.ok()).toBeTruthy();
    await expect(saved.json()).resolves.toMatchObject({
      low_runway_enabled: true,
      queue_emptied_enabled: true,
      runway_days: 14,
    });

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(section).toBeVisible();
      await section.scrollIntoViewIfNeeded();
      const overflow = await section.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 1,
      );
      expect(overflow, `${viewport.width}px queue reminder section overflows`).toBe(false);
    }

    await expectNoSeriousAccessibilityViolations(page);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
