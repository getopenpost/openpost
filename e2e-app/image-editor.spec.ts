import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const tinyPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function canvasPixelGrid(canvas: Locator): Promise<number[]> {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement) || !element.width) return [];
    const sample = document.createElement("canvas");
    sample.width = 32;
    sample.height = 32;
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(element, 0, 0, sample.width, sample.height);
    return Array.from(context.getImageData(0, 0, sample.width, sample.height).data);
  });
}

async function imagePixelGrid(image: Locator): Promise<number[]> {
  return image.evaluate((element) => {
    if (!(element instanceof HTMLImageElement) || !element.complete) return [];
    const sample = document.createElement("canvas");
    sample.width = 32;
    sample.height = 32;
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(element, 0, 0, sample.width, sample.height);
    return Array.from(context.getImageData(0, 0, sample.width, sample.height).data);
  });
}

function meanPixelDifference(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return Number.POSITIVE_INFINITY;
  return (
    left.reduce((total, value, index) => total + Math.abs(value - right[index]), 0) / left.length
  );
}

async function openImageVersionHistory(page: Page): Promise<void> {
  const menus = page.getByRole("menubar", {
    name: "OpenPost Image Editor menus",
  });
  await menus.getByText("File", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
}

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) =>
    console.error(`[Image Editor page error] ${error.stack ?? error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[Image Editor console error] ${message.text()}`);
    }
  });
});

test("Image Editor autosaves without replaying the saved-status animation", async ({ page }) => {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await expect(page.getByTestId("image-editor-stage")).toBeVisible();

  await page.evaluate(() => {
    window.addEventListener(
      "animationstart",
      (event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.dataset.testid === "image-editor-save-indicator"
        ) {
          (window as Window & { imageEditorSaveAnimations?: number }).imageEditorSaveAnimations =
            ((window as Window & { imageEditorSaveAnimations?: number })
              .imageEditorSaveAnimations ?? 0) + 1;
        }
      },
      true,
    );
  });

  await page.keyboard.press("t");
  await expect(page.getByRole("treeitem", { name: /text/ })).toBeVisible();
  await page.keyboard.press("Escape");
  const text = page.locator("textarea:not([data-fabric])");
  await expect(text).toBeVisible();
  await text.fill("An updated image-editor preview");
  await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
    "data-state",
    "saved",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { imageEditorSaveAnimations?: number }).imageEditorSaveAnimations ??
          0,
      ),
    )
    .toBe(0);
});

test("legacy Studio URLs redirect to the OpenPost Image Editor", async ({ page, request }) => {
  const auth = await registerUser(
    request,
    `studio-redirect-${Date.now().toString(36)}@example.com`,
  );
  await authenticatePage(page, auth.token);
  await page.goto("/image-editor/new");
  await expect(page).toHaveURL(/\/image-editor\/new\?legacy-route=1$/);
});

