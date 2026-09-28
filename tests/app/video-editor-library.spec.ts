import { expect, test, type Page } from "@playwright/test";

async function installLocalWorkspacePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        if (!("queryPermission" in prototype)) {
          Object.defineProperty(prototype, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (!("requestPermission" in prototype)) {
          Object.defineProperty(prototype, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
}

test.describe("touch timer library", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("keeps favorite controls reachable on a small screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await createProject(page, "Touch timer library");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    await page.getByRole("tab", { name: "Timers", exact: true }).click();
    const ringCard = page.getByRole("button", { name: "Ring", exact: true }).last();
    const cardBounds = await ringCard.boundingBox();
    const previewBounds = await ringCard.locator("canvas").boundingBox();
    expect(previewBounds!.y).toBeGreaterThanOrEqual(cardBounds!.y);
    expect(previewBounds!.y + previewBounds!.height).toBeLessThanOrEqual(
      cardBounds!.y + cardBounds!.height,
    );
    const favorite = page.getByRole("button", { name: "Favorite Ring", exact: true });
    await favorite.scrollIntoViewIfNeeded();
    const bounds = await favorite.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    const cardAfterScroll = await ringCard.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      cardAfterScroll!.y + cardAfterScroll!.height,
    );
    await favorite.tap();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "Library", exact: true }).click();
    await expect(page.getByRole("button", { name: "Ring", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

async function createProject(
  page: Page,
  name: string,
  options: { selectLocalProjects?: boolean } = {},
): Promise<void> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  if (options.selectLocalProjects) {
    await page.getByRole("button", { name: "Local only" }).click();
  }
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Custom project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`saved timers, repeat, chapters and frame handoff in ${scheme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.setViewportSize({ width: 1280, height: 800 });
    await createProject(page, "Reusable timer workflow");
    const projectURL = page.url();
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Timers", exact: true }).click();
    const ringCard = page.getByRole("button", { name: "Ring", exact: true });
    const cardBounds = await ringCard.boundingBox();
    const previewBounds = await ringCard.locator("canvas").boundingBox();
    expect(previewBounds!.y).toBeGreaterThanOrEqual(cardBounds!.y);
    expect(previewBounds!.y + previewBounds!.height).toBeLessThanOrEqual(
      cardBounds!.y + cardBounds!.height,
    );
    const favoriteRing = page.getByRole("button", { name: "Favorite Ring", exact: true });
    await favoriteRing.focus();
    await favoriteRing.press("Enter");
    await expect(favoriteRing).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: testInfo.outputPath(`timers-${scheme}.png`) });
    await page.getByRole("button", { name: "Ring", exact: true }).first().click();
    const duration = page.getByRole("spinbutton", {
      name: "Duration (seconds)",
      exact: true,
    });
    await duration.fill("45");
    await duration.press("Tab");
    await expect(duration).toHaveValue("45");
    await page
      .getByRole("region", { name: "Text", exact: true })
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    const thickness = page.getByRole("spinbutton", { name: "Thickness (%)", exact: true });
    const segments = page.getByRole("spinbutton", { name: "Segments", exact: true });
    await thickness.fill("12");
    await thickness.press("Tab");
    await segments.fill("8");
    await segments.press("Tab");
    await expect(thickness).toHaveValue("12");
    await page.getByRole("textbox", { name: "Finish text", exact: true }).fill("GO");
    await page.getByRole("textbox", { name: "Finish text", exact: true }).press("Tab");
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Save selection to library", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("My rest timer");
    await page
      .getByRole("textbox", { name: "Collection, optional", exact: true })
      .fill("Tutorials");
    await page.locator("form button[type=submit]").click();
    await expect(
      page.getByRole("button", { name: "My rest timer", exact: true }).first(),
    ).toBeVisible();
    await page.getByText("Repeat selection", { exact: true }).first().click();
    await page.getByRole("button", { name: "Repeat selection", exact: true }).click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(3);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await expect
      .poll(() =>
        page.locator("#video-editor-program-panel canvas").evaluateAll((canvases) =>
          canvases.some((element) => {
            const canvas = element as HTMLCanvasElement;
            const context = canvas.getContext("2d");
            if (!context || !canvas.width) return false;
            const pixels = context.getImageData(
              Math.floor(canvas.width * 0.4),
              Math.floor(canvas.height * 0.4),
              Math.max(1, Math.floor(canvas.width * 0.2)),
              Math.max(1, Math.floor(canvas.height * 0.2)),
            ).data;
            return pixels.some(
              (value, index) =>
                index % 4 === 0 &&
                value > 250 &&
                pixels[index + 1]! > 250 &&
                pixels[index + 2]! > 250 &&
                pixels[index + 3]! > 250,
            );
          }),
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`library-desktop-${scheme}.png`),
    });
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Save", exact: true }).click();
    await expect(page.getByRole("banner").getByRole("status")).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Library", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "My rest timer", exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "My rest timer", exact: true }).first().click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(2);
    await expect(duration).toHaveValue("45");
    await page
      .getByRole("region", { name: "Text", exact: true })
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await expect(thickness).toHaveValue("12");
    await expect(segments).toHaveValue("8");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("button", { name: "Assets", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "My rest timer", exact: true }).first(),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page
        .getByRole("button", { name: "My rest timer", exact: true })
        .first()
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`library-${width}-${scheme}.png`),
      });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "Add marker", exact: true }).click();
    await page.getByRole("textbox", { name: "Label", exact: true }).fill("Warm up");
    await page.getByRole("textbox", { name: "Label", exact: true }).press("Enter");
    await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Export video",
      exact: true,
    });
    await dialog.locator("summary").filter({ hasText: "Chapters" }).click();
    await expect(dialog.getByRole("textbox", { name: "Chapters", exact: true })).toHaveValue(
      "00:00 Warm up",
    );
    await dialog.getByRole("textbox", { name: "Chapters", exact: true }).fill("00:00 Introduction");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await dialog.getByRole("button", { name: "Copy chapters", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("00:00 Introduction");
    await page.screenshot({
      path: testInfo.outputPath(`chapters-${scheme}.png`),
    });
    await page.keyboard.press("Escape");
    await page
      .locator("#video-editor-program-panel")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", {
        name: "Open current frame in Image Editor",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/image-editor\//u, { timeout: 30_000 });
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(
        () =>
          page
            .locator("canvas.lower-canvas")
            .first()
            .evaluate((element) => {
              const canvas = element as HTMLCanvasElement;
              const data = canvas
                .getContext("2d")!
                .getImageData(0, 0, canvas.width, canvas.height).data;
              let white = 0;
              for (let index = 0; index < data.length; index += 4)
                if (
                  data[index]! > 250 &&
                  data[index + 1]! > 250 &&
                  data[index + 2]! > 250 &&
                  data[index + 3]! > 250
                )
                  white++;
              return white;
            }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(100);
    await page.screenshot({
      path: testInfo.outputPath(`frame-image-editor-${scheme}.png`),
    });
    await page.goto(projectURL);
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

for (const style of ["Bomb", "Tomato"] as const) {
  test(`sculpted ${style} appearance controls`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await createProject(page, `${style} timer`);
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Timers", exact: true }).click();
    await page.getByRole("button", { name: style, exact: true }).click();
    await page
      .getByRole("region", { name: "Text", exact: true })
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", { name: "Completion effect", exact: true }),
    ).toBeChecked();
    await page.getByRole("checkbox", { name: "Show numbers", exact: true }).uncheck();
    await page.screenshot({ path: testInfo.outputPath(`${style}-artwork.png`) });
    await page.getByRole("checkbox", { name: "Show numbers", exact: true }).check();
    await page.screenshot({ path: testInfo.outputPath(`${style}-timer.png`) });
    const bodyColor = page.getByRole("button", { name: "Body color", exact: true });
    await bodyColor.click();
    const hex = page.getByRole("textbox", { name: "Hex color", exact: true });
    await hex.fill("#2855FF");
    await hex.press("Enter");
    await page.keyboard.press("Escape");
    await expect(bodyColor).toHaveAttribute("title", "Body color: #2855FF");
    await page.screenshot({ path: testInfo.outputPath(`${style}-custom-color.png`) });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await bodyColor.scrollIntoViewIfNeeded();
      await expect(bodyColor).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: testInfo.outputPath(`${style}-appearance-${width}.png`) });
    }
  });
}
