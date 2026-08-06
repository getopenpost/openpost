import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const tinyPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("legacy Studio URLs redirect to the OpenPost Image Editor", async ({
  page,
}) => {
  await page.goto("/studio/new?legacy-route=1");
  await expect(page).toHaveURL(/\/image-editor\/new\?legacy-route=1$/);
});

test("public OpenPost Image Editor creates and restores a local design without authentication", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const browserErrors: string[] = [];
  const workspaceWrites: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.url().includes("/api/v1/image-editor/designs")
    ) {
      workspaceWrites.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.addInitScript(() => {
    const events = JSON.parse(
      sessionStorage.getItem("public-image-editor-test-events") || "[]",
    ) as string[];
    Object.defineProperty(window, "__publicImageEditorEvents", {
      value: events,
      configurable: true,
    });
    window.addEventListener("openpost:public-image-editor-event", (event) => {
      events.push((event as CustomEvent<{ name: string }>).detail.name);
      sessionStorage.setItem(
        "public-image-editor-test-events",
        JSON.stringify(events),
      );
    });
  });

  await page.goto("/image-editor");
  await expect(
    page.getByRole("heading", { name: "Free social media image editor" }),
  ).toBeVisible();
  await expect(page.getByText("No account or watermark.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /Instagram square/ }).click();

  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await expect(
    page.getByRole("application", { name: "Design canvas" }),
  ).toBeVisible();
  const designCanvas = page.getByRole("application", {
    name: "Design canvas",
  });
  const stage = page.getByTestId("image-editor-stage");
  const [canvasBox, stageBeforeZoom] = await Promise.all([
    designCanvas.boundingBox(),
    stage.boundingBox(),
  ]);
  if (!canvasBox || !stageBeforeZoom) {
    throw new Error(
      "Public OpenPost Image Editor canvas did not produce measurable bounds",
    );
  }
  const zoomAnchor = {
    x: stageBeforeZoom.x + stageBeforeZoom.width * 0.3,
    y: stageBeforeZoom.y + stageBeforeZoom.height * 0.35,
  };
  await designCanvas.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: zoomAnchor.x,
    clientY: zoomAnchor.y,
    ctrlKey: true,
    deltaY: -100,
  });
  await expect
    .poll(async () => (await stage.boundingBox())?.width ?? 0)
    .toBeGreaterThan(stageBeforeZoom.width);
  const stageAfterZoom = await stage.boundingBox();
  if (!stageAfterZoom) {
    throw new Error(
      "Public OpenPost Image Editor canvas disappeared after zooming",
    );
  }
  expect(stageAfterZoom.width).toBeGreaterThan(stageBeforeZoom.width);
  expect(stageAfterZoom.width / stageBeforeZoom.width).toBeLessThan(1.08);
  expect((zoomAnchor.x - stageAfterZoom.x) / stageAfterZoom.width).toBeCloseTo(
    (zoomAnchor.x - stageBeforeZoom.x) / stageBeforeZoom.width,
    3,
  );
  expect((zoomAnchor.y - stageAfterZoom.y) / stageAfterZoom.height).toBeCloseTo(
    (zoomAnchor.y - stageBeforeZoom.y) / stageBeforeZoom.height,
    3,
  );

  const zoomControl = page.getByRole("button", { name: /^Zoom \d+%$/ });
  const zoomLabelBefore = await zoomControl.getAttribute("aria-label");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomControl).not.toHaveAttribute(
    "aria-label",
    zoomLabelBefore ?? "",
  );

  await zoomControl.click();
  const fittedStage = await stage.boundingBox();
  if (!fittedStage) {
    throw new Error(
      "Public OpenPost Image Editor canvas did not fit on demand",
    );
  }
  expect(fittedStage.width).toBeLessThanOrEqual(canvasBox.width);
  expect(fittedStage.height).toBeLessThanOrEqual(canvasBox.height);

  await designCanvas.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: zoomAnchor.x,
    clientY: zoomAnchor.y,
    deltaX: 28,
    deltaY: 18,
  });
  await expect
    .poll(async () => (await stage.boundingBox())?.x ?? 0)
    .toBeCloseTo(fittedStage.x - 28, 0);
  await expect
    .poll(async () => (await stage.boundingBox())?.y ?? 0)
    .toBeCloseTo(fittedStage.y - 18, 0);
  await zoomControl.click();

  await page.keyboard.press("t");
  await expect(
    page.getByRole("treeitem", { name: /New text, text/ }),
  ).toBeVisible();
  await expect(page.locator("textarea").last()).toHaveValue("New text");
  await page.keyboard.press("Escape");

  const imageEditorMenus = page.getByRole("menubar", {
    name: "OpenPost Image Editor menus",
  });
  await expect(imageEditorMenus).toBeVisible();
  await imageEditorMenus.getByText("File", { exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: /Save.*(?:Ctrl|⌘) S/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Add shape" }).click({
    button: "right",
  });
  const shapeMenu = page.locator("[data-context-menu-content]");
  await expect(shapeMenu.getByText("Rounded", { exact: true })).toBeVisible();
  const shapeMenuBox = await shapeMenu.boundingBox();
  if (!shapeMenuBox)
    throw new Error("OpenPost Image Editor shape menu did not render");
  expect(shapeMenuBox.width).toBeLessThanOrEqual(192);
  expect(shapeMenuBox.height).toBeLessThanOrEqual(152);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Add shape" }).click();
  const rectangleLayer = page.getByRole("treeitem", {
    name: /Rectangle, shape/,
  });
  await expect(rectangleLayer).toBeVisible();
  await page.keyboard.press("v");
  await page.mouse.click(canvasBox.x + 8, canvasBox.y + canvasBox.height / 2);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(0);
  const objectSelectionStart = {
    x: (canvasBox.x + fittedStage.x) / 2,
    y: fittedStage.y + fittedStage.height * 0.1,
  };
  const objectSelectionEnd = {
    x: (fittedStage.x + fittedStage.width + canvasBox.x + canvasBox.width) / 2,
    y: fittedStage.y + fittedStage.height * 0.9,
  };
  await page.mouse.move(objectSelectionStart.x, objectSelectionStart.y);
  await page.mouse.down();
  await page.mouse.move(objectSelectionEnd.x, objectSelectionEnd.y, {
    steps: 8,
  });
  await expect(
    page.getByTestId("image-editor-object-selection-outline"),
  ).toBeVisible();
  await page.mouse.up();
  await expect(rectangleLayer).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("m");
  await expect(
    page.getByRole("button", { name: "Rectangle select", pressed: true }),
  ).toBeVisible();
  const outsideSelectionStart = {
    x: (canvasBox.x + fittedStage.x) / 2,
    y: fittedStage.y + fittedStage.height * 0.25,
  };
  const outsideSelectionEnd = {
    x: (fittedStage.x + fittedStage.width + canvasBox.x + canvasBox.width) / 2,
    y: fittedStage.y + fittedStage.height * 0.75,
  };
  expect(outsideSelectionStart.x).toBeLessThan(fittedStage.x);
  expect(outsideSelectionEnd.x).toBeGreaterThan(
    fittedStage.x + fittedStage.width,
  );
  await page.mouse.move(outsideSelectionStart.x, outsideSelectionStart.y);
  await page.mouse.down();
  await page.mouse.move(outsideSelectionEnd.x, outsideSelectionEnd.y, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(
    page.getByTestId("image-editor-pixel-selection"),
  ).toHaveAttribute("data-active", "true");
  await page
    .getByTestId("image-editor-selection-options")
    .getByRole("button", { name: "Deselect" })
    .click();

  const layersTree = page.getByRole("tree", { name: "Layers" });
  await layersTree.getByRole("button", { name: "Add layer" }).click();
  const emptyLayer = layersTree.getByRole("treeitem", {
    name: /Layer 1, paint/,
  });
  await expect(emptyLayer).toBeVisible();
  await emptyLayer.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename layer" }).click();
  const layerName = layersTree.getByRole("textbox", { name: "Layer name" });
  await expect(layerName).toBeFocused();
  await layerName.fill("Sketches");
  await layerName.press("Enter");
  await expect(
    layersTree.getByRole("treeitem", { name: /Sketches, paint/ }),
  ).toBeVisible();

  const title = page.getByRole("textbox", { name: "Design title" });
  await title.fill("Local launch design");
  await expect(
    page.getByRole("banner").getByText("Saved on this device"),
  ).toBeVisible();

  await page.reload();
  await expect(title).toHaveValue("Local launch design");
  const localDesignURL = page.url();
  await title.fill("Latest conversion edit");
  await page.getByRole("button", { name: "Save to OpenPost" }).click();
  await expect(page).toHaveURL(/\/register\?redirect=/);
  await page.goto(localDesignURL);
  await expect(title).toHaveValue("Latest conversion edit");

  await page.getByRole("button", { name: "Export" }).click();
  await expect(
    page.getByRole("heading", { name: "Export design" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  await download;
  await expect(
    page.getByLabel("Notifications alt+T").getByText("Export downloaded."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Export complete" }),
  ).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const trackedEvents = await page.evaluate(
    () =>
      (window as Window & { __publicImageEditorEvents?: string[] })
        .__publicImageEditorEvents ?? [],
  );
  expect(trackedEvents).toContain("image_editor_design_started");
  expect(trackedEvents).toContain("image_editor_meaningful_edit");
  expect(trackedEvents).toContain("image_editor_export_completed");
  expect(workspaceWrites).toEqual([]);
  expect(
    browserErrors.filter((message) => !message.includes("401 (Unauthorized)")),
  ).toEqual([]);
});

test("public OpenPost Image Editor imports attributed stock photos into durable local media", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  const stockPng = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fb923c";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  });
  const stockAsset = {
    external_id: "image-editor-photo-1",
    kind: "photo",
    title: "Warm desk",
    width: 320,
    height: 180,
    thumbnail_url:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%23fb923c'/%3E%3C/svg%3E",
    source_url: "https://example.test/image-editor-photo-1",
    creator_name: "OpenPost Test",
    creator_url: "https://example.test/creator",
    provider: "pexels",
    provider_url: "https://www.pexels.com",
    attribution_text: "OpenPost Test on Pexels",
    license_name: "Pexels License",
    license_url: "https://www.pexels.com/license/",
  };

  await page.route("**/api/v1/stock-media/providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        enabled: true,
        providers: [
          {
            key: "pexels",
            name: "Pexels",
            provider_url: "https://www.pexels.com",
            photos: true,
            videos: true,
            audio: false,
            attribution: "Photos provided by Pexels",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/stock-media/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        items: [stockAsset],
        page: 1,
        per_page: 24,
        total: 1,
        has_more: false,
        provider: "pexels",
        provider_url: "https://www.pexels.com",
      },
    });
  });
  await page.route("**/api/v1/stock-media/selections", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...stockAsset,
        download_url: stockPng,
        mime_type: "image/png",
      },
    });
  });

  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await page.getByRole("button", { name: "Browse stock" }).click();
  await expect(
    page.getByText(
      "Search a configured provider to find photos for your design.",
    ),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search stock photos and videos" })
    .fill("desk");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("By OpenPost Test")).toBeVisible();
  await page.getByRole("button", { name: "Use this item" }).click();

  const stockLayer = page.getByRole("treeitem", {
    name: /pexels-image-editor-photo-1\.jpg, image/,
  });
  await expect(stockLayer).toBeVisible();
  await expect(
    page.getByText("pexels-image-editor-photo-1.jpg", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByText("Saved on this device"),
  ).toBeVisible();

  await page.reload();
  await expect(stockLayer).toBeVisible();
  expect(
    browserErrors.filter((message) => !message.includes("401 (Unauthorized)")),
  ).toEqual([]);
});