test("public Image Editor drops and crops an image with undo, redo, and reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  const stage = page.getByTestId("image-editor-stage");
  await expect(stage).toBeVisible();

  await stage.evaluate((node, png) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped-launch.png", { type: "image/png" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      node.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: node.getBoundingClientRect().left + node.clientWidth / 2,
          clientY: node.getBoundingClientRect().top + node.clientHeight / 2,
        }),
      );
    }
  }, tinyPNG.toString("base64"));

  const imageLayer = page.getByRole("treeitem", {
    name: /dropped-launch\.png, image/,
  });
  await expect(imageLayer).toBeVisible();
  const desktopTools = page.getByRole("navigation", {
    name: "OpenPost Image Editor tools",
  });
  await desktopTools.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(page.getByTestId("image-editor-crop-options")).toBeVisible();

  const rightHandle = page.getByRole("button", {
    name: "Resize crop from right",
    exact: true,
  });
  const cropFrame = page.getByRole("group", { name: "Crop frame" });
  const handleBox = await rightHandle.boundingBox();
  const stageBox = await stage.boundingBox();
  const initialFrame = await cropFrame.evaluate((element) => ({
    left: Number.parseFloat((element as HTMLElement).style.left),
    width: Number.parseFloat((element as HTMLElement).style.width),
  }));
  if (!handleBox) throw new Error("Interactive crop handle did not render");
  if (!stageBox) throw new Error("Image Editor stage did not render");
  const documentCenter = initialFrame.left + initialFrame.width / 2;
  const documentCenterX = stageBox.x + documentCenter;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(documentCenterX + 3, handleBox.y + handleBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const frame = await cropFrame.evaluate((element) => ({
        left: Number.parseFloat((element as HTMLElement).style.left),
        width: Number.parseFloat((element as HTMLElement).style.width),
      }));
      return Math.abs(frame.left + frame.width - documentCenter);
    })
    .toBeLessThan(2);
  const snappedHandle = await rightHandle.boundingBox();
  if (!snappedHandle) throw new Error("Snapped crop handle did not render");
  await page.keyboard.down("Meta");
  const snappedHandleOuterX = snappedHandle.x + snappedHandle.width - 4;
  await page.mouse.move(snappedHandleOuterX, snappedHandle.y + snappedHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(snappedHandleOuterX + 6, snappedHandle.y + snappedHandle.height / 2, {
    steps: 3,
  });
  await page.mouse.up();
  await page.keyboard.up("Meta");
  await expect
    .poll(async () => {
      const frame = await cropFrame.evaluate((element) => ({
        left: Number.parseFloat((element as HTMLElement).style.left),
        width: Number.parseFloat((element as HTMLElement).style.width),
      }));
      return frame.left + frame.width - documentCenter;
    })
    .toBeGreaterThan(3);
  await rightHandle.press("Shift+ArrowLeft");

  const frameLeft = await cropFrame.evaluate((element) => (element as HTMLElement).style.left);
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await expect(cropFrame).toHaveAttribute("data-mode", "content");
  await page
    .getByRole("button", { name: "Move image within crop frame" })
    .press("Shift+ArrowRight");
  await expect
    .poll(() => cropFrame.evaluate((element) => (element as HTMLElement).style.left))
    .toBe(frameLeft);
  await page.getByRole("button", { name: "Rotate crop right" }).click();
  await page.getByRole("button", { name: "Flip crop horizontally" }).click();
  await expect(cropFrame).toHaveCSS("transform", /matrix\(0, 1, -1, 0,/);
  await page.getByRole("button", { name: "Apply crop" }).click();

  const undo = page.getByRole("button", { name: /^Undo(?: |$)/ }).first();
  const redo = page.getByRole("button", { name: /^Redo(?: |$)/ }).first();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(page.getByRole("banner").getByText("Saved on this device")).toBeVisible();

  await page.reload();
  await imageLayer.click();
  await page.getByRole("button", { name: "Crop", exact: true }).last().click();
  await expect(page.getByRole("spinbutton", { name: "W" })).not.toHaveValue("100");
  await desktopTools.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(cropFrame).toHaveCSS("transform", /matrix\(0, 1, -1, 0,/);

  await page.getByRole("button", { name: "Rotate crop left" }).click();
  await expect(cropFrame).toHaveCSS("transform", /matrix\(1, 0, 0, 1,/);
  await page.keyboard.press("Escape");
  await desktopTools.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(cropFrame).toHaveCSS("transform", /matrix\(0, 1, -1, 0,/);

  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  await expect(page.getByTestId("image-editor-eyedropper-options")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const magnifier = page.getByTestId("image-editor-eyedropper-magnifier");
  await expect(magnifier).toBeVisible();
  await expect(magnifier.locator(".eyedropper-grid > span")).toHaveCount(81);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("image-editor-eyedropper-options")).toContainText(
    /#[0-9A-F]{6} · \d+%/,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("image-editor-eyedropper-options")).toHaveCount(0);

  await page.keyboard.press("m");
  const selectionSurface = page.getByTestId("image-editor-selection-surface");
  const selectionSurfaceBox = await selectionSurface.boundingBox();
  if (!selectionSurfaceBox) throw new Error("Pixel selection surface did not render");
  await page.mouse.move(
    selectionSurfaceBox.x + selectionSurfaceBox.width * 0.42,
    selectionSurfaceBox.y + selectionSurfaceBox.height * 0.42,
  );
  await page.mouse.down();
  await page.mouse.move(
    selectionSurfaceBox.x + selectionSurfaceBox.width * 0.58,
    selectionSurfaceBox.y + selectionSurfaceBox.height * 0.58,
    { steps: 5 },
  );
  await page.mouse.up();
  const pixelSelection = page.getByTestId("image-editor-pixel-selection");
  await expect(pixelSelection).toHaveAttribute("data-active", "true");
  const selectionX = () =>
    pixelSelection.evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return -1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return -1;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let minimum = canvas.width;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) minimum = Math.min(minimum, ((index - 3) / 4) % canvas.width);
      }
      return minimum;
    });

  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  const copiedSelectionLayer = page.getByRole("treeitem", {
    name: /dropped-launch\.png selection copy, image/,
  });
  await expect(copiedSelectionLayer).toBeVisible();
  await undo.click();
  await expect(copiedSelectionLayer).toHaveCount(0);

  const selectionOptions = page.getByTestId("image-editor-selection-options");
  await selectionOptions.getByRole("button", { name: "Cut selected pixels" }).click();
  await expect(selectionOptions.getByText(/Drag or use arrow keys/)).toBeVisible();
  const originalSelectionX = await selectionX();
  await page.mouse.move(
    selectionSurfaceBox.x + selectionSurfaceBox.width / 2,
    selectionSurfaceBox.y + selectionSurfaceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    selectionSurfaceBox.x + selectionSurfaceBox.width / 2 + 20,
    selectionSurfaceBox.y + selectionSurfaceBox.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect.poll(selectionX).toBeGreaterThan(originalSelectionX);
  const draggedSelectionX = await selectionX();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(selectionX).toBe(draggedSelectionX + 10);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("treeitem", {
      name: /dropped-launch\.png selection, image/,
    }),
  ).toHaveCount(0);
  await expect(pixelSelection).toHaveAttribute("data-active", "true");

  await selectionOptions.getByRole("button", { name: "Cut selected pixels" }).click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Enter");
  const movedSelectionLayer = page.getByRole("treeitem", {
    name: /dropped-launch\.png selection, image/,
  });
  await expect(movedSelectionLayer).toBeVisible();
  await expect(pixelSelection).toHaveAttribute("data-active", "false");
  await undo.click();
  await expect(movedSelectionLayer).toHaveCount(0);
  await redo.click();
  await expect(movedSelectionLayer).toBeVisible();
  await expect(page.getByRole("banner").getByText("Saved on this device")).toBeVisible();
  await page.reload();
  await expect(movedSelectionLayer).toBeVisible();
});

test("public Image Editor isolates invalid files and keeps page-targeted batch imports stable", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  const stage = page.getByTestId("image-editor-stage");
  await stage.evaluate((node, png) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "preview.png", { type: "image/png" }));
    node.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, tinyPNG.toString("base64"));
  await expect(page.getByTestId("image-editor-media-drop-target")).toBeVisible();
  await stage.evaluate((node, png) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "preview.png", { type: "image/png" }));
    node.dispatchEvent(
      new DragEvent("dragleave", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, tinyPNG.toString("base64"));
  await page.getByRole("button", { name: "Add page" }).click();
  const pageOne = page.getByRole("button", { name: /Page 1:/ });
  const pageTwo = page.getByRole("button", { name: /Page 2:/ });
  if (!(await pageTwo.isVisible())) {
    await page.getByRole("button", { name: "Expand pages" }).click();
  }
  await pageOne.click();

  await pageTwo.evaluate((node, png) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "preview.png", { type: "image/png" }));
    node.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, tinyPNG.toString("base64"));
  await expect(pageTwo).toHaveAttribute("data-external-drop", "active");

  await pageTwo.evaluate((node, png) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "first.png", { type: "image/png" }));
    transfer.items.add(new File([bytes], "second.png", { type: "image/png" }));
    transfer.items.add(new File(["not an image"], "notes.txt", { type: "text/plain" }));
    node.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, tinyPNG.toString("base64"));

  const first = page.getByRole("treeitem", { name: /first\.png, image/ });
  const second = page.getByRole("treeitem", { name: /second\.png, image/ });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const failures = page.getByTestId("image-editor-import-errors");
  await expect(failures).toContainText("1 of 3 images could not be imported");
  await failures.getByText("Review failed files").click();
  await expect(failures).toContainText("notes.txt");
  await failures.getByRole("button", { name: "Retry failed files" }).click();
  await expect(failures).toContainText("1 of 1 images could not be imported");
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);

  await page
    .getByRole("button", { name: /^Undo(?: |$)/ })
    .first()
    .click();
  await expect(second).toHaveCount(0);
  await expect(first).toBeVisible();
  await expect(page.getByRole("banner").getByText("Saved on this device")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Page 2:/ }).click();
  await expect(first).toBeVisible();
  await expect(second).toHaveCount(0);
});

