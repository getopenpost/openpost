import { mkdir, rm } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const screenshotDirectory = "/tmp/openpost-150-editor-chrome";
const themes = [
  { id: "workshop", scheme: "light" },
  { id: "supabase", scheme: "dark" },
] as const;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function assignTheme(
  request: APIRequestContext,
  token: string,
  workspaceID: string,
  themeID: string,
): Promise<void> {
  const response = await request.put(`/api/v1/theme-assignments/${workspaceID}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { reference: { kind: "built_in", id: themeID, version: 1 } },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function createVideoProject(page: Page, name = "Shared editor chrome"): Promise<string> {
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
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Local only" }).click();
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 20_000,
  });
  return page.url();
}

async function verifySequenceAutoBalance(page: Page, errors: string[]): Promise<void> {
  await page.getByRole("button", { name: "Add layer" }).click();
  await page.getByRole("menuitem", { name: "Add text" }).click();
  await expect(page.getByRole("application", { name: "Program" }).getByRole("img")).toBeVisible();
  const editTab = page.getByRole("tab", { name: "Edit", exact: true });
  const colorTab = page.getByRole("tab", { name: "Color", exact: true });
  await expect(editTab).toHaveAttribute("aria-selected", "true");
  await colorTab.click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("openpost-video-editor-workspace-v1")))
    .toBe("color");
  await expect(colorTab).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
  await expect(page.getByRole("region", { name: "Color grading" })).toBeVisible({
    timeout: 20_000,
  });
  const autoKey = page.getByRole("button", { name: "Toggle auto-keyframe" });
  await autoKey.click();
  await expect(autoKey).toHaveAttribute("aria-pressed", "true");
  const liftWheel = page.getByRole("slider", { name: "Lift color wheel" });
  await liftWheel.focus();
  await page.keyboard.press("ArrowRight");
  await expect(liftWheel).toHaveAttribute("aria-valuetext", /^1 degrees/);
  const curve = page.locator('[role="group"][aria-label="Master curve editor"]:visible');
  const initialCurvePointCount = await curve.locator("[data-curve-point]").count();
  expect(initialCurvePointCount).toBeGreaterThanOrEqual(2);
  await curve.click({ position: { x: 75, y: 35 } });
  await expect(curve.locator("[data-curve-point]")).toHaveCount(initialCurvePointCount + 1);

  await editTab.click();
  await page.getByRole("button", { name: "Add layer" }).click();
  await page.getByRole("menuitem", { name: "Add text" }).click();
  const timelineItems = page.locator("[data-timeline-item-id]");
  await expect(timelineItems).toHaveCount(2);
  await timelineItems
    .first()
    .locator("button")
    .first()
    .click({ modifiers: ["ControlOrMeta"] });
  await colorTab.click();
  await expect(page.getByRole("slider", { name: "Lift color wheel" })).toHaveAttribute(
    "aria-valuetext",
    "Mixed",
  );
  await page.getByRole("slider", { name: "Lift color wheel" }).press("ArrowRight");
  await expect(page.getByRole("slider", { name: "Lift color wheel" })).not.toHaveAttribute(
    "aria-valuetext",
    "Mixed",
  );
  await page
    .getByRole("group", { name: "Color workspace Clip" })
    .getByRole("button", { name: "Sequences" })
    .click();
  await page.getByRole("button", { name: "Add adjustment layer" }).click();
  await expect(page.getByRole("region", { name: "Color grading" })).toHaveAttribute(
    "data-sequence-grade-item-id",
    /.+/,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("button", { name: "Add adjustment layer" })).toBeVisible();
  await page.getByRole("button", { name: "Add adjustment layer" }).click();
  await page.getByRole("application", { name: "Program" }).click({ position: { x: 8, y: 8 } });
  await expect(page.locator('[data-scope-sample-ready="true"]')).toBeVisible();
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Auto balance from the current frame" }).click();
  await expect(page.getByText("Auto balance applied.")).toBeVisible({
    timeout: 5_000,
  });
}

async function createImageDesign(page: Page): Promise<string> {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
    timeout: 20_000,
  });
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload or camera" }).click();
  await (
    await fileChooser
  ).setFiles({
    name: "color-source.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await expect(page.getByRole("textbox", { name: "Layer name" })).toHaveValue("color-source.png");
  const saveIndicator = page.getByTestId("image-editor-save-indicator");
  await expect(saveIndicator).toHaveAttribute("data-state", "idle");
  await expect(saveIndicator).toHaveAttribute("data-state", "saved", {
    timeout: 10_000,
  });
  await page.reload();
  await expect(page.getByRole("tree", { name: "Layers" })).toContainText("color-source.png");
  return page.url();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth,
      ),
    )
    .toBe(true);
}

async function designCanvasCenterPixel(page: Page): Promise<number[]> {
  return page
    .getByRole("application", { name: "Design canvas" })
    .locator("canvas.lower-canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Design canvas has no 2D context");
      return [
        ...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1)
          .data,
      ];
    });
}

test.beforeAll(async () => {
  await rm(screenshotDirectory, { force: true, recursive: true });
  await mkdir(screenshotDirectory, { recursive: true });
});

test("Sequence Auto Balance samples the composed frame without changing clip selection", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  const { token } = await registerUser(request, "sequence-color-sampling@example.com");
  await createWorkspace(request, token, "Sequence color sampling");
  await authenticatePage(page, token);
  await createVideoProject(page, "Sequence color sampling");
  await verifySequenceAutoBalance(page, errors);
  expect(errors).toEqual([]);
});

test("shared editor chrome and Color workspaces fit desktop and narrow phones", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401 (Unauthorized)")) {
      errors.push(message.text().slice(0, 300));
    }
  });

  const { token } = await registerUser(request, "editor-chrome-color@example.com");
  const workspace = await createWorkspace(request, token, "Shared editor chrome");
  await authenticatePage(page, token);
  const videoURL = await createVideoProject(page);
  const imageURL = await createImageDesign(page);

  for (const theme of themes) {
    await assignTheme(request, token, workspace.id, theme.id);
    for (const width of [1440, 390, 320] as const) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.emulateMedia({
        colorScheme: theme.scheme,
        reducedMotion: width === 320 ? "reduce" : "no-preference",
      });

      await page.goto(videoURL);
      if (width === 320) {
        await page.getByRole("banner").getByRole("button", { name: "More actions" }).click();
        await expect(page.getByRole("textbox", { name: "Project name" })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: /Split/ })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: "New sequence" })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      const videoWorkspaces = page.getByRole("tablist", {
        name: "Editor workspaces",
      });
      await expect(videoWorkspaces).toBeVisible();
      const videoColorTab = videoWorkspaces.getByRole("tab", {
        name: "Color",
        exact: true,
      });
      if (width === 1440) {
        await videoWorkspaces.getByRole("tab", { name: "Edit", exact: true }).focus();
        await page.keyboard.press("ArrowRight");
        await expect(videoColorTab).toHaveAttribute("aria-selected", "true");
      } else {
        await videoColorTab.click();
      }
      await expect(page.getByRole("region", { name: "Color grading" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.getByRole("group", { name: "Color workspace Clip" }).getByRole("button", {
          name: "Clip",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      if (width === 1440) {
        await page
          .getByRole("group", { name: "Color workspace Clip" })
          .getByRole("button", { name: "Sequences" })
          .click();
        const addSequenceGrade = page.getByRole("button", {
          name: "Add adjustment layer",
        });
        if (await addSequenceGrade.isVisible()) await addSequenceGrade.click();
        await expect(page.getByRole("region", { name: "Color workspace" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Show all scopes" })).toBeVisible();
        await page.getByRole("button", { name: "Show all scopes" }).click();
        await expect(page.locator("[data-color-scope-canvas]")).toHaveCount(4);
        await page.getByRole("menubar").getByText("Clip", { exact: true }).click();
        await expect(page.getByRole("menuitem", { name: /Split/ })).toBeVisible();
        await page.keyboard.press("Escape");
        await page.getByRole("menubar").getByText("Sequences", { exact: true }).click();
        await expect(page.getByRole("menuitem", { name: "New sequence" })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: `${screenshotDirectory}/video-${width}-${theme.id}-${theme.scheme}.png`,
        animations: "disabled",
      });

      await page.goto(imageURL);
      await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
      if (width === 320) {
        await page.getByRole("banner").getByRole("button", { name: "More actions" }).click();
        const mobileTitle = page.getByRole("textbox", { name: "Design title" });
        await expect(mobileTitle).toBeVisible();
        await mobileTitle.fill("Mobile title");
        await expect(mobileTitle).toHaveValue("Mobile title");
        await page.keyboard.press("Escape");
      }
      await page.screenshot({
        path: `${screenshotDirectory}/image-edit-${width}-${theme.id}-${theme.scheme}.png`,
        animations: "disabled",
      });
      const imageColorTab = page.locator("#image-editor-workspace-tab-color");
      if (width === 1440) {
        await page.locator("#image-editor-workspace-tab-edit").focus();
        await page.keyboard.press("ArrowRight");
        await expect(imageColorTab).toHaveAttribute("aria-selected", "true");
      } else {
        await imageColorTab.click();
      }
      await expect(page.locator(".image-editor-workspace")).toHaveAttribute(
        "data-workspace",
        "color",
      );
      await expect(page.locator("[data-image-color-workspace]:visible")).toBeVisible();
      await expect(page.locator("[data-editor-color-control]:visible")).toHaveCount(10);
      if (width === 1440) {
        const scope = page.getByRole("group", { name: "Color Layers" });
        await page.getByRole("tree", { name: "Layers" }).getByText("color-source.png").click();
        await scope.getByRole("button", { name: "Layer", exact: true }).click();
        await expect(page.locator("[data-editor-color-control]:visible")).toHaveCount(11);
        await scope.getByRole("button", { name: "Pages" }).click();
        if (theme.id === "workshop") {
          const originalPixel = await designCanvasCenterPixel(page);
          await page.getByRole("button", { name: "Warm", exact: true }).click();
          await expect.poll(() => designCanvasCenterPixel(page)).not.toEqual(originalPixel);
          const gradedPixel = await designCanvasCenterPixel(page);

          await page.getByRole("button", { name: /^Undo/ }).click();
          await expect.poll(() => designCanvasCenterPixel(page)).toEqual(originalPixel);
          await page.getByRole("button", { name: /^Redo/ }).click();
          await expect.poll(() => designCanvasCenterPixel(page)).toEqual(gradedPixel);

          const saveIndicator = page.getByTestId("image-editor-save-indicator");
          await expect(saveIndicator).toHaveAttribute("data-state", "saved", {
            timeout: 10_000,
          });
          await page.reload();
          await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
          await expect.poll(() => designCanvasCenterPixel(page)).toEqual(gradedPixel);
          await page.locator("#image-editor-workspace-tab-color").click();
        }
        await expect(page.getByRole("button", { name: "Before", exact: true })).toBeEnabled();
        const gradedPixel = await designCanvasCenterPixel(page);
        await page.getByRole("button", { name: "Before", exact: true }).click();
        await expect.poll(() => designCanvasCenterPixel(page)).not.toEqual(gradedPixel);
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: `${screenshotDirectory}/image-color-${width}-${theme.id}-${theme.scheme}.png`,
        animations: "disabled",
      });
    }
  }

  expect(errors, errors.join(" | ")).toEqual([]);
});
