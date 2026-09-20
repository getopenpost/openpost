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
    expect(await family.evaluate((element) => element.tagName)).toBe("BUTTON");
    const bounds = (await family.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBe(bounds.height);
    await family.focus();
    await family.press("ArrowDown");
    await page.getByRole("menuitem", { name: /Ellipse select/ }).click();
    await expect(family).toHaveAttribute("aria-label", "Ellipse select");
    await expect(family).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Select objects", exact: true }).click();
    await family.click();
    await expect(family).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await family.click();
    await expect(page.getByRole("menuitem", { name: /Ellipse select/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(family).toBeFocused();

    await page.setViewportSize({ width: 320, height: 780 });
    const propertiesLabel = page
      .getByRole("navigation", {
        name: "OpenPost Image Editor tools",
        exact: true,
      })
      .getByRole("button", { name: "Properties", exact: true })
      .locator("span");
    expect(
      await propertiesLabel.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
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

test("desktop Image Editor uses the compact rail and closes Add when another tool is chosen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();

  const tools = page.getByRole("navigation", {
    name: "OpenPost Image Editor tools",
    exact: true,
  });
  await expect(tools).toBeVisible();
  await expect.poll(async () => (await tools.boundingBox())?.width).toBe(44);

  const add = tools.getByRole("button", { name: "Add", exact: true });
  await add.click();
  await expect(add).toHaveAttribute("aria-pressed", "true");

  const select = tools.getByRole("button", {
    name: "Select objects",
    exact: true,
  });
  await select.click();
  await expect(add).toHaveAttribute("aria-pressed", "false");
  await expect(select).toBeFocused();
});

test("guest camera capture adds a local image without workspace writes", async ({ page }) => {
  const workspaceWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      (request.url().includes("/api/v1/media") ||
        request.url().includes("/api/v1/image-editor/designs"))
    ) {
      workspaceWrites.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [],
        getUserMedia: async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 240;
          const context = canvas.getContext("2d")!;
          context.fillStyle = "#12a2c5";
          context.fillRect(0, 0, canvas.width, canvas.height);
          return canvas.captureStream(5);
        },
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();

  await page
    .getByRole("navigation", {
      name: "OpenPost Image Editor tools",
      exact: true,
    })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  const sources = page.getByRole("toolbar", { name: "Source", exact: true });
  await expect(sources.getByRole("button", { name: "Device", exact: true })).toBeVisible();
  await expect(sources.getByRole("button", { name: "Stock media", exact: true })).toBeVisible();
  await expect(sources.getByRole("button", { name: "Camera", exact: true })).toBeVisible();
  await expect(sources.getByRole("button", { name: "Workspace", exact: true })).toHaveCount(0);

  await sources.getByRole("button", { name: "Camera", exact: true }).click();
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await page.getByRole("button", { name: "Use photo", exact: true }).click();

  const layers = page.getByRole("tree", { name: "Layers", exact: true }).getByRole("treeitem");
  await expect(layers).toHaveCount(1);
  await expect(layers.first()).toContainText("camera-");
  await expect(page.getByRole("status")).toContainText("Added camera-");
  expect(workspaceWrites).toEqual([]);
});

test("Image Editor keeps Export as the rightmost visible header action", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();

  const header = page.getByRole("banner");
  const exportButton = header.getByRole("button", {
    name: "Export",
    exact: true,
  });
  const exportBox = await exportButton.boundingBox();
  expect(exportBox).not.toBeNull();

  for (const button of [
    header.getByRole("button", { name: "More actions", exact: true }),
    header.getByRole("button", { name: "Save to OpenPost", exact: true }),
  ]) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    if (box) expect(exportBox!.x).toBeGreaterThan(box.x);
  }
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

for (const scheme of ["light", "dark"] as const) {
  test(`Photo keeps text editing first and Color preserves the live canvas on phones in ${scheme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/image-editor");
    await page.getByRole("button", { name: "Bold announcement", exact: true }).click();
    const properties = page.locator(".image-editor-properties-scroll:visible");
    await expect(properties.locator("textarea")).toBeInViewport({ ratio: 1 });
    await expect(
      properties.getByRole("button", { name: "Font family", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(properties.getByRole("spinbutton", { name: "Size", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(properties.getByRole("button", { name: "Weight", exact: true })).toHaveText("850");
    await page.screenshot({
      path: testInfo.outputPath("photo-text-laptop.png"),
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("button", { name: "Draw", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Foreground color", exact: true }),
      ).toBeVisible();
      await page.locator("#image-editor-workspace-tab-color").click();
      await expect(
        page.getByRole("button", { name: "Foreground color", exact: true }),
      ).toBeHidden();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const canvas = page.getByRole("application", {
        name: "Design canvas",
        exact: true,
      });
      const color = page.locator("[data-image-color-workspace]:visible");
      await expect(canvas).toBeInViewport({ ratio: 1 });
      const canvasBox = (await canvas.boundingBox())!;
      const controlsBox = (await color.boundingBox())!;
      expect(canvasBox.height).toBeGreaterThanOrEqual(180);
      expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(controlsBox.y + 1);
      const advanced = color.getByRole("button", { name: "Advanced", exact: true });
      if ((await advanced.getAttribute("aria-expanded")) !== "true") await advanced.click();
      const lift = page.getByRole("slider", { name: "Lift color wheel", exact: true });
      await lift.scrollIntoViewIfNeeded();
      await expect(lift).toBeInViewport({ ratio: 1 });
      await lift.press("ArrowUp");
      const previousLift = await lift.getAttribute("aria-valuetext");
      await lift.press("ArrowRight");
      await expect(lift).not.toHaveAttribute("aria-valuetext", previousLift!);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`photo-color-${width}.png`),
      });
      await page.locator("#image-editor-workspace-tab-edit").click();
    }
  });
}