test("public Image Editor round-trips an editable project without overwriting its source", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  const sourceURL = page.url();

  const menus = page.getByRole("menubar", {
    name: "OpenPost Image Editor menus",
  });
  await menus.getByText("File", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export editable project" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.openpost-image$/);
  const projectPath = await download.path();
  if (!projectPath) throw new Error("Editable project download was unavailable");

  await page.locator('input[type="file"][accept*="openpost-image"]').setInputFiles(projectPath);
  await expect(page).not.toHaveURL(sourceURL);
  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await expect(page.getByRole("treeitem", { name: /Rectangle, shape/ })).toBeVisible();
});

test("signed-in project import can cancel and resume without repeating completed work", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  const stage = page.getByTestId("image-editor-stage");
  await stage.evaluate((node, png) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "portable-source.png", { type: "image/png" }));
    node.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: node.getBoundingClientRect().left + 20,
        clientY: node.getBoundingClientRect().top + 20,
      }),
    );
  }, tinyPNG.toString("base64"));
  await expect(page.getByRole("treeitem", { name: /portable-source\.png, image/ })).toBeVisible();
  const menus = page.getByRole("menubar", {
    name: "OpenPost Image Editor menus",
  });
  await menus.getByText("File", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export editable project" }).click();
  const projectPath = await (await downloadPromise).path();
  if (!projectPath) throw new Error("Editable project download was unavailable");

  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `project-resume-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Image project resume");
  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page
    .getByRole("region", { name: "Starter templates" })
    .getByRole("button", { name: /Quick announcement/ })
    .click();

  await page.route("**/api/v1/media/storage**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { direct_upload_supported: false },
    });
  });
  await page.route("**/api/v1/media/upload", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await route.abort("timedout").catch(() => undefined);
  });
  await page.locator('input[type="file"][accept*="openpost-image"]').setInputFiles(projectPath);
  await expect(page.getByText(/Importing source 1 of 1/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("alert").getByText(/Import cancelled.*kept so you can retry/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await page.unroute("**/api/v1/media/upload");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/image-editor\/[0-9a-f-]+$/, {
    timeout: 30_000,
  });
  await expect(page.getByRole("treeitem", { name: /portable-source\.png, image/ })).toBeVisible();
});

test("revision-conflict reload preserves local work as a separate cloud design", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `image-conflict-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Image conflict recovery");
  const headers = { Authorization: `Bearer ${auth.token}` };
  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page
    .getByRole("region", { name: "Starter templates" })
    .getByRole("button", { name: /Quick announcement/ })
    .click();
  await expect(page).toHaveURL(/\/image-editor\/[0-9a-f-]+$/);
  await expect(page.getByRole("textbox", { name: "Design title" })).toHaveValue(
    "Quick announcement",
  );

  const designID = new URL(page.url()).pathname.split("/").at(-1);
  if (!designID) throw new Error("Conflict test design ID was unavailable");
  const initialResponse = await request.get(`/api/v1/image-editor/designs/${designID}`, {
    headers,
  });
  expect(initialResponse.ok()).toBeTruthy();
  const initial = await initialResponse.json();
  const initialLayerCount = initial.document.pages[0].layers.length;

  let releaseBrowserSave = () => undefined;
  const browserSaveGate = new Promise<void>((resolve) => {
    releaseBrowserSave = resolve;
  });
  await page.route(`**/api/v1/image-editor/designs/${designID}`, async (route) => {
    if (route.request().method() === "PATCH") await browserSaveGate;
    await route.continue();
  });

  await page
    .getByRole("navigation", { name: "OpenPost Image Editor tools" })
    .getByRole("button", { name: "Shape", exact: true })
    .click();
  await expect(page.getByRole("treeitem", { name: /Rectangle, shape/ })).toBeVisible();

  const serverDocument = structuredClone(initial.document);
  serverDocument.title = "Server campaign";
  const serverUpdate = await request.patch(`/api/v1/image-editor/designs/${designID}`, {
    headers,
    data: {
      expected_revision: initial.revision,
      document: serverDocument,
      recovery_reason: "idle",
    },
  });
  expect(serverUpdate.ok()).toBeTruthy();
  releaseBrowserSave();

  const conflict = page.getByRole("dialog", {
    name: "This design changed elsewhere",
  });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(
    `Local revision ${initial.revision} conflicts with server revision ${initial.revision + 1}.`,
  );
  await conflict.getByRole("button", { name: "Reload server version" }).click();
  await expect(conflict).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Design title" })).toHaveValue("Server campaign");

  const designsResponse = await request.get(
    `/api/v1/image-editor/designs?workspace_id=${workspace.id}&limit=100&offset=0`,
    { headers },
  );
  expect(designsResponse.ok()).toBeTruthy();
  const designs = await designsResponse.json();
  const preserved = designs.designs.find(
    (design: { id: string; title: string }) =>
      design.id !== designID && design.title === "Server campaign copy",
  );
  expect(preserved).toBeTruthy();
  const preservedResponse = await request.get(`/api/v1/image-editor/designs/${preserved.id}`, {
    headers,
  });
  expect(preservedResponse.ok()).toBeTruthy();
  const preservedDesign = await preservedResponse.json();
  expect(preservedDesign.document.pages[0].layers).toHaveLength(initialLayerCount + 1);
});

