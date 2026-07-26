import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Studio creates from an original template, adapts to mobile, and exports to Media", async ({
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
  const email = `studio-${unique}@example.com`;
  const auth = await registerUser(request, email);
  const workspace = await createWorkspace(request, auth.token, "Studio E2E");

  await authenticatePage(page, auth.token);
  await page.goto(`/studio/new?workspace=${workspace.id}`);

  await expect(
    page.getByRole("heading", { name: "Choose a format" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Starter templates" }),
  ).toBeVisible();

  await page
    .getByRole("region", { name: "Starter templates" })
    .getByRole("button", { name: /Quick announcement/ })
    .click();

  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("application", { name: "Design canvas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: /A clear update, text/ }),
  ).toBeVisible();

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  const curveSelect = page.getByRole("combobox", { name: "Text curve" });
  await curveSelect.selectOption("circle");
  await expect(
    page.getByRole("spinbutton", { name: "H", exact: true }),
  ).toHaveValue("886");
  await curveSelect.selectOption("ellipse");
  await expect(
    page.getByRole("spinbutton", { name: "H", exact: true }),
  ).toHaveValue("487");
  await curveSelect.selectOption("wave");
  await page.getByRole("button", { name: "Add drop shadow" }).click();
  const textSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/v1/studio/designs/") &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Glow" }).click();
  await textSaved;

  await page.getByRole("treeitem", { name: /Accent, shape/ }).click();
  await page.getByRole("combobox", { name: "Mask" }).selectOption("diamond");
  await page.getByRole("button", { name: "Add border" }).click();
  await page
    .getByRole("combobox", { name: "Border position" })
    .selectOption("outside");
  await page.getByRole("button", { name: "Add drop shadow" }).click();
  await page.getByRole("button", { name: "Add inner shadow" }).click();
  const shapeSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/v1/studio/designs/") &&
      response.ok(),
  );
  await page
    .getByRole("combobox", { name: "Blend mode" })
    .selectOption("multiply");
  await shapeSaved;

  await page.reload();
  await page.getByRole("treeitem", { name: /Accent, shape/ }).click();
  await expect(page.getByRole("combobox", { name: "Mask" })).toHaveValue(
    "diamond",
  );
  await expect(page.getByRole("combobox", { name: "Blend mode" })).toHaveValue(
    "multiply",
  );
  await expect(
    page.getByRole("button", { name: "Remove drop shadow" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove inner shadow" }),
  ).toBeVisible();
  await expect(page.getByTestId("studio-layer-border")).toContainText("Border");
  await expect(
    page.getByRole("combobox", { name: "Border position" }),
  ).toHaveValue("outside");

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await expect(page.getByRole("combobox", { name: "Text curve" })).toHaveValue(
    "wave",
  );
  await expect(
    page.getByRole("button", { name: "Remove drop shadow" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Select pixels" }).click();
  await page.getByRole("menuitem", { name: /Magic select/ }).click();
  await expect(
    page.getByTestId("studio-selection-options").getByText("Tolerance 32"),
  ).toBeVisible();
  const selectionSurface = page.getByTestId("studio-selection-surface");
  const selectedPixelCount = () =>
    page.getByTestId("studio-pixel-selection").evaluate((canvas) => {
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
    page.getByTestId("studio-pixel-selection").evaluate((canvas) => {
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
        : { width: maxX - minX + 1, height: maxY - minY + 1 };
    });
  const selectionBox = await selectionSurface.boundingBox();
  if (!selectionBox)
    throw new Error("Studio selection surface did not produce layout bounds");
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
      `No unobstructed point was available on the Studio canvas: ${JSON.stringify(
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
  await expect(page.getByTestId("studio-pixel-selection")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect.poll(selectedPixelCount).toBeGreaterThan(0);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(1);

  await page
    .getByTestId("studio-selection-options")
    .getByRole("button", { name: "Subtract" })
    .click();
  await page.mouse.click(magicPoint.x, magicPoint.y);
  await expect.poll(selectedPixelCount).toBe(0);
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(1);

  await page.keyboard.press("m");
  await expect(
    page.getByRole("button", { name: "Rectangle select" }),
  ).toBeVisible();
  await page
    .getByTestId("studio-selection-options")
    .getByRole("button", { name: "New" })
    .click();
  const marqueeBounds = await selectionSurface.boundingBox();
  if (!marqueeBounds)
    throw new Error("Studio selection surface did not produce layout bounds");
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
    page.getByRole("button", { name: "Lasso select" }),
  ).toBeVisible();
  const lassoBounds = await selectionSurface.boundingBox();
  if (!lassoBounds)
    throw new Error("Studio selection surface did not produce layout bounds");
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
    .getByTestId("studio-selection-options")
    .getByRole("button", { name: "Deselect" })
    .click();
  await page.keyboard.press("p");
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
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select objects" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select objects" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Magic select" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Select pixels" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Magic select" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Text", exact: true }).click();
  const fabricTextarea = page.locator('textarea[data-fabric="textarea"]');
  await expect(fabricTextarea).toBeFocused();
  await page.setViewportSize({ width: 390, height: 560 });
  await fabricTextarea.pressSequentially(" on mobile", { delay: 15 });
  await expect(fabricTextarea).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shell = document.querySelector('[data-testid="studio-shell"]');
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
  const bucketHandle = paintBucketRow.getByTestId("studio-layer-drag-handle");
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

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBe(0);

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
  ).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "Export" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export design" });
  await expect(exportDialog).toBeVisible();
  await exportDialog
    .getByRole("button", { name: "Media", exact: true })
    .click();
  await exportDialog
    .getByRole("button", { name: "Export to Media", exact: true })
    .click();

  await expect(page.getByText("1 exported page saved to Media.")).toBeVisible();
  const designID = new URL(page.url()).pathname.split("/").at(-1);
  if (!designID) throw new Error("Studio URL did not contain a design ID");
  const savedDesign = await request.get(`/api/v1/studio/designs/${designID}`, {
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
      (layer: { paint?: { spans?: unknown[] } }) =>
        (layer.paint?.spans?.length ?? 0) > 0,
    ),
  ).toBeTruthy();

  await page.goto("/media");
  const libraryGrid = page.getByTestId("media-library-grid");
  await expect(libraryGrid.locator('[data-library-kind="design"]')).toHaveCount(
    1,
  );
  await expect(libraryGrid.locator('[data-library-kind="asset"]')).toHaveCount(
    1,
  );
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
  expect({ browserErrors, failedResponses }).toEqual({
    browserErrors: [],
    failedResponses: [],
  });
});
