import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Studio creates from an original template, adapts to mobile, and exports to Media", async ({
  page,
  request,
}) => {
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

  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rectangle", exact: true }).click();
  await page.getByRole("combobox", { name: "Mask" }).selectOption("diamond");
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
  await page.getByRole("treeitem", { name: /Rectangle, shape/ }).click();
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

  await page.getByRole("treeitem", { name: /A clear update, text/ }).click();
  await expect(page.getByRole("combobox", { name: "Text curve" })).toHaveValue(
    "wave",
  );
  await expect(
    page.getByRole("button", { name: "Remove drop shadow" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("menuitem", { name: /Magic select/ }).click();
  await expect(
    page.getByTestId("studio-selection-options").getByText("Tolerance 12%"),
  ).toBeVisible();
  const selectionSurface = page.getByTestId("studio-selection-surface");
  await selectionSurface.click();
  await expect(page.locator(".studio-magic-pulse")).toBeVisible();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();

  await page
    .getByTestId("studio-selection-options")
    .getByRole("button", { name: "Subtract" })
    .click();
  await selectionSurface.click();
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(0);

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
  await expect(
    page.getByRole("treeitem", { name: /Accent, shape/, selected: true }),
  ).toBeVisible();
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(1);

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
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();
  await page.getByRole("button", { name: "Lasso select" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Magic select" }),
  ).toBeVisible();
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
  await page.goto("/media");
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