test("version history previews lazily and restores both directions with an exact restore point", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `image-versions-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Image version history");
  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page
    .getByRole("region", { name: "Starter templates" })
    .getByRole("button", { name: /Quick announcement/ })
    .click();

  const title = page.getByRole("textbox", { name: "Design title" });
  const saved = page.getByTestId("image-editor-save-indicator");
  await title.fill("Approved image version");
  await expect(saved).toHaveAttribute("data-state", "saved", {
    timeout: 15_000,
  });

  await openImageVersionHistory(page);
  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(history).toBeVisible();
  await history.getByRole("button", { name: "Create checkpoint" }).click();
  const checkpoint = page.getByRole("dialog", { name: "Create checkpoint" });
  await checkpoint.getByRole("textbox", { name: "Checkpoint name" }).fill("Approved");
  await checkpoint.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(history).toBeVisible();
  await history
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close", exact: true })
    .click();

  await title.fill("Current image head");
  await expect(saved).toHaveAttribute("data-state", "saved", {
    timeout: 15_000,
  });

  let previewRequests = 0;
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "GET" &&
      /\/api\/v1\/image-editor\/designs\/[^/]+\/revisions\/[^/]+$/.test(
        new URL(outgoing.url()).pathname,
      )
    ) {
      previewRequests += 1;
    }
  });
  await openImageVersionHistory(page);
  await expect(
    history.getByText("Select a version to preview it and inspect its changes."),
  ).toBeVisible();
  expect(previewRequests).toBe(0);
  const approvedRevision = history.getByRole("button", { name: /Approved/ });
  await approvedRevision.click();
  await expect(history.getByText("Title changed")).toBeVisible();
  await expect(approvedRevision.getByText(/Saved by .+ \(you\)/)).toBeVisible();
  expect(previewRequests).toBe(1);
  await history.getByRole("button", { name: "Restore this version" }).click();

  const confirm = page.getByRole("dialog", { name: "Restore this version?" });
  await expect(confirm).toContainText("exact current design as a restore point");
  await confirm.getByRole("button", { name: "Restore version" }).click();
  await expect(title).toHaveValue("Approved image version");

  await openImageVersionHistory(page);
  const restorePoint = history.getByRole("button", { name: /Before restore/ }).first();
  await expect(restorePoint).toBeVisible();
  await restorePoint.click();
  await expect(history.getByText("Title changed")).toBeVisible();
  await history.getByRole("button", { name: "Restore this version" }).click();
  await confirm.getByRole("button", { name: "Restore version" }).click();
  await expect(title).toHaveValue("Current image head");
});

test("older named image versions load on demand and reorder-only previews cannot leak across dialog sessions", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `image-reorder-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Image reorder history");
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    "Content-Type": "application/json",
  };
  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page
    .getByRole("region", { name: "Starter templates" })
    .getByRole("button", { name: /Quick announcement/ })
    .click();
  await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 15_000 },
  );

  const designID = page.url().split("/").at(-1)!;
  const loaded = await request.get(`/api/v1/image-editor/designs/${designID}`, {
    headers,
  });
  expect(loaded.ok()).toBeTruthy();
  const original = await loaded.json();
  const originalLayerIDs = original.document.pages[0].layers.map(
    (layer: { id: string }) => layer.id,
  );
  expect(originalLayerIDs.length).toBeGreaterThan(1);

  for (let index = 0; index < 55; index += 1) {
    const checkpoint = await request.post(`/api/v1/image-editor/designs/${designID}/revisions`, {
      headers,
      data: {
        name:
          index === 0
            ? "Original layer order"
            : `Later named version ${String(index).padStart(2, "0")}`,
        expected_revision: original.revision,
      },
    });
    expect(checkpoint.ok()).toBeTruthy();
  }

  const reorderedDocument = structuredClone(original.document);
  reorderedDocument.pages[0].layers.reverse();
  const reordered = await request.patch(`/api/v1/image-editor/designs/${designID}`, {
    headers,
    data: {
      expected_revision: original.revision,
      document: reorderedDocument,
      cover_preview_media_id: original.cover_preview_media_id ?? "",
      recovery_reason: "idle",
    },
  });
  expect(reordered.ok()).toBeTruthy();
  await page.reload();

  let previewStarted!: () => void;
  let releasePreview!: () => void;
  const started = new Promise<void>((resolve) => (previewStarted = resolve));
  const release = new Promise<void>((resolve) => (releasePreview = resolve));
  let delayNextPreview = true;
  await page.route(`**/api/v1/image-editor/designs/${designID}/revisions/*`, async (route) => {
    if (route.request().method() !== "GET" || !delayNextPreview) {
      await route.continue();
      return;
    }
    delayNextPreview = false;
    const response = await route.fetch();
    previewStarted();
    await release;
    await route.fulfill({ response }).catch(() => undefined);
  });

  await openImageVersionHistory(page);
  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(history.getByRole("button", { name: "Original layer order" })).toHaveCount(0);
  await history.getByRole("button", { name: "Load more" }).click();
  const originalVersion = history.getByRole("button", {
    name: "Original layer order",
  });
  await expect(originalVersion).toBeVisible();
  await originalVersion.click();
  await started;
  await history
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close", exact: true })
    .click();

  await openImageVersionHistory(page);
  releasePreview();
  await expect(
    history.getByText("Select a version to preview it and inspect its changes."),
  ).toBeVisible();
  await history.getByRole("button", { name: "Load more" }).click();
  await history.getByRole("button", { name: "Original layer order" }).click();
  await expect(history.getByText(/Layers changed: [2-9]/)).toBeVisible();
  await expect(history.getByRole("button", { name: "Restore this version" })).toBeEnabled();
  await history.getByRole("button", { name: "Restore this version" }).click();
  await page
    .getByRole("dialog", { name: "Restore this version?" })
    .getByRole("button", { name: "Restore version" })
    .click();
  await expect(history).not.toBeVisible();

  const restored = await request.get(`/api/v1/image-editor/designs/${designID}`, { headers });
  expect(restored.ok()).toBeTruthy();
  expect(
    (await restored.json()).document.pages[0].layers.map((layer: { id: string }) => layer.id),
  ).toEqual(originalLayerIDs);
});

