import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { authenticatePage, registerUser, createWorkspace } from "./helpers";

test.describe("touch editor discovery", () => {
  test.use({ hasTouch: true });

  test("tool variants stay tappable and compact commands edit the selected layer", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/image-editor");
    await page.getByRole("button", { name: "How-to carousel", exact: true }).click();
    const layers = page.getByRole("tree", { name: "Layers", exact: true }).getByRole("treeitem");
    await expect(layers).toHaveCount(6);
    const family = page.getByTestId("image-editor-tool-family").first();
    for (const control of await family.getByRole("button").all()) {
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    const variants = family.getByRole("button", {
      name: "Rectangle select, More actions",
      exact: true,
    });
    await variants.focus();
    await variants.press("Enter");
    await page.getByRole("menuitem", { name: /Ellipse select/ }).click();
    await expect(
      family.getByRole("button", { name: "Ellipse select", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Select objects", exact: true }).click();
    await family.getByRole("button", { name: "Ellipse select", exact: true }).click();
    await expect(
      family.getByRole("button", { name: "Ellipse select", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.setViewportSize({ width: 320, height: 780 });
    const more = page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true });
    await more.click();
    await expect
      .poll(async () => (await page.getByRole("menu").boundingBox())!.width)
      .toBeGreaterThanOrEqual(264);
    await page.getByRole("menuitem", { name: /^Duplicate/ }).click();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(layers).toHaveCount(7);
    await page.setViewportSize({ width: 320, height: 780 });
    await more.click();
    await page.getByRole("menuitem", { name: /^Undo/ }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.screenshot({ path: testInfo.outputPath("photo-touch-320.png") });
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(layers).toHaveCount(6);
  });
});

test("signed-in creators can use built-in templates in their workspace", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `image-template-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Image workspace");
  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page.getByText("Custom size", { exact: true }).first().click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toBeVisible();
  await page.getByRole("button", { name: "Create custom design" }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
});

test("starter previews fit the complete canvas on narrow phones", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/image-editor");
  const gallery = page.getByRole("region", { name: "Starter templates" });
  await expect(gallery.locator("canvas").first()).toBeVisible();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect
        .poll(() =>
          gallery.locator("canvas").evaluateAll((canvases) =>
            canvases.every((canvas) => {
              const frame = canvas.parentElement!.getBoundingClientRect();
              const bitmap = canvas.getBoundingClientRect();
              return bitmap.width <= frame.width + 1 && bitmap.height <= frame.height + 1;
            }),
          ),
        )
        .toBe(true);
      await gallery.screenshot({
        path: testInfo.outputPath(`templates-${width}-${colorScheme}.png`),
      });
    }
  }
  const starter = gallery.getByRole("button", { name: "Quick announcement" });
  await starter.focus();
  await expect(starter).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
});

// A public visitor can create a design, keep working across a reload, and
// export it without an account and without any server write. If local
// persistence breaks, edits silently vanish; if the public boundary leaks,
// anonymous work hits the API.
test("public image editor creates, restores, and exports a local design", async ({ page }) => {
  test.setTimeout(60_000);
  const browserErrors: string[] = [];
  const workspaceWrites: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/v1/image-editor/designs")) {
      workspaceWrites.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto("/image-editor");
  await expect(page.getByRole("heading", { name: "Image Editor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Instagram square/ }).click();

  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await page.waitForTimeout(500);
  expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
    timeout: 20_000,
  });

  const title = page.getByRole("textbox", { name: "Design title" });
  await title.fill("Local launch design");
  const saveIndicator = page.getByTestId("image-editor-save-indicator");
  await expect(saveIndicator).toBeVisible();
  await expect(saveIndicator).toHaveAttribute("data-state", "saved");
  await expect(saveIndicator).toContainText("Saved on this device");

  await page.reload();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(title).toHaveValue("Local launch design");

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("heading", { name: "Export design" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  await download;
  await expect(
    page.getByLabel("Notifications alt+T").getByText("Export downloaded."),
  ).toBeVisible();

  const home = page
    .getByRole("banner")
    .getByRole("button", { name: "OpenPost Image Editor", exact: true });
  await home.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/image-editor$/);
  await expect(page.getByText("Local launch design", { exact: true })).toBeVisible();

  expect(workspaceWrites).toEqual([]);
  expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
});

test("page-strip previews render after adding a page and remain visible across a page switch", async ({
  page,
}, testInfo) => {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  // Expanding pages uses the reserved strip so thumbnails do not cover the artwork.
  await page.getByRole("button", { name: "Expand pages" }).click();
  await page.getByRole("button", { name: "Add page" }).click();

  const strip = page.getByTestId("image-editor-page-strip");
  await expect(strip.getByRole("button", { name: /Page 1:/ })).toBeVisible();
  const previews = strip.locator(".template-preview-frame img");
  await expect(previews).toHaveCount(2);
  await expect
    .poll(async () =>
      previews.evaluateAll((images) =>
        images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("image-editor-pages-desktop.png"),
  });

  await page
    .getByRole("button", { name: /Page 1/ })
    .last()
    .click();
  await expect(previews).toHaveCount(2);
  await expect
    .poll(async () =>
      previews.evaluateAll((images) =>
        images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
      ),
    )
    .toBe(true);

  const colorSchemes: Array<"light" | "dark"> = ["light", "dark"];
  for (const width of [390, 320]) {
    for (const colorScheme of colorSchemes) {
      await page.setViewportSize({ width, height: 780 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const expandPages = page.getByRole("button", { name: "Expand pages" });
      if (await expandPages.count()) await expandPages.click();
      await expect(previews).toHaveCount(2);
      await expect
        .poll(async () =>
          previews.evaluateAll((images) =>
            images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
          ),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`image-editor-pages-${width}-${colorScheme}.png`),
      });
    }
  }
});

test("a large rectangular selection keeps its visible outline after a document edit", async ({
  page,
}) => {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Rectangle select" }).first().click();
  const overlay = page.getByTestId("image-editor-pixel-selection");
  const bounds = await overlay.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + bounds.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.8, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(overlay).toHaveAttribute("data-active", "true");
  const outlinePixels = await overlay.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return 0;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    let visible = 0;
    for (let index = 3; index < image.data.length; index += 4) if (image.data[index]) visible++;
    return visible;
  });
  expect(outlinePixels).toBeGreaterThan(100);
  await page.getByRole("textbox", { name: "Design title" }).fill("Selection outline check");
  await expect(overlay).toHaveAttribute("data-active", "true");
  const afterEditPixels = await overlay.evaluate((canvas: HTMLCanvasElement) => {
    const image = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height);
    if (!image) return 0;
    let visible = 0;
    for (let index = 3; index < image.data.length; index += 4) if (image.data[index]) visible++;
    return visible;
  });
  expect(afterEditPixels).toBe(outlinePixels);
});
