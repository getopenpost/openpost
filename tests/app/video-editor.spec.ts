import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
}

async function addTextItem(page: Page): Promise<void> {
  await page
    .getByRole("complementary", { name: "Assets" })
    .getByRole("button", { name: "Add layer" })
    .click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
}

async function openHeaderMoreMenu(page: Page): Promise<void> {
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
}

test("Video Editor quick export saves an MP4 in the workspace", async ({ page }) => {
  test.setTimeout(90_000);
  const projectName = "Quick export proof";
  await createProject(page, projectName);
  await addTextItem(page);

  await openHeaderMoreMenu(page);
  await page.getByRole("menuitem", { name: "Export MP4" }).click();
  await expect(page.getByText(`Saved ${projectName}.mp4 to the exports folder.`)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "Exports" }).click();
  await expect(page.getByText(`${projectName}.mp4`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Download ${projectName}.mp4` })).toBeEnabled();
});

test("Video Editor sends a rendered export into a new composer", async ({ page, request }) => {
  test.setTimeout(90_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `video-editor-send-${unique}@example.com`);
  await createWorkspace(request, auth.token, "Video Editor send E2E");
  await authenticatePage(page, auth.token);
  await createProject(page, "Composer send proof", { selectLocalProjects: true });
  await addTextItem(page);

  await openHeaderMoreMenu(page);
  await page.getByRole("menuitem", { name: "Send to OpenPost" }).click();
  const openComposer = page.getByRole("menuitem", { name: "Open composer" });
  await expect(openComposer).toBeVisible({
    timeout: 60_000,
  });

  await openComposer.click();
  await expect(page.locator("[data-composer-media-id]")).toHaveCount(1);
  await expect(page).toHaveURL(/\/$/u);
});

test("Video Editor opens the full export dialog from a live project", async ({ page }) => {
  await createProject(page, "Full export dialog proof");
  await addTextItem(page);

  await page.getByRole("button", { name: "Render full video" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Render now" })).toBeEnabled();
});

test("Video Editor project library and shell fit narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Responsive review");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.setViewportSize({ width: 320, height: 720 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test("timeline hover preview stays outside track headers and uses one navigator", async ({
  page,
}) => {
  await createProject(page, "Timeline boundaries");
  await addTextItem(page);
  const timeline = page.locator("#video-editor-timeline-scroll");
  const bounds = await timeline.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 185, bounds!.y + 50);
  const readout = page.locator("[data-timeline-preview-timecode]");
  await expect(readout).toBeVisible();
  await page.screenshot({
    path: `/tmp/openpost-timeline-${process.env.OPENPOST_CAPTURE_PHASE ?? "after"}.png`,
  });
  const readoutBounds = await readout.boundingBox();
  // Track controls occupy the first 180 pixels of the scrolling viewport.
  expect(readoutBounds!.x).toBeGreaterThanOrEqual(bounds!.x + 180);

  for (let index = 0; index < 6; index++)
    await page.getByRole("button", { name: "Zoom in", exact: true }).last().click();
  await timeline.evaluate((element) => {
    element.scrollLeft = 240;
  });
  await page.mouse.move(bounds!.x + bounds!.width - 8, bounds!.y + 50);
  await expect(readout).toBeVisible();
  const rightBounds = await readout.boundingBox();
  expect(rightBounds!.x + rightBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  await page.mouse.move(bounds!.x + 40, bounds!.y + 50);
  await expect(readout).toBeHidden();
  await expect(page.locator("[data-timeline-navigator]")).toBeVisible();
  expect(await timeline.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe("none");
});

test("imports video and a photo, places both, and reopens the timeline", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createProject(page, "Imported media proof");
  const files = await Promise.all(
    ["study-sos-demo.mp4", "lisbon-tram.png"].map(async (name) => ({
      name,
      bytes: (
        await readFile(
          fileURLToPath(new URL(`./fixtures/product-screenshots/${name}`, import.meta.url)),
        )
      ).toString("base64"),
    })),
  );
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    const imports = await root.getDirectoryHandle("test-imports", { create: true });
    const handles = [];
    for (const file of files) {
      const handle = await imports.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(
        Uint8Array.from(atob(file.bytes), (character) => character.charCodeAt(0)),
      );
      await writable.close();
      handles.push(handle);
    }
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => handles,
    });
  }, files);
  await page.getByRole("button", { name: "Import media", exact: true }).click();
  for (const name of ["study-sos-demo.mp4", "lisbon-tram.png"]) {
    const place = page.getByRole("button", { name: `Place on timeline: ${name}`, exact: true });
    await expect(place).toBeVisible({ timeout: 30000 });
    await place.click();
    await page.keyboard.press("Enter");
  }
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(
    page.getByRole("banner").getByText("All changes saved locally", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(2);
  for (let index = 0; index < 4; index++)
    await page.getByRole("button", { name: "Zoom out", exact: true }).last().click();
  const clip = page
    .locator("[data-timeline-item-id]")
    .filter({ has: page.getByRole("button", { name: /^study-sos-demo.mp4\. Drag/ }) });
  await clip.getByRole("button", { name: /^study-sos-demo.mp4\. Drag/ }).focus();
  await page.keyboard.press("r");
  const edge = clip.getByRole("button", { name: "Rate stretch clip", exact: true }).last();
  await expect(edge).toBeVisible();
  const edgeBounds = await edge.boundingBox();
  const originalWidth = (await clip.boundingBox())!.width;
  await page.mouse.move(
    edgeBounds!.x + edgeBounds!.width / 2,
    edgeBounds!.y + edgeBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(edgeBounds!.x - 45, edgeBounds!.y + edgeBounds!.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(errors).toEqual([]);
  await expect.poll(async () => (await clip.boundingBox())!.width).toBeLessThan(originalWidth);
  expect(errors).toEqual([]);
});