test("public Image Editor keeps zoom, touch, stylus, and Portuguese chrome usable", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.context().addCookies([
    {
      name: "PARAGLIDE_LOCALE",
      value: "pt",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
    },
  ]);
  await page.goto("/image-editor");
  await page.getByRole("button").filter({ hasText: "1080 × 1080" }).first().click();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(page.getByTestId("image-editor-shell")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const canvas = page.getByRole("application", { name: "Tela do design" });
  const stage = page.getByTestId("image-editor-stage");
  const beforePinch = await stage.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!beforePinch || !canvasBox) throw new Error("Canvas bounds were unavailable");
  const center = {
    x: canvasBox.x + canvasBox.width / 2,
    y: canvasBox.y + canvasBox.height / 2,
  };
  await canvas.dispatchEvent("pointerdown", {
    pointerId: 31,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: center.x - 30,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointerdown", {
    pointerId: 32,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    buttons: 1,
    clientX: center.x + 30,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointermove", {
    pointerId: 32,
    pointerType: "touch",
    isPrimary: false,
    buttons: 1,
    clientX: center.x + 80,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointerup", {
    pointerId: 31,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: center.x - 30,
    clientY: center.y,
  });
  await canvas.dispatchEvent("pointerup", {
    pointerId: 32,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    buttons: 0,
    clientX: center.x + 80,
    clientY: center.y,
  });
  await expect
    .poll(async () => (await stage.boundingBox())?.width ?? 0)
    .toBeGreaterThan(beforePinch.width);

  await page.keyboard.press("b");
  const surface = page.getByTestId("image-editor-selection-surface");
  const surfaceBox = await surface.boundingBox();
  if (!surfaceBox) throw new Error("Drawing surface bounds were unavailable");
  const penStart = {
    x: surfaceBox.x + surfaceBox.width * 0.4,
    y: surfaceBox.y + surfaceBox.height * 0.4,
  };
  await surface.dispatchEvent("pointerdown", {
    pointerId: 51,
    pointerType: "pen",
    pressure: 0.8,
    button: 0,
    buttons: 1,
    clientX: penStart.x,
    clientY: penStart.y,
  });
  await surface.dispatchEvent("pointerdown", {
    pointerId: 52,
    pointerType: "touch",
    pressure: 0.5,
    button: 0,
    buttons: 1,
    clientX: penStart.x + 4,
    clientY: penStart.y + 4,
  });
  await surface.dispatchEvent("pointermove", {
    pointerId: 51,
    pointerType: "pen",
    pressure: 0.6,
    buttons: 1,
    clientX: penStart.x + 35,
    clientY: penStart.y + 25,
  });
  await surface.dispatchEvent("pointerup", {
    pointerId: 51,
    pointerType: "pen",
    pressure: 0,
    button: 0,
    buttons: 0,
    clientX: penStart.x + 35,
    clientY: penStart.y + 25,
  });
  await surface.dispatchEvent("pointerup", {
    pointerId: 52,
    pointerType: "touch",
    pressure: 0,
    button: 0,
    buttons: 0,
    clientX: penStart.x + 4,
    clientY: penStart.y + 4,
  });
  await expect(page.getByRole("button", { name: "Anular" })).toBeEnabled();
});

test("public Image Editor completes create-to-export with keyboard commands", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/image-editor");
  const preset = page.getByRole("button", { name: /Instagram square/ });
  await preset.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("image-editor-shell")).toBeVisible();
  await page.keyboard.press("u");
  await expect(page.getByRole("treeitem", { name: /Rectangle, shape/ })).toBeVisible();
  await page.keyboard.press("Control+Shift+e");
  const exportDialog = page.getByRole("dialog", { name: "Export design" });
  await expect(exportDialog).toBeVisible();
  const downloadButton = exportDialog.getByRole("button", { name: "Download" });
  for (
    let index = 0;
    index < 12 && !(await downloadButton.evaluate((node) => node === document.activeElement));
    index++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(downloadButton).toBeFocused();
  const download = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  await download;
});