test("OpenPost Image Editor creates from an original template, adapts to mobile, and exports to Media", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const unique = Date.now().toString(36);
  const email = `image-editor-${unique}@example.com`;
  const auth = await registerUser(request, email);
  const workspace = await createWorkspace(
    request,
    auth.token,
    "OpenPost Image Editor E2E",
  );

  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);

  await expect(
    page.getByRole("heading", { name: "Choose a format" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Starter templates" }),
  ).toBeVisible();
  const starterTemplates = page.getByRole("region", {
    name: "Starter templates",
  });
  await expect(starterTemplates.getByRole("button")).toHaveCount(15);
  await expect(
    starterTemplates.getByRole("button", { name: /Quiet quote/ }),
  ).toBeVisible();
  await expect(
    starterTemplates.getByRole("button", { name: /YouTube list/ }),
  ).toBeVisible();

  await page
    .getByRole("region", { name: "Starter templates" })
    .getByRole("button", { name: /Quick announcement/ })
    .click();

  await expect(page).toHaveURL(/\/image-editor\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("application", { name: "Design canvas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: /A clear update, text/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Upload files to build your media library."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Upload or camera" }).click();
  const mediaSourceDialog = page.getByRole("dialog", {
    name: "Add an image",
  });
  await expect(mediaSourceDialog).toBeVisible();
  await expect(
    mediaSourceDialog.getByRole("button", { name: "Device", exact: true }),
  ).toBeVisible();
  await expect(
    mediaSourceDialog.getByRole("button", { name: "Camera", exact: true }),
  ).toBeVisible();
  await expect(
    mediaSourceDialog.getByRole("button", { name: "Browse stock" }),
  ).toBeVisible();
  await mediaSourceDialog.locator('input[type="file"]').setInputFiles({
    name: "picker-library.png",
    mimeType: "image/png",
    buffer: tinyPNG,
  });
  await expect(mediaSourceDialog.locator('img[src^="blob:"]')).toHaveCount(1);
  await mediaSourceDialog
    .getByRole("button", { name: "Upload 1 file", exact: true })
    .click();
  await expect(mediaSourceDialog).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.getByRole("treeitem", { name: /picker-library\.png, image/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Upload or camera" }).click();
  const reopenedPicker = page.getByRole("dialog", { name: "Add an image" });
  await reopenedPicker.getByRole("button", { name: "Library" }).click();
  await expect(
    reopenedPicker.getByRole("button", { name: "Select picker-library.png" }),
  ).toBeVisible();
  await reopenedPicker.getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("Delete");
  await expect(
    page.getByRole("treeitem", { name: /picker-library\.png, image/ }),
  ).toHaveCount(0);

  const designCanvas = page.getByRole("application", {
    name: "Design canvas",
  });
  const stage = page.getByTestId("image-editor-stage");
  const [canvasBox, stageBox] = await Promise.all([
    designCanvas.boundingBox(),
    stage.boundingBox(),
  ]);
  if (!canvasBox || !stageBox) {
    throw new Error(
      "OpenPost Image Editor canvas did not produce measurable bounds",
    );
  }

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await expect(
    page.getByRole("treeitem", { name: /A clear update, text/ }),
  ).toHaveAttribute("aria-selected", "true");
  const propertiesLayerName = page.getByRole("textbox", {
    name: "Layer name",
  });
  await propertiesLayerName.fill("A clear update draft");
  await expect(
    page.getByRole("treeitem", { name: /A clear update draft, text/ }),
  ).toBeVisible();
  await propertiesLayerName.fill("A clear update");
  await propertiesLayerName.press("Enter");
  await expect(
    page.getByRole("treeitem", { name: /A clear update, text/ }),
  ).toBeVisible();
  const fontFamily = page.getByRole("button", { name: "Font family" });
  await fontFamily.click();
  for (const family of [
    "Manrope",
    "DM Sans",
    "Space Grotesk",
    "Playfair Display",
    "Source Serif 4",
  ]) {
    await expect(page.getByRole("button", { name: family })).toBeVisible();
  }
  await page.getByRole("button", { name: "Manrope" }).click();
  await expect(fontFamily).toHaveText("Manrope");
  const headlinePoint = {
    x: stageBox.x + stageBox.width * 0.35,
    y: stageBox.y + stageBox.height * 0.4,
  };
  await page.mouse.click(canvasBox.x + 8, canvasBox.y + canvasBox.height / 2);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(0);
  await page.keyboard.down("Alt");
  await page.mouse.move(headlinePoint.x, headlinePoint.y);
  await page.mouse.down();
  await page.mouse.move(headlinePoint.x + 60, headlinePoint.y + 24, {
    steps: 6,
  });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(
    page.getByRole("treeitem", { name: /A clear update copy, text/ }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("treeitem", { name: /A clear update copy, text/ }),
  ).toHaveCount(0);

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await page.mouse.click(canvasBox.x + 8, canvasBox.y + canvasBox.height / 2);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(0);

  const stagePosition = () =>
    stage.evaluate(
      (element) =>
        (element.parentElement as HTMLElement | null)?.style.transform ?? "",
    );
  const panBefore = await stagePosition();
  await page.keyboard.down("Space");
  await page.mouse.move(canvasBox.x + 12, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + 72,
    canvasBox.y + canvasBox.height / 2 + 36,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(stagePosition).not.toBe(panBefore);

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await page.getByRole("button", { name: "Transform" }).click();
  const curveSelect = page.getByRole("button", { name: "Text curve" });
  await curveSelect.click();
  await page.getByRole("option", { name: "Circle", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "H", exact: true }),
  ).toHaveValue("886");
  await curveSelect.click();
  await page.getByRole("option", { name: "Ellipse", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "H", exact: true }),
  ).toHaveValue("487");
  await curveSelect.click();
  await page.getByRole("option", { name: "Wave", exact: true }).click();
  await page.getByRole("button", { name: /^Effects(?: \d+ active)?$/ }).click();
  await page.getByRole("button", { name: "Add drop shadow" }).click();
  await expect(
    page.getByRole("button", { name: "Remove drop shadow" }),
  ).toBeVisible();
  const textSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/v1/image-editor/designs/") &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Glow" }).click();
  await textSaved;

  await page.getByRole("treeitem", { name: /Accent, shape/ }).click();
  await page.getByRole("button", { name: /^Effects(?: \d+ active)?$/ }).click();
  await page.getByRole("button", { name: "Mask" }).click();
  await page.getByRole("option", { name: "Diamond", exact: true }).click();
  await page.getByRole("button", { name: "Add border" }).click();
  await expect(
    page.getByRole("button", { name: "Remove border" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Border position" }).click();
  await page.getByRole("option", { name: "Outside", exact: true }).click();
  await page.getByRole("button", { name: "Add drop shadow" }).click();
  await expect(
    page.getByRole("button", { name: "Remove drop shadow" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add inner shadow" }).click();
  await expect(
    page.getByRole("button", { name: "Remove inner shadow" }),
  ).toBeVisible();
  const shapeSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/v1/image-editor/designs/") &&
      response.request().postData()?.includes('"blend_mode":"multiply"') ===
        true &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Blend mode" }).click();
  await page.getByRole("option", { name: "Multiply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Blend mode" })).toHaveText(
    "Multiply",
  );
  await shapeSaved;

  await page.reload();
  await page.getByRole("treeitem", { name: /Accent, shape/ }).click();
  await page.getByRole("button", { name: /^Effects(?: \d+ active)?$/ }).click();
  await expect(page.getByRole("button", { name: "Mask" })).toHaveText(
    "Diamond",
  );
  await expect(page.getByRole("button", { name: "Blend mode" })).toHaveText(
    "Multiply",
  );
  await expect(
    page.getByRole("button", { name: "Remove drop shadow" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove inner shadow" }),
  ).toBeVisible();
  await expect(page.getByTestId("image-editor-layer-border")).toContainText(
    "Border",
  );
  await expect(
    page.getByRole("button", { name: "Border position" }),
  ).toHaveText("Outside");

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await page.getByRole("button", { name: /^Effects(?: \d+ active)?$/ }).click();
  await expect(page.getByRole("button", { name: "Text curve" })).toHaveText(
    "Wave",
  );
  await expect(
    page.getByRole("button", { name: "Remove drop shadow" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Magic select" }).click();
  await expect(
    page
      .getByTestId("image-editor-selection-options")
      .getByText("Tolerance 32"),
  ).toBeVisible();
  const selectionSurface = page.getByTestId("image-editor-selection-surface");
  const selectedPixelCount = () =>
    page.getByTestId("image-editor-pixel-selection").evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return 0;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return 0;
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let selected = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) selected++;
      }
      return selected;
    });
  const selectionBounds = () =>
    page.getByTestId("image-editor-pixel-selection").evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] === 0) continue;
        const pixel = (index - 3) / 4;
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return maxX < 0
        ? null
        : {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          };
    });
  const selectionBox = await selectionSurface.boundingBox();
  if (!selectionBox)
    throw new Error(
      "OpenPost Image Editor selection surface did not produce layout bounds",
    );
  const magicPoint = await selectionSurface.evaluate((surface) => {
    const bounds = surface.getBoundingClientRect();
    const left = Math.max(0, bounds.left);
    const right = Math.min(window.innerWidth, bounds.right);
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(window.innerHeight, bounds.bottom);
    const targets: Array<{
      x: number;
      y: number;
      tag: string;
      testid: string | null;
      classes: string | null;
    }> = [];
    for (let y = top + 16; y < bottom - 16; y += 24) {
      for (let x = left + 16; x < right - 16; x += 24) {
        const target = document.elementFromPoint(x, y);
        if (target === surface) return { x, y };
        if (targets.length < 8 && target) {
          targets.push({
            x,
            y,
            tag: target.tagName,
            testid: target.getAttribute("data-testid"),
            classes: target.getAttribute("class"),
          });
        }
      }
    }
    throw new Error(
      `No unobstructed point was available on the OpenPost Image Editor canvas: ${JSON.stringify(
        {
          bounds: { left, right, top, bottom },
          surface: {
            pointerEvents: getComputedStyle(surface).pointerEvents,
            display: getComputedStyle(surface).display,
            visibility: getComputedStyle(surface).visibility,
            zIndex: getComputedStyle(surface).zIndex,
            connected: surface.isConnected,
          },
          ancestors: (() => {
            const values: Array<{
              tag: string;
              testid: string | null;
              pointerEvents: string;
              classes: string | null;
            }> = [];
            let current: Element | null = surface;
            while (current && values.length < 8) {
              values.push({
                tag: current.tagName,
                testid: current.getAttribute("data-testid"),
                pointerEvents: getComputedStyle(current).pointerEvents,
                classes: current.getAttribute("class"),
              });
              current = current.parentElement;
            }
            return values;
          })(),
          stack: document
            .elementsFromPoint((left + right) / 2, (top + bottom) / 2)
            .map((element) => ({
              tag: element.tagName,
              testid: element.getAttribute("data-testid"),
              classes: element.getAttribute("class"),
            }))
            .slice(0, 8),
          targets,
        },
      )}`,
    );
  });
  await page.mouse.click(magicPoint.x, magicPoint.y);
  await expect(
    page.getByTestId("image-editor-pixel-selection"),
  ).toHaveAttribute("data-active", "true");
  await expect.poll(selectedPixelCount).toBeGreaterThan(0);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(1);

  await page
    .getByTestId("image-editor-selection-options")
    .getByRole("button", { name: "Subtract" })
    .click();
  await page.mouse.click(magicPoint.x, magicPoint.y);
  await expect.poll(selectedPixelCount).toBe(0);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(1);

  await page.keyboard.press("m");
  const marqueeSlot = page.getByRole("button", { name: "Rectangle select" });
  await expect(marqueeSlot).toBeVisible();
  await marqueeSlot.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Rectangle select" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Ellipse select" }).click();
  const ellipseSlot = page.getByRole("button", { name: "Ellipse select" });
  await ellipseSlot.click();
  await expect(
    page
      .getByTestId("image-editor-selection-options")
      .getByText("Ellipse select"),
  ).toBeVisible();
  await page.keyboard.press("m");
  await page
    .getByTestId("image-editor-selection-options")
    .getByRole("button", { name: "New" })
    .click();
  const marqueeBounds = await selectionSurface.boundingBox();
  if (!marqueeBounds)
    throw new Error(
      "OpenPost Image Editor selection surface did not produce layout bounds",
    );
  await page.mouse.move(
    marqueeBounds.x + marqueeBounds.width * 0.05,
    marqueeBounds.y + marqueeBounds.height * 0.14,
  );
  await page.mouse.down();
  await page.mouse.move(
    marqueeBounds.x + marqueeBounds.width * 0.3,
    marqueeBounds.y + marqueeBounds.height * 0.24,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect.poll(selectedPixelCount).toBeGreaterThan(0);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(1);
  const selectionBeforeMove = await selectionBounds();
  if (!selectionBeforeMove)
    throw new Error("Rectangle selection did not produce pixel bounds");
  const selectionCanvasSize = await page
    .getByTestId("image-editor-pixel-selection")
    .evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
  const selectionStart = {
    x:
      marqueeBounds.x +
      ((selectionBeforeMove.x + selectionBeforeMove.width / 2) /
        selectionCanvasSize.width) *
        marqueeBounds.width,
    y:
      marqueeBounds.y +
      ((selectionBeforeMove.y + selectionBeforeMove.height / 2) /
        selectionCanvasSize.height) *
        marqueeBounds.height,
  };
  await page.mouse.move(selectionStart.x, selectionStart.y);
  await page.mouse.down();
  await page.mouse.move(selectionStart.x + 24, selectionStart.y + 16, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await selectionBounds())?.x ?? 0)
    .toBeGreaterThan(selectionBeforeMove.x);
  const selectionAfterDrag = await selectionBounds();
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(async () => (await selectionBounds())?.x ?? 0)
    .toBe((selectionAfterDrag?.x ?? 0) + 10);
  await page
    .getByTestId("image-editor-selection-options")
    .getByRole("button", { name: "Deselect" })
    .click();

  await page.keyboard.press("Shift+m");
  await expect(
    page.getByRole("button", { name: "Ellipse select" }),
  ).toBeVisible();
  await page.keyboard.down("Shift");
  await page.mouse.move(
    marqueeBounds.x + marqueeBounds.width * 0.34,
    marqueeBounds.y + marqueeBounds.height * 0.22,
  );
  await page.mouse.down();
  await page.mouse.move(
    marqueeBounds.x + marqueeBounds.width * 0.54,
    marqueeBounds.y + marqueeBounds.height * 0.42,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect
    .poll(selectionBounds)
    .toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  const ellipseBounds = await selectionBounds();
  expect(
    Math.abs((ellipseBounds?.width ?? 0) - (ellipseBounds?.height ?? 0)),
  ).toBeLessThanOrEqual(2);

  await page.keyboard.press("l");
  await expect(
    page.getByRole("button", { name: "Lasso select", pressed: true }),
  ).toBeVisible();
  const lassoBounds = await selectionSurface.boundingBox();
  if (!lassoBounds)
    throw new Error(
      "OpenPost Image Editor selection surface did not produce layout bounds",
    );
  const lassoPoints = [
    [0.04, 0.08],
    [0.96, 0.08],
    [0.96, 0.94],
    [0.04, 0.94],
    [0.04, 0.08],
  ];
  await page.mouse.move(
    lassoBounds.x + lassoBounds.width * lassoPoints[0][0],
    lassoBounds.y + lassoBounds.height * lassoPoints[0][1],
  );
  await page.mouse.down();
  for (const [x, y] of lassoPoints.slice(1)) {
    await page.mouse.move(
      lassoBounds.x + lassoBounds.width * x,
      lassoBounds.y + lassoBounds.height * y,
      { steps: 5 },
    );
  }
  await page.mouse.up();
  await expect.poll(selectedPixelCount).toBeGreaterThan(1000);

  await page
    .getByTestId("image-editor-selection-options")
    .getByRole("button", { name: "Deselect" })
    .click();
  await page.keyboard.press("p");
  const roughness = page.getByRole("slider", { name: "Roughness 0%" });
  await roughness.focus();
  await roughness.press("End");
  await expect(
    page.getByRole("slider", { name: "Roughness 100%" }),
  ).toBeVisible();
  await page.mouse.move(
    lassoBounds.x + lassoBounds.width * 0.25,
    lassoBounds.y + lassoBounds.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    lassoBounds.x + lassoBounds.width * 0.65,
    lassoBounds.y + lassoBounds.height * 0.55,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(
    page.getByRole("treeitem", { name: /Pencil, paint/ }),
  ).toBeVisible();

  await page.getByRole("treeitem", { name: /Accent, shape/ }).click();
  await page.keyboard.press("g");
  await page.mouse.move(
    lassoBounds.x + lassoBounds.width * 0.3,
    lassoBounds.y + lassoBounds.height * 0.4,
  );
  await page.mouse.down();
  await page.mouse.move(
    lassoBounds.x + lassoBounds.width * 0.7,
    lassoBounds.y + lassoBounds.height * 0.68,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(
    page.getByRole("treeitem", { name: /Gradient, paint/ }),
  ).toBeVisible();

  await page.keyboard.press("Shift+g");
  await page.mouse.click(
    lassoBounds.x + lassoBounds.width * 0.5,
    lassoBounds.y + lassoBounds.height * 0.72,
  );
  await expect(
    page.getByRole("treeitem", { name: /Paint bucket, paint/ }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  const mobileTools = page.getByRole("navigation", { name: "Tools" });
  await expect(mobileTools.getByRole("button")).toHaveCount(6);
  await expect(mobileTools.getByRole("button", { name: "Add" })).toBeVisible();
  await expect(
    mobileTools.getByRole("button", { name: "Select" }),
  ).toBeVisible();
  await expect(mobileTools.getByRole("button", { name: "Draw" })).toBeVisible();
  await expect(
    mobileTools.getByRole("button", { name: "Retouch" }),
  ).toBeVisible();
  await mobileTools.getByRole("button", { name: "Select" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Magic select" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Rectangle select" }).click();
  await mobileTools.getByRole("button", { name: "Select" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Rectangle select" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Ellipse select" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await mobileTools.getByRole("button", { name: "Draw" }).click();
  await page.getByRole("menuitem", { name: "Text", exact: true }).click();
  const fabricTextarea = page.locator('textarea[data-fabric="textarea"]');
  await expect(fabricTextarea).toBeFocused();
  await page.setViewportSize({ width: 390, height: 560 });
  await fabricTextarea.pressSequentially(" on mobile", { delay: 15 });
  await expect(fabricTextarea).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shell = document.querySelector(
          '[data-testid="image-editor-shell"]',
        );
        const textarea = document.querySelector(
          'textarea[data-fabric="textarea"]',
        );
        if (
          !(shell instanceof HTMLElement) ||
          !(textarea instanceof HTMLElement)
        )
          return null;
        const shellBounds = shell.getBoundingClientRect();
        const textareaBounds = textarea.getBoundingClientRect();
        return {
          scrollY: window.scrollY,
          shellTop: Math.round(shellBounds.top),
          shellBottom: Math.round(shellBounds.bottom),
          viewportHeight: window.innerHeight,
          textareaPosition: getComputedStyle(textarea).position,
          textareaTop: Math.round(textareaBounds.top),
        };
      }),
    )
    .toEqual({
      scrollY: 0,
      shellTop: 0,
      shellBottom: 560,
      viewportHeight: 560,
      textareaPosition: "fixed",
      textareaTop: 1,
    });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const layersDialog = page.getByRole("dialog", { name: "Layers" });
  await expect(layersDialog).toBeVisible();
  const paintBucketRow = layersDialog.getByRole("treeitem", {
    name: /Paint bucket, paint/,
  });
  const pencilRow = layersDialog.getByRole("treeitem", {
    name: /Pencil, paint/,
  });
  const bucketHandle = paintBucketRow.getByTestId(
    "image-editor-layer-drag-handle",
  );
  const [handleBounds, pencilBounds] = await Promise.all([
    bucketHandle.boundingBox(),
    pencilRow.boundingBox(),
  ]);
  if (!handleBounds || !pencilBounds) {
    throw new Error("Mobile layer reorder controls were not measurable");
  }
  const touch = await page.context().newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        id: 1,
        x: handleBounds.x + handleBounds.width / 2,
        y: handleBounds.y + handleBounds.height / 2,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      },
    ],
  });
  await page.waitForTimeout(60);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      {
        id: 1,
        x: (handleBounds.x + pencilBounds.x) / 2 + handleBounds.width / 2,
        y: (handleBounds.y + pencilBounds.y) / 2 + handleBounds.height / 2,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      },
    ],
  });
  await expect(paintBucketRow).toHaveClass(/opacity-60/);
  await page.waitForTimeout(60);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      {
        id: 1,
        x: pencilBounds.x + pencilBounds.width / 2,
        y: pencilBounds.y + pencilBounds.height * 0.75,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      },
    ],
  });
  await expect(pencilRow).toHaveAttribute("data-drop-position", "below");
  await page.waitForTimeout(60);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => {
      const labels = await layersDialog
        .getByRole("treeitem")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("aria-label") ?? ""),
        );
      const pencilIndex = labels.findIndex((label) =>
        label.startsWith("Pencil, paint"),
      );
      const bucketIndex = labels.findIndex((label) =>
        label.startsWith("Paint bucket, paint"),
      );
      return pencilIndex >= 0 && bucketIndex >= 0 && pencilIndex < bucketIndex;
    })
    .toBe(true);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redo" })).toBeVisible();
  await expect(mobileTools.getByRole("button")).toHaveCount(6);
  expect(
    await mobileTools.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(() =>
      page.locator("button:visible").evaluateAll((buttons) =>
        buttons.flatMap((button) => {
          const bounds = button.getBoundingClientRect();
          if (bounds.width >= 44 && bounds.height >= 44) return [];
          return [
            {
              label:
                button.getAttribute("aria-label") ||
                button.textContent?.trim() ||
                "unlabelled",
              width: bounds.width,
              height: bounds.height,
            },
          ];
        }),
      ),
    )
    .toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "Export" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export design" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("radio", { name: "Media", exact: true }).click();
  await exportDialog
    .getByRole("button", { name: "Export to Media", exact: true })
    .click();

  await expect(page.getByText("1 exported page saved to Media.")).toBeVisible({
    timeout: 15_000,
  });
  const designID = new URL(page.url()).pathname.split("/").at(-1);
  if (!designID)
    throw new Error("OpenPost Image Editor URL did not contain a design ID");
  const savedDesign = await request.get(
    `/api/v1/image-editor/designs/${designID}`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
    },
  );
  expect(savedDesign.ok()).toBeTruthy();
  const savedDocument = await savedDesign.json();
  const paintLayers = savedDocument.document.pages[0].layers.filter(
    (layer: { type: string }) => layer.type === "paint",
  );
  expect(paintLayers).toHaveLength(3);
  expect(
    paintLayers.some(
      (layer: { paint?: { kind?: string; gradient?: unknown } }) =>
        layer.paint?.kind === "gradient" && Boolean(layer.paint.gradient),
    ),
  ).toBeTruthy();
  expect(
    savedDocument.document.pages[0].layers.findIndex(
      (layer: { name: string }) => layer.name === "Paint bucket",
    ),
  ).toBeLessThan(
    savedDocument.document.pages[0].layers.findIndex(
      (layer: { name: string }) => layer.name === "Pencil",
    ),
  );
  expect(
    paintLayers.every(
      (layer: { paint?: { spans?: unknown[] } }) =>
        (layer.paint?.spans?.length ?? 0) > 0,
    ),
  ).toBeTruthy();

  await page.goto("/editors");
  await expect(
    page.locator(`a[href="/image-editor/${designID}"]`),
  ).toBeVisible();

  await page.goto("/media");
  const libraryGrid = page.getByTestId("media-library-grid");
  await expect(libraryGrid.locator('[data-library-kind="asset"]')).toHaveCount(
    2,
  );

  await expect(page.getByText("picker-library.png")).toBeVisible();
  await expect(page.getByText("quick-announcement-page-01.png")).toBeVisible();
  const exportedImage = page.getByRole("img", {
    name: "quick-announcement-page-01.png",
  });
  await expect(exportedImage).toBeVisible();
  await expect
    .poll(() =>
      exportedImage.evaluate((image) => {
        if (!(image instanceof HTMLImageElement) || !image.complete) return 0;
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return 0;
        context.drawImage(image, 0, 0, 64, 64);
        const pixels = context.getImageData(0, 0, 64, 64).data;
        const colors = new Set<string>();
        for (let index = 0; index < pixels.length; index += 16) {
          colors.add(
            `${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}:${pixels[index + 3] >> 4}`,
          );
          if (colors.size >= 8) break;
        }
        return colors.size;
      }),
    )
    .toBeGreaterThanOrEqual(8);

  await page.goto("/editors");
  const designCard = page.locator(`a[href="/image-editor/${designID}"]`);
  await designCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const renameDesignDialog = page.getByRole("dialog", {
    name: "Rename design",
  });
  await renameDesignDialog
    .getByLabel("Project name")
    .fill("Renamed announcement");
  await renameDesignDialog
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(designCard.getByText("Renamed announcement")).toBeVisible();

  await designCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deleteDesignDialog = page.getByRole("dialog", {
    name: "Delete design?",
  });
  await expect(deleteDesignDialog).toBeVisible();
  await deleteDesignDialog
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(designCard).toHaveCount(0);

  expect({ browserErrors, failedResponses }).toEqual({
    browserErrors: [],
    failedResponses: [],
  });
});