test("public Image Editor keeps primary actions usable at 320 px and in short landscape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.setViewportSize({ width: 667, height: 320 });
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
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
    if (request.method() !== "GET" && request.url().includes("/api/v1/image-editor/designs")) {
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
      sessionStorage.setItem("public-image-editor-test-events", JSON.stringify(events));
    });
  });

  await page.goto("/image-editor");
  await expect(page.getByRole("heading", { name: "Free social media image editor" })).toBeVisible();
  await expect(page.getByText("No account or watermark.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: /Instagram square/ }).click();

  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const designCanvas = page.getByRole("application", {
    name: "Design canvas",
  });
  const stage = page.getByTestId("image-editor-stage");
  const [canvasBox, stageBeforeZoom] = await Promise.all([
    designCanvas.boundingBox(),
    stage.boundingBox(),
  ]);
  if (!canvasBox || !stageBeforeZoom) {
    throw new Error("Public OpenPost Image Editor canvas did not produce measurable bounds");
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
    throw new Error("Public OpenPost Image Editor canvas disappeared after zooming");
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
  await expect(zoomControl).not.toHaveAttribute("aria-label", zoomLabelBefore ?? "");

  await zoomControl.click();
  const fittedStage = await stage.boundingBox();
  if (!fittedStage) {
    throw new Error("Public OpenPost Image Editor canvas did not fit on demand");
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
  await expect(page.getByRole("treeitem", { name: /New text, text/ })).toBeVisible();
  await expect(page.locator("textarea").last()).toHaveValue("New text");
  await page.keyboard.press("Escape");

  const imageEditorMenus = page.getByRole("menubar", {
    name: "OpenPost Image Editor menus",
  });
  await expect(imageEditorMenus).toBeVisible();
  await imageEditorMenus.getByText("File", { exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /Save.*(?:Ctrl|⌘) S/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Shape", exact: true }).click({
    button: "right",
  });
  const shapeMenu = page.locator("[data-context-menu-content]");
  await expect(shapeMenu.getByText("Rounded", { exact: true })).toBeVisible();
  const shapeMenuBox = await shapeMenu.boundingBox();
  if (!shapeMenuBox) throw new Error("OpenPost Image Editor shape menu did not render");
  expect(shapeMenuBox.width).toBeLessThanOrEqual(192);
  expect(shapeMenuBox.height).toBeLessThanOrEqual(152);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Shape", exact: true }).click();
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
  await expect(page.getByTestId("image-editor-object-selection-outline")).toBeVisible();
  await page.mouse.up();
  await expect(rectangleLayer).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("m");
  await expect(page.getByRole("button", { name: "Rectangle select", pressed: true })).toBeVisible();
  const outsideSelectionStart = {
    x: (canvasBox.x + fittedStage.x) / 2,
    y: fittedStage.y + fittedStage.height * 0.25,
  };
  const outsideSelectionEnd = {
    x: (fittedStage.x + fittedStage.width + canvasBox.x + canvasBox.width) / 2,
    y: fittedStage.y + fittedStage.height * 0.75,
  };
  expect(outsideSelectionStart.x).toBeLessThan(fittedStage.x);
  expect(outsideSelectionEnd.x).toBeGreaterThan(fittedStage.x + fittedStage.width);
  await page.mouse.move(outsideSelectionStart.x, outsideSelectionStart.y);
  await page.mouse.down();
  await page.mouse.move(outsideSelectionEnd.x, outsideSelectionEnd.y, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByTestId("image-editor-pixel-selection")).toHaveAttribute(
    "data-active",
    "true",
  );
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
  await expect(layersTree.getByRole("treeitem", { name: /Sketches, paint/ })).toBeVisible();

  const title = page.getByRole("textbox", { name: "Design title" });
  await title.fill("Local launch design");
  await expect(page.getByRole("banner").getByText("Saved on this device")).toBeVisible();

  await page.reload();
  await expect(title).toHaveValue("Local launch design");
  const localDesignURL = page.url();
  await title.fill("Latest conversion edit");
  await page.getByRole("button", { name: "Save to OpenPost" }).click();
  await expect(page).toHaveURL(/\/register\?redirect=/);
  await page.goto(localDesignURL);
  await expect(title).toHaveValue("Latest conversion edit");

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("heading", { name: "Export design" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  await download;
  await expect(
    page.getByLabel("Notifications alt+T").getByText("Export downloaded."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Export complete" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const trackedEvents = await page.evaluate(
    () =>
      (window as Window & { __publicImageEditorEvents?: string[] }).__publicImageEditorEvents ?? [],
  );
  expect(trackedEvents).toContain("image_editor_design_started");
  expect(trackedEvents).toContain("image_editor_meaningful_edit");
  expect(trackedEvents).toContain("image_editor_export_completed");
  expect(workspaceWrites).toEqual([]);
  expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
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
  await page.getByRole("button", { name: "Stock media" }).click();
  await expect(
    page.getByText("Search a configured provider to find photos for your design."),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search stock media" }).fill("desk");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("link", { name: "by OpenPost Test" })).toBeVisible();
  await page.getByRole("button", { name: "Use", exact: true }).click();

  const stockLayer = page.getByRole("treeitem", {
    name: /pexels-image-editor-photo-1\.png, image/,
  });
  await expect(stockLayer).toBeVisible();
  await expect(
    page.getByText("pexels-image-editor-photo-1.png", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("banner").getByText("Saved on this device")).toBeVisible();

  await page.reload();
  await expect(stockLayer).toBeVisible();
  expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
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
  const workspace = await createWorkspace(request, auth.token, "OpenPost Image Editor E2E");

  await authenticatePage(page, auth.token);
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);

  await expect(page.getByRole("heading", { name: "Choose a format" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Starter templates" })).toBeVisible();
  const starterTemplates = page.getByRole("region", {
    name: "Starter templates",
  });
  await expect(starterTemplates.getByRole("button")).toHaveCount(15);
  await expect(starterTemplates.getByRole("button", { name: /Quiet quote/ })).toBeVisible();
  await expect(starterTemplates.getByRole("button", { name: /YouTube list/ })).toBeVisible();

  const quickAnnouncementTemplate = starterTemplates.getByRole("button", {
    name: /Quick announcement/,
  });
  const templatePreviewCanvas = quickAnnouncementTemplate.locator("canvas");
  await expect(templatePreviewCanvas).toBeVisible();
  await expect.poll(() => canvasPixelGrid(templatePreviewCanvas)).not.toHaveLength(0);
  const templatePixels = await canvasPixelGrid(templatePreviewCanvas);

  await quickAnnouncementTemplate.click();

  await expect(page).toHaveURL(/\/image-editor\/[0-9a-f-]+$/);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const liveArtworkCanvas = page.getByTestId("image-editor-stage").locator("canvas.lower-canvas");
  await expect(liveArtworkCanvas).toBeVisible();
  await expect.poll(() => canvasPixelGrid(liveArtworkCanvas)).not.toHaveLength(0);
  expect(
    meanPixelDifference(templatePixels, await canvasPixelGrid(liveArtworkCanvas)),
  ).toBeLessThan(12);
  await expect(page.getByRole("treeitem", { name: /A clear update, text/ })).toBeVisible();
  await expect(page.getByText("Upload files to build your media library.")).toBeVisible();

  await page.getByRole("button", { name: "Upload or camera" }).click();
  const mediaSourceDialog = page.getByRole("dialog", {
    name: "Add an image",
  });
  await expect(mediaSourceDialog).toBeVisible();
  await expect(mediaSourceDialog.getByRole("tab", { name: "Device", exact: true })).toBeVisible();
  await expect(mediaSourceDialog.getByRole("tab", { name: "Camera", exact: true })).toBeVisible();
  await expect(mediaSourceDialog.getByRole("tab", { name: "Stock media" })).toBeVisible();
  await mediaSourceDialog.locator('input[type="file"]').setInputFiles({
    name: "picker-library.png",
    mimeType: "image/png",
    buffer: tinyPNG,
  });
  await expect(mediaSourceDialog.locator('img[src^="blob:"]')).toHaveCount(1);
  await mediaSourceDialog.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(mediaSourceDialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("treeitem", { name: /picker-library\.png, image/ })).toBeVisible();

  await page.getByRole("button", { name: "Upload or camera" }).click();
  const reopenedPicker = page.getByRole("dialog", { name: "Add an image" });
  await reopenedPicker.getByRole("tab", { name: "Library" }).click();
  await expect(
    reopenedPicker.getByRole("button", { name: "Select picker-library.png" }),
  ).toBeVisible();
  await reopenedPicker.getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("treeitem", { name: /picker-library\.png, image/ })).toHaveCount(0);

  const designCanvas = page.getByRole("application", {
    name: "Design canvas",
  });
  const stage = page.getByTestId("image-editor-stage");
  const [canvasBox, stageBox] = await Promise.all([
    designCanvas.boundingBox(),
    stage.boundingBox(),
  ]);
  if (!canvasBox || !stageBox) {
    throw new Error("OpenPost Image Editor canvas did not produce measurable bounds");
  }

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await expect(page.getByRole("treeitem", { name: /A clear update, text/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const propertiesLayerName = page.getByRole("textbox", {
    name: "Layer name",
  });
  await propertiesLayerName.fill("A clear update draft");
  await expect(page.getByRole("treeitem", { name: /A clear update draft, text/ })).toBeVisible();
  await propertiesLayerName.fill("A clear update");
  await propertiesLayerName.press("Enter");
  await expect(page.getByRole("treeitem", { name: /A clear update, text/ })).toBeVisible();
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
  await expect(page.getByRole("treeitem", { name: /A clear update copy, text/ })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("treeitem", { name: /A clear update copy, text/ })).toHaveCount(0);

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await page.mouse.click(canvasBox.x + 8, canvasBox.y + canvasBox.height / 2);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(0);

  const stagePosition = () =>
    stage.evaluate(
      (element) => (element.parentElement as HTMLElement | null)?.style.transform ?? "",
    );
  const panBefore = await stagePosition();
  await page.keyboard.down("Space");
  await page.mouse.move(canvasBox.x + 12, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 72, canvasBox.y + canvasBox.height / 2 + 36, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(stagePosition).not.toBe(panBefore);

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await page.getByRole("button", { name: "Transform" }).click();
  const curveSelect = page.getByRole("button", { name: "Text curve" });
  await curveSelect.click();
  await page.getByRole("option", { name: "Circle", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "H", exact: true })).toHaveValue("886");
  await curveSelect.click();
  await page.getByRole("option", { name: "Ellipse", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "H", exact: true })).toHaveValue("487");
  await curveSelect.click();
  await page.getByRole("option", { name: "Wave", exact: true }).click();
  await page.getByRole("button", { name: /^Effects(?: \d+ active)?$/ }).click();
  await page.getByRole("button", { name: "Add drop shadow" }).click();
  await expect(page.getByRole("button", { name: "Remove drop shadow" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Remove border" })).toBeVisible();
  await page.getByRole("button", { name: "Border position" }).click();
  await page.getByRole("option", { name: "Outside", exact: true }).click();
  await page.getByRole("button", { name: "Add drop shadow" }).click();
  await expect(page.getByRole("button", { name: "Remove drop shadow" })).toBeVisible();
  await page.getByRole("button", { name: "Add inner shadow" }).click();
  await expect(page.getByRole("button", { name: "Remove inner shadow" })).toBeVisible();
  const shapeSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/v1/image-editor/designs/") &&
      response.request().postData()?.includes('"blend_mode":"multiply"') === true &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Blend mode" }).click();
  await page.getByRole("option", { name: "Multiply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Blend mode" })).toHaveText("Multiply");
  await shapeSaved;

  await page.reload();
  await page.getByRole("treeitem", { name: /Accent, shape/ }).click();
  await page.getByRole("button", { name: /^Effects(?: \d+ active)?$/ }).click();
  await expect(page.getByRole("button", { name: "Mask" })).toHaveText("Diamond");
  await expect(page.getByRole("button", { name: "Blend mode" })).toHaveText("Multiply");
  await expect(page.getByRole("button", { name: "Remove drop shadow" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove inner shadow" })).toBeVisible();
  await expect(page.getByTestId("image-editor-layer-border")).toContainText("Border");
  await expect(page.getByRole("button", { name: "Border position" })).toHaveText("Outside");

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await page.getByRole("button", { name: /^Effects(?: \d+ active)?$/ }).click();
  await expect(page.getByRole("button", { name: "Text curve" })).toHaveText("Wave");
  await expect(page.getByRole("button", { name: "Remove drop shadow" })).toBeVisible();

  await page.getByRole("button", { name: "Magic select" }).click();
  await expect(
    page.getByTestId("image-editor-selection-options").getByText("Tolerance 32"),
  ).toBeVisible();
  const selectionSurface = page.getByTestId("image-editor-selection-surface");
  const selectedPixelCount = () =>
    page.getByTestId("image-editor-pixel-selection").evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return 0;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return 0;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
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
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
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
    throw new Error("OpenPost Image Editor selection surface did not produce layout bounds");
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
      `No unobstructed point was available on the OpenPost Image Editor canvas: ${JSON.stringify({
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
      })}`,
    );
  });
  await page.mouse.click(magicPoint.x, magicPoint.y);
  await expect(page.getByTestId("image-editor-pixel-selection")).toHaveAttribute(
    "data-active",
    "true",
  );
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
  await expect(page.getByRole("menuitem", { name: "Rectangle select" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Ellipse select" }).click();
  const ellipseSlot = page.getByRole("button", { name: "Ellipse select" });
  await ellipseSlot.click();
  await expect(
    page.getByTestId("image-editor-selection-options").getByText("Ellipse select"),
  ).toBeVisible();
  await page.keyboard.press("m");
  await page
    .getByTestId("image-editor-selection-options")
    .getByRole("button", { name: "New" })
    .click();
  const marqueeBounds = await selectionSurface.boundingBox();
  if (!marqueeBounds)
    throw new Error("OpenPost Image Editor selection surface did not produce layout bounds");
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
  if (!selectionBeforeMove) throw new Error("Rectangle selection did not produce pixel bounds");
  const selectionCanvasSize = await page
    .getByTestId("image-editor-pixel-selection")
    .evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
  const selectionStart = {
    x:
      marqueeBounds.x +
      ((selectionBeforeMove.x + selectionBeforeMove.width / 2) / selectionCanvasSize.width) *
        marqueeBounds.width,
    y:
      marqueeBounds.y +
      ((selectionBeforeMove.y + selectionBeforeMove.height / 2) / selectionCanvasSize.height) *
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
  await expect(page.getByRole("button", { name: "Ellipse select" })).toBeVisible();
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
  expect(Math.abs((ellipseBounds?.width ?? 0) - (ellipseBounds?.height ?? 0))).toBeLessThanOrEqual(
    2,
  );

  await page.keyboard.press("l");
  await expect(page.getByRole("button", { name: "Lasso select", pressed: true })).toBeVisible();
  const lassoBounds = await selectionSurface.boundingBox();
  if (!lassoBounds)
    throw new Error("OpenPost Image Editor selection surface did not produce layout bounds");
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
  await expect(page.getByRole("slider", { name: "Roughness 100%" })).toBeVisible();
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
  await expect(page.getByRole("treeitem", { name: /Pencil, paint/ })).toBeVisible();

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
  await expect(page.getByRole("treeitem", { name: /Gradient, paint/ })).toBeVisible();

  await page.keyboard.press("Shift+g");
  await page.mouse.click(
    lassoBounds.x + lassoBounds.width * 0.5,
    lassoBounds.y + lassoBounds.height * 0.72,
  );
  await expect(page.getByRole("treeitem", { name: /Paint bucket, paint/ })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  const mobileTools = page.getByRole("navigation", { name: "Tools" });
  await expect(mobileTools.getByRole("button")).toHaveCount(6);
  await expect(mobileTools.getByRole("button", { name: "Add" })).toBeVisible();
  await expect(mobileTools.getByRole("button", { name: "Select" })).toBeVisible();
  await expect(mobileTools.getByRole("button", { name: "Draw" })).toBeVisible();
  await expect(mobileTools.getByRole("button", { name: "Retouch" })).toBeVisible();
  await mobileTools.getByRole("button", { name: "Select" }).click();
  await expect(page.getByRole("menuitem", { name: "Magic select" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Rectangle select" }).click();
  await mobileTools.getByRole("button", { name: "Select" }).click();
  await expect(page.getByRole("menuitem", { name: "Rectangle select" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Ellipse select" })).toBeVisible();
  await page.keyboard.press("Escape");

  await mobileTools.getByRole("button", { name: "Draw" }).click();
  await page.getByRole("menuitem", { name: /^Text\b/ }).click();
  const fabricTextarea = page.locator('textarea[data-fabric="textarea"]');
  await expect(fabricTextarea).toBeFocused();
  await page.setViewportSize({ width: 390, height: 560 });
  await fabricTextarea.pressSequentially(" on mobile", { delay: 15 });
  await expect(fabricTextarea).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shell = document.querySelector('[data-testid="image-editor-shell"]');
        const textarea = document.querySelector('textarea[data-fabric="textarea"]');
        if (!(shell instanceof HTMLElement) || !(textarea instanceof HTMLElement)) return null;
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
  const bucketHandle = paintBucketRow.getByTestId("image-editor-layer-drag-handle");
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
  await expect(paintBucketRow).toHaveCSS("opacity", "0.6");
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
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label") ?? ""));
      const pencilIndex = labels.findIndex((label) => label.startsWith("Pencil, paint"));
      const bucketIndex = labels.findIndex((label) => label.startsWith("Paint bucket, paint"));
      return pencilIndex >= 0 && bucketIndex >= 0 && pencilIndex < bucketIndex;
    })
    .toBe(true);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redo" })).toBeVisible();
  await expect(mobileTools.getByRole("button")).toHaveCount(6);
  expect(await mobileTools.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
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
                button.getAttribute("aria-label") || button.textContent?.trim() || "unlabelled",
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
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });

  const liveExportPixels = await canvasPixelGrid(liveArtworkCanvas);

  await page.getByRole("button", { name: "Export" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export design" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("radio", { name: "Media", exact: true }).click();
  await exportDialog.getByRole("button", { name: "Export to Media", exact: true }).click();

  await expect(page.getByText("1 exported page saved to Media.")).toBeVisible({
    timeout: 15_000,
  });
  const designID = new URL(page.url()).pathname.split("/").at(-1);
  if (!designID) throw new Error("OpenPost Image Editor URL did not contain a design ID");
  const savedDesign = await request.get(`/api/v1/image-editor/designs/${designID}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
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
      (layer: { paint?: { spans?: unknown[] } }) => (layer.paint?.spans?.length ?? 0) > 0,
    ),
  ).toBeTruthy();

  await page.goto("/editors");
  await expect(page.locator(`a[href="/image-editor/${designID}"]`)).toBeVisible();

  await page.goto("/media");
  const libraryGrid = page.getByTestId("media-library-grid");
  await expect(libraryGrid.locator('[data-library-kind="asset"]')).toHaveCount(2);

  await expect(page.getByText("picker-library.png")).toBeVisible();
  await expect(page.getByText("quick-announcement-page-01.png")).toBeVisible();
  const exportedImage = page.getByRole("img", {
    name: "quick-announcement-page-01.png",
  });
  await expect(exportedImage).toBeVisible();
  await expect.poll(() => imagePixelGrid(exportedImage)).not.toHaveLength(0);
  expect(meanPixelDifference(liveExportPixels, await imagePixelGrid(exportedImage))).toBeLessThan(
    8,
  );
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
  await renameDesignDialog.getByLabel("Project name").fill("Renamed announcement");
  await renameDesignDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(designCard.getByText("Renamed announcement")).toBeVisible();

  await designCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deleteDesignDialog = page.getByRole("dialog", {
    name: "Delete design?",
  });
  await expect(deleteDesignDialog).toBeVisible();
  await deleteDesignDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(designCard).toHaveCount(0);

  expect({ browserErrors, failedResponses }).toEqual({
    browserErrors: [],
    failedResponses: [],
  });
});
