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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fits =
          document.body.scrollWidth <= window.innerWidth &&
          document.documentElement.scrollWidth <= window.innerWidth;
        if (fits) return "fits";
        const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.right > window.innerWidth + 1 || bounds.left < -1;
          })
          .slice(0, 8)
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
        return `${document.body.scrollWidth}/${window.innerWidth}: ${offenders.join(" | ")}`;
      }),
    )
    .toBe("fits");
}

async function expectMinimumTargets(
  locator: ReturnType<Page["getByRole"]>,
  minimum = 44,
): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluateAll(
        (elements, min) =>
          elements.length > 0 &&
          elements.every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width >= min && bounds.height >= min;
          }),
        minimum,
      ),
    )
    .toBe(true);
}

async function expectMinimumHeight(
  locator: ReturnType<Page["locator"]>,
  minimum: number,
): Promise<void> {
  await expect
    .poll(() => locator.evaluate((element) => Math.round(element.getBoundingClientRect().height)))
    .toBeGreaterThanOrEqual(minimum);
}

async function createProject(page: Page, name: string): Promise<void> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
}

async function seedTranscriptEditProject(page: Page): Promise<void> {
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  if (!projectId) throw new Error("Video Editor project id is missing from the URL.");

  await page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle("projects");
    const projectDirectory = await projects.getDirectoryHandle(id);
    const projectFile = await projectDirectory.getFileHandle("project.json");
    const project = JSON.parse(await (await projectFile.getFile()).text());
    project.duration = 7;
    project.updatedAt = Date.now();
    project.timeline = {
      tracks: [
        {
          id: "captions",
          name: "Captions",
          kind: "video",
          height: 64,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        },
        {
          id: "video",
          name: "Video",
          kind: "video",
          height: 96,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
        },
        {
          id: "audio",
          name: "Audio",
          kind: "audio",
          height: 72,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          volume: 1,
          order: 2,
        },
      ],
      items: [
        {
          id: "video-primary",
          trackId: "video",
          from: 0,
          durationInFrames: 90,
          label: "Interview video",
          type: "video",
          mediaId: "interview-media",
          linkedGroupId: "primary-av",
          sourceStart: 0,
          sourceEnd: 90,
          sourceFps: 30,
          speed: 1,
        },
        {
          id: "audio-primary",
          trackId: "audio",
          from: 0,
          durationInFrames: 90,
          label: "Interview audio",
          type: "audio",
          mediaId: "interview-media",
          linkedGroupId: "primary-av",
          sourceStart: 0,
          sourceEnd: 90,
          sourceFps: 30,
          speed: 1,
        },
        {
          id: "video-later",
          trackId: "video",
          from: 120,
          durationInFrames: 90,
          label: "Later video",
          type: "video",
          mediaId: "interview-media",
          linkedGroupId: "later-av",
          sourceStart: 0,
          sourceEnd: 90,
          sourceFps: 30,
          speed: 1,
        },
        {
          id: "audio-later",
          trackId: "audio",
          from: 120,
          durationInFrames: 90,
          label: "Later audio",
          type: "audio",
          mediaId: "interview-media",
          linkedGroupId: "later-av",
          sourceStart: 0,
          sourceEnd: 90,
          sourceFps: 30,
          speed: 1,
        },
        {
          id: "transcript-captions",
          trackId: "captions",
          from: 0,
          durationInFrames: 90,
          label: "Interview captions",
          type: "subtitle",
          captionSource: {
            type: "transcript",
            clipId: "video-primary",
            mediaId: "interview-media",
            sourceStartSeconds: 0,
            playbackSpeed: 1,
          },
          cues: [
            {
              id: "cue",
              startFrame: 0,
              endFrame: 90,
              text: "Please um continue",
              words: [
                { id: "please", startFrame: 0, endFrame: 25, text: "Please" },
                { id: "um", startFrame: 30, endFrame: 45, text: "um" },
                { id: "continue", startFrame: 50, endFrame: 90, text: "continue" },
              ],
            },
          ],
        },
      ],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
    };

    const writable = await projectFile.createWritable();
    await writable.write(JSON.stringify(project));
    await writable.close();
  }, projectId);

  await page.reload();
  await expect(page.locator('[data-timeline-item-id="video-primary"]')).toBeVisible();
  const recoveryDialog = page.getByRole("dialog", { name: "Restore project media" });
  if (await recoveryDialog.isVisible()) {
    await recoveryDialog.getByRole("button", { name: "Work offline" }).click();
  }
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

test("A new Video Editor project starts centered in Fit view", async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, "First zoom project");
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole("button", { name: "Preview zoom: Fit" }).click();
  await page.getByRole("menuitem", { name: "75%" }).click();
  await expect(page.getByRole("button", { name: "Preview zoom: 75%" })).toBeVisible();

  await page.goto("/video-editor");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Fresh fit project");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("button", { name: "Preview zoom: Fit" })).toBeVisible();

  const pasteboard = await page.locator("[data-program-pasteboard]").boundingBox();
  const monitor = await page.locator("[data-program-monitor]").boundingBox();
  expect(pasteboard).not.toBeNull();
  expect(monitor).not.toBeNull();
  expect(
    Math.abs(monitor!.x + monitor!.width / 2 - (pasteboard!.x + pasteboard!.width / 2)),
  ).toBeLessThan(2);
  expect(
    Math.abs(monitor!.y + monitor!.height / 2 - (pasteboard!.y + pasteboard!.height / 2)),
  ).toBeLessThan(2);
});

test("Motion owns an isolated composition session and restores Edit", async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, "Motion workspace proof");
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole("tab", { name: "Motion" }).click();
  const emptyPreview = page.getByRole("region", { name: "Motion" });
  await expect(
    emptyPreview.getByRole("heading", { name: "Start a motion composition" }),
  ).toBeVisible();
  await expect(page.locator("[data-motion-timeline-empty]")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sequences" })).toHaveCount(0);

  await emptyPreview.getByRole("button", { name: "New composition" }).click();
  const dialog = page.getByRole("dialog", { name: "New composition" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Launch card");
  await dialog.getByLabel("Width").fill("1080");
  await dialog.getByLabel("Height").fill("1080");
  await dialog.getByLabel("Frame rate").fill("60");
  await dialog.getByLabel("Duration (seconds)").fill("6");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByTestId("composition-timeline")).toBeVisible();
  await expect(page.getByTestId("composition-fps")).toHaveValue("60");
  await expect(page.getByTestId("composition-duration")).toHaveValue("360");
  await expect(page.locator("[data-motion-preview-empty]")).toHaveCount(0);

  await page.getByTestId("add-layer-text").click();
  const motionInspector = page.getByRole("complementary", { name: "Motion" });
  await expect(motionInspector.getByRole("searchbox", { name: "Search animation" })).toBeVisible();
  await expect(motionInspector.getByRole("button", { name: "Compatible" })).toBeVisible();
  await expect(motionInspector.getByRole("heading", { name: "Entrance" })).toBeVisible();

  await page.getByRole("tab", { name: "Edit" }).click();
  await expect(page.getByRole("navigation", { name: "Sequences" })).toBeVisible();
  await expect(page.getByTestId("composition-timeline")).toHaveCount(0);

  await page.getByRole("tab", { name: "Motion" }).click();
  await expect(page.getByTestId("composition-timeline")).toBeVisible();
  await expect(page.getByTestId("composition-picker")).toContainText("Launch card");
  const reopenedMotionInspector = page.getByRole("complementary", {
    name: "Motion",
  });
  const animationSearch = reopenedMotionInspector.getByRole("searchbox", {
    name: "Search animation",
  });
  await expect(animationSearch).toBeAttached();
  await expect(page.getByText("Composition created", { exact: true })).toBeHidden({
    timeout: 6_000,
  });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-motion-canvas-1280.png",
    fullPage: true,
  });
  await animationSearch.scrollIntoViewIfNeeded();
  await expect(animationSearch).toBeVisible();
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-motion-animations-1280.png",
    fullPage: true,
  });
});

test("Edit creates and reopens a selected Motion clip", async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, "Motion clip proof");
  await page.setViewportSize({ width: 1280, height: 800 });
  await addTextItem(page);

  const editInspector = page.getByRole("complementary", { name: "Edit" });
  await editInspector.getByRole("tab", { name: "Motion" }).click();
  await expect(editInspector.getByRole("heading", { name: "Motion clip" })).toBeVisible();
  await editInspector.getByRole("button", { name: "Create motion clip" }).click();

  await expect(page.getByRole("tab", { name: "Motion" }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("composition-timeline")).toBeVisible();
  await expect(page.getByTestId("composition-picker")).toContainText("Your text Motion");

  await page.getByRole("tab", { name: "Edit" }).click();
  const restoredInspector = page.getByRole("complementary", { name: "Edit" });
  await restoredInspector.getByRole("tab", { name: "Motion" }).click();
  await restoredInspector.getByRole("button", { name: "Open in Motion" }).click();
  await expect(page.getByTestId("composition-timeline")).toBeVisible();
  await expect(page.getByTestId("composition-picker")).toContainText("Your text Motion");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-motion-clip-1280.png",
    fullPage: true,
  });
});

test("Video Editor project shell stays usable at phone and desktop widths", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleFailures: string[] = [];
  page.on("pageerror", (error) => consoleFailures.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleFailures.push(`${message.type()}: ${message.text()}`);
    }
  });
  await createProject(page, "Responsive route proof");

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expectMinimumTargets(
      page.getByRole("tablist", { name: "Editor workspaces" }).getByRole("tab"),
    );
    await page.getByRole("tab", { name: "Color" }).click();
    const colorDock = page.getByRole("region", { name: "Color grading" });
    await expect(colorDock).toBeVisible();
    await expect(colorDock.getByRole("region", { name: "Timeline overview" })).toBeVisible();
    await expect(colorDock.getByRole("slider", { name: "Timeline playhead" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Scopes" })).toBeVisible();
    await expect(page.locator("footer")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("tab", { name: "Edit" }).click();
    const mobilePanels = page.getByRole("navigation", {
      name: "Editor panels",
    });
    await expect(mobilePanels).toBeVisible();
    await expectMinimumTargets(mobilePanels.getByRole("button"));
    const preview = page.locator("[data-video-preview]");
    const pasteboard = page.locator("[data-program-pasteboard]");
    const assetsButton = mobilePanels.getByRole("button", {
      name: "Assets",
      exact: true,
    });
    const programButton = mobilePanels.getByRole("button", {
      name: "Program",
      exact: true,
    });
    const editButton = mobilePanels.getByRole("button", {
      name: "Edit",
      exact: true,
    });
    await expect(assetsButton).toHaveAttribute("aria-controls", "video-editor-assets-panel");
    await expect(programButton).toHaveAttribute("aria-controls", "video-editor-program-panel");
    await expect(editButton).toHaveAttribute("aria-controls", "video-editor-tools-panel");

    await assetsButton.click();
    await expect(preview).toBeVisible();
    await expectMinimumHeight(preview, 176);
    await expectMinimumHeight(pasteboard, 96);
    const assetsPanel = page.getByRole("complementary", { name: "Assets" });
    const navigationBounds = await mobilePanels.boundingBox();
    const assetsBounds = await assetsPanel.boundingBox();
    const assetsPreviewBounds = await preview.boundingBox();
    expect(navigationBounds).not.toBeNull();
    expect(assetsBounds).not.toBeNull();
    expect(assetsPreviewBounds).not.toBeNull();
    expect(navigationBounds!.y + navigationBounds!.height).toBeLessThanOrEqual(assetsBounds!.y + 1);
    expect(assetsBounds!.y + assetsBounds!.height).toBeLessThanOrEqual(assetsPreviewBounds!.y + 1);

    const toolTabs = assetsPanel.getByRole("tablist", { name: "Assets" }).getByRole("tab");
    await expect(toolTabs).toHaveCount(11);
    for (const name of [
      "Media pool",
      "Stock",
      "Text",
      "Shapes",
      "Backgrounds",
      "Stickers",
      "Effects",
      "Transition",
      "Lottie",
      "Transcript",
      "Create",
    ]) {
      await expect(assetsPanel.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    await expectMinimumTargets(toolTabs);
    const mobileToolList = assetsPanel.getByRole("tablist", { name: "Assets" });
    await expect
      .poll(() => mobileToolList.evaluate((element) => element.clientWidth))
      .toBe(viewport.width);
    await expect
      .poll(() =>
        mobileToolList.evaluate((element) => Math.round(element.getBoundingClientRect().height)),
      )
      .toBeGreaterThanOrEqual(52);
    await expect
      .poll(() =>
        mobileToolList.evaluate((element) => Math.round(element.getBoundingClientRect().height)),
      )
      .toBeLessThanOrEqual(54);
    await assetsPanel.getByRole("tab", { name: "Transition", exact: true }).click();
    await expect(assetsPanel.getByRole("heading", { name: "Transition" })).toBeVisible();
    await expect(assetsPanel.locator("[data-transition-catalog-id]")).toHaveCount(44);
    await expect(assetsPanel.getByRole("button", { name: "Import media" })).toHaveCount(0);
    await assetsPanel.getByRole("tab", { name: "Effects", exact: true }).click();
    await expect(assetsPanel.locator('[data-effect-catalog-id^="gpu-"]')).toHaveCount(54);
    await expectMinimumHeight(page.locator("#video-editor-left-tool-panel"), 96);

    await editButton.click();
    await expect(preview).toBeVisible();
    await expectMinimumHeight(preview, 176);
    await expectMinimumHeight(pasteboard, 96);
    const toolsPanel = page.getByRole("complementary", { name: "Edit" });
    const editPreviewBounds = await preview.boundingBox();
    const toolsBounds = await toolsPanel.boundingBox();
    expect(editPreviewBounds).not.toBeNull();
    expect(toolsBounds).not.toBeNull();
    expect(navigationBounds!.y + navigationBounds!.height).toBeLessThanOrEqual(
      editPreviewBounds!.y + 1,
    );
    expect(editPreviewBounds!.y + editPreviewBounds!.height).toBeLessThanOrEqual(
      toolsBounds!.y + 1,
    );
    const tools = page.getByRole("heading", { name: "Edit", exact: true }).locator("..");
    await expect(tools).toBeVisible();
    await expect
      .poll(() =>
        tools.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
      )
      .toMatchObject({
        clientWidth: viewport.width,
        scrollWidth: viewport.width,
      });
    const exportBounds = await page
      .getByRole("button", { name: "Render full video" })
      .boundingBox();
    const timelineBounds = await page
      .getByText("Timeline", { exact: true })
      .locator("..")
      .boundingBox();
    expect(exportBounds).not.toBeNull();
    expect(timelineBounds).not.toBeNull();
    expect(exportBounds!.width).toBeGreaterThanOrEqual(44);
    expect(exportBounds!.height).toBeGreaterThanOrEqual(44);
    expect(exportBounds!.y + exportBounds!.height).toBeLessThanOrEqual(timelineBounds!.y);
    await expectMinimumTargets(page.getByRole("slider", { name: "Zoom" }));
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `frontend/.svelte-kit/openpost-video-editor-${viewport.width}.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("tab", { name: "Color" }).click();
  const colorDock = page.getByRole("region", { name: "Color grading" });
  await expect(colorDock).toBeVisible();
  await expect(colorDock.getByRole("region", { name: "Timeline overview" })).toBeVisible();
  await expect(colorDock.getByRole("slider", { name: "Timeline playhead" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Scopes" })).toBeVisible();
  await expect(page.locator("footer")).toHaveCount(0);
  await page.getByRole("tab", { name: "Edit" }).click();
  await expect(page.getByRole("navigation", { name: "Editor panels" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Edit", exact: true })).toBeVisible();

  const mediaPool = page.getByRole("complementary", { name: "Assets" });
  await mediaPool.getByRole("tab", { name: "Media pool", exact: true }).click();
  await expect(
    mediaPool.getByRole("button", {
      name: "Media",
      pressed: true,
      exact: true,
    }),
  ).toBeVisible();
  await expect(mediaPool.getByRole("button", { name: "Import media" })).toBeVisible();
  await mediaPool.getByRole("button", { name: "Scenes" }).click();
  await expect(mediaPool.getByRole("button", { name: "Scenes", pressed: true })).toBeVisible();
  await expect(mediaPool.getByRole("button", { name: "Import media" })).toHaveCount(0);
  const desktopTools = mediaPool.getByRole("tablist", { name: "Assets" });
  await expect(desktopTools).toHaveAttribute("aria-orientation", "vertical");
  await expect(desktopTools.getByRole("tab")).toHaveCount(11);
  await mediaPool.getByRole("tab", { name: "Stock", exact: true }).click();
  await expect(mediaPool.getByRole("tab", { name: "Stock", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(mediaPool.getByRole("button", { name: "Import media" })).toHaveCount(0);
  await mediaPool.getByRole("tab", { name: "Stock", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(mediaPool.getByRole("tab", { name: "Text", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(mediaPool.getByRole("tab", { name: "Create", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(mediaPool.getByRole("tab", { name: "Media pool", exact: true })).toBeFocused();

  await mediaPool.getByRole("tab", { name: "Effects", exact: true }).click();
  await expect(
    mediaPool.locator('[data-effect-catalog-id="gpu-brightness"] canvas'),
  ).toHaveAttribute("data-rendered", "true");
  await page.locator("[data-program-pasteboard]").click({ position: { x: 3, y: 3 } });
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-effects-1280.png",
    fullPage: true,
  });

  await mediaPool.getByRole("tab", { name: "Transition", exact: true }).click();
  await expect(mediaPool.locator('[data-transition-catalog-id="dissolve"] canvas')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.locator("[data-program-pasteboard]").click({ position: { x: 3, y: 3 } });
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-transitions-1280.png",
    fullPage: true,
  });

  await mediaPool.getByRole("tab", { name: "Media pool", exact: true }).click();
  await mediaPool.getByRole("button", { name: "Media", exact: true }).click();

  const mediaResize = mediaPool.getByRole("separator", { name: "Assets" });
  const initialMediaWidth = Number(await mediaResize.getAttribute("aria-valuenow"));
  await mediaResize.focus();
  await page.keyboard.press("ArrowRight");
  await expect(mediaResize).toHaveAttribute("aria-valuenow", String(initialMediaWidth + 16));
  const mediaBounds = await mediaPool.boundingBox();
  const desktopTimelineBounds = await page.locator("footer").boundingBox();
  expect(mediaBounds).not.toBeNull();
  expect(desktopTimelineBounds).not.toBeNull();
  expect(desktopTimelineBounds!.x).toBeGreaterThanOrEqual(mediaBounds!.x + mediaBounds!.width - 1);
  await expect(page.getByRole("button", { name: "Preview zoom: Fit" })).toBeVisible();

  const timelineFooter = page.locator("footer");
  const collapsedTimelineHeight = (await timelineFooter.boundingBox())!.height;
  await page.getByRole("button", { name: "Audio mixer" }).click();
  const mixerDock = page.locator("[data-audio-mixer-dock]");
  const mixerResize = page.getByRole("separator", { name: "Audio mixer" });
  await expect(mixerDock).toBeVisible();
  await expect(page.locator("#video-editor-timeline-scroll")).toBeVisible();
  await expect
    .poll(async () => (await timelineFooter.boundingBox())?.height ?? 0)
    .toBeGreaterThan(collapsedTimelineHeight);
  const initialMixerHeight = Number(await mixerResize.getAttribute("aria-valuenow"));
  await mixerResize.focus();
  await page.keyboard.press("ArrowUp");
  await expect(mixerResize).toHaveAttribute("aria-valuenow", String(initialMixerHeight + 16));
  await page.getByRole("button", { name: "Audio mixer" }).click();
  await expect(mixerDock).toHaveCount(0);
  await expect
    .poll(async () => Math.round((await timelineFooter.boundingBox())?.height ?? 0))
    .toBe(Math.round(collapsedTimelineHeight));

  await page.getByRole("button", { name: "Audio mixer" }).click();
  await page.getByRole("button", { name: "Beat markers" }).click();
  await expect(mixerDock).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Beat markers" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(async () => Math.round((await timelineFooter.boundingBox())?.height ?? 0))
    .toBe(Math.round(collapsedTimelineHeight));
  await page.getByRole("button", { name: "Beat markers" }).click();

  await page.getByRole("button", { name: "Audio mixer" }).click();
  await page.getByRole("tab", { name: "Color" }).click();
  await page.getByRole("tab", { name: "Edit" }).click();
  await expect(mixerDock).toHaveCount(0);
  await expect
    .poll(async () => Math.round((await timelineFooter.boundingBox())?.height ?? 0))
    .toBe(Math.round(collapsedTimelineHeight));

  await addTextItem(page);
  const inspector = page.getByRole("complementary", { name: "Edit" });
  await expect(inspector.getByRole("heading", { name: "Your text" })).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "Properties" })).toBeVisible();
  await expect(inspector.getByText("Properties", { exact: true })).toHaveCount(1);
  const inspectorBounds = await inspector.boundingBox();
  expect(inspectorBounds).not.toBeNull();

  const pasteboardBounds = await page.locator("[data-program-pasteboard]").boundingBox();
  const monitorBounds = await page.locator("[data-program-monitor]").boundingBox();
  expect(pasteboardBounds).not.toBeNull();
  expect(monitorBounds).not.toBeNull();
  expect(monitorBounds!.x).toBeGreaterThan(pasteboardBounds!.x);
  expect(monitorBounds!.y).toBeGreaterThan(pasteboardBounds!.y);
  expect(monitorBounds!.x + monitorBounds!.width).toBeLessThan(
    pasteboardBounds!.x + pasteboardBounds!.width,
  );

  await inspector.getByRole("button", { name: "More actions" }).click();
  for (const name of [
    "Split at playhead (B)",
    "Delete and leave gap",
    "Ripple delete",
    "Create compound clip",
    "Add crossfade",
  ]) {
    await expect(page.getByRole("menuitem", { name })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await page.locator("[data-program-pasteboard]").click({ position: { x: 3, y: 3 } });
  await expect(inspector.getByRole("heading", { name: "Edit", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-1280.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Color" }).click();
  await expect(page.getByText("Program", { exact: true })).toHaveCount(0);
  const programPanel = page.locator("#video-editor-program-panel");
  const colorPasteboard = programPanel.locator("[data-program-pasteboard]");
  const scopesPanel = page.getByRole("complementary", { name: "Scopes" });
  const scopeSurface = scopesPanel.locator("[data-scope-backend]");
  const programPanelBounds = await programPanel.boundingBox();
  const colorPasteboardBounds = await colorPasteboard.boundingBox();
  const scopesPanelBounds = await scopesPanel.boundingBox();
  const scopeSurfaceBounds = await scopeSurface.boundingBox();
  expect(programPanelBounds).not.toBeNull();
  expect(colorPasteboardBounds).not.toBeNull();
  expect(scopesPanelBounds).not.toBeNull();
  expect(scopeSurfaceBounds).not.toBeNull();
  expect(Math.abs(colorPasteboardBounds!.y - programPanelBounds!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(scopeSurfaceBounds!.y - scopesPanelBounds!.y)).toBeLessThanOrEqual(1);
  await expect(scopesPanel.getByRole("heading", { name: "Scopes", exact: true })).toHaveCount(1);
  await expect(scopesPanel.getByRole("button", { name: "Live color scope" })).toBeVisible();
  await expect(scopesPanel.getByRole("separator", { name: "Scopes" })).toBeVisible();
  const populatedColorDock = page.getByRole("region", {
    name: "Color grading",
  });
  const colorWheels = populatedColorDock.getByRole("slider", {
    name: /color wheel$/u,
  });
  await expect(colorWheels).toHaveCount(4);
  await colorWheels.first().focus();
  await page.keyboard.press("ArrowUp");
  await expect(populatedColorDock.getByRole("textbox", { name: "Lift master" })).toBeVisible();
  await expect(populatedColorDock.getByRole("textbox", { name: "Lift Red" })).toBeVisible();
  await expect(populatedColorDock.getByRole("slider", { name: "Lift thumb wheel" })).toBeVisible();
  await expect(
    populatedColorDock.getByRole("button", {
      name: "Auto balance from the current frame",
    }),
  ).toBeVisible();
  await expect(populatedColorDock.getByRole("textbox", { name: "Temperature" })).toHaveValue("0.0");
  await expect(populatedColorDock.getByRole("textbox", { name: "Saturation" })).toHaveValue(
    "50.00",
  );
  await expect(page.getByRole("button", { name: "Live color scope" })).toContainText("RGB Parade");
  await expect(
    populatedColorDock.getByRole("button", { name: /keyframe at playhead$/u }).first(),
  ).toBeVisible();
  await expect(populatedColorDock.getByRole("region", { name: "Curves" })).toBeVisible();
  const colorKeyframes = populatedColorDock.getByRole("region", {
    name: "Keyframes",
  });
  await expect(colorKeyframes).toBeVisible();
  await expect(colorKeyframes.locator("[data-keyframe-side-ruler]")).toBeVisible();
  await colorKeyframes
    .getByRole("button", {
      name: /^Add Color Wheels: Lift Hue keyframe at playhead$/u,
    })
    .click();
  const colorKeyframe = colorKeyframes.locator("[data-dopesheet-keyframe-id]").first();
  await expect(colorKeyframe).toBeVisible();
  await colorKeyframe.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /^Delete/u })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-color-scope-canvas]")).toBeVisible();
  const effects = populatedColorDock.getByRole("region", { name: "Effects" });
  await expect(effects.getByRole("button", { name: "Add effect" })).toBeVisible();
  await expect(effects.getByRole("button", { name: "Color Wheels" })).toHaveCount(0);
  await effects.getByRole("button", { name: "Add effect" }).click();
  await page.locator('[data-effect-option="brightness"]').click();
  const brightnessEffect = effects
    .getByRole("button", { name: "Brightness", exact: true })
    .locator("xpath=ancestor::li[@data-effect-id]");
  await expect(brightnessEffect).toBeVisible();
  await brightnessEffect.getByRole("button", { name: "Brightness", exact: true }).click();
  await expect(brightnessEffect.getByRole("slider", { name: "Brightness — Amount" })).toBeHidden();
  await brightnessEffect.getByRole("button", { name: "Brightness", exact: true }).click();
  await expect(brightnessEffect.getByRole("slider", { name: "Brightness — Amount" })).toBeVisible();
  await brightnessEffect.locator("[data-effect-context-trigger]").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Remove effect" })).toBeVisible();
  await page.keyboard.press("Escape");
  await effects.getByRole("button", { name: "Disable all effects" }).click();
  await expect(effects.getByRole("button", { name: "Enable all effects" })).toBeVisible();
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-color-1280.png",
    fullPage: true,
  });
  expect(
    consoleFailures.filter(
      (failure) =>
        failure !== "warning: No available adapters." &&
        !failure.includes("GPU stall due to ReadPixels"),
    ),
  ).toEqual([]);
});

test.describe("Video Editor coarse-pointer targets", () => {
  test.use({ hasTouch: true });

  test("keeps editor controls at least 44 pixels on phones and touch desktops", async ({
    page,
  }) => {
    await createProject(page, "Touch target proof");
    await addTextItem(page);
    await expect
      .poll(() => page.evaluate(() => matchMedia("(pointer: coarse)").matches))
      .toBe(true);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await expectMinimumTargets(page.locator("header").getByRole("button"));
      await expectMinimumTargets(page.locator("header").getByRole("link"));
      await expectMinimumTargets(
        page.getByRole("tablist", { name: "Editor workspaces" }).getByRole("tab"),
      );
      await expectMinimumTargets(page.locator("[data-edit-inspector-tab]"));
      await expectMinimumTargets(page.getByRole("slider", { name: "Zoom" }));
      const timelineToolbar = page.getByText("Timeline", { exact: true }).locator("..");
      await expectMinimumTargets(timelineToolbar.getByRole("button"));
      if (viewport.width === 1024) {
        await expectMinimumTargets(page.getByRole("separator", { name: "Timeline" }));
      }
      await expectNoHorizontalOverflow(page);
      if (viewport.width === 1024) {
        await page.screenshot({
          path: "frontend/.svelte-kit/openpost-video-editor-touch-1024.png",
          fullPage: true,
        });
      }
    }

    await page.getByRole("tab", { name: "Color" }).click();
    const colorDock = page.getByRole("region", { name: "Color grading" });
    await expectMinimumTargets(colorDock.getByRole("slider", { name: "Lift thumb wheel" }));
    await expectNoHorizontalOverflow(page);
  });
});

test("Video Editor keyboard transport and delete commands survive focused controls", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await createProject(page, "Keyboard route proof");

  const clips = page.locator("[data-timeline-item-id]");
  await addTextItem(page);
  await expect(clips).toHaveCount(1);

  await page
    .getByRole("complementary", { name: "Assets" })
    .getByRole("button", { name: "Add layer" })
    .focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(clips).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(clips).toHaveCount(1);

  const playhead = page.getByRole("slider", { name: "Timeline playhead" });
  await playhead.focus();
  await page.keyboard.press("End");
  await addTextItem(page);
  await expect(clips).toHaveCount(2);

  await clips.nth(1).locator(":scope > button").first().click();
  await page.keyboard.press("Backspace");
  await expect(clips).toHaveCount(1);

  await addTextItem(page);
  await expect(clips).toHaveCount(2);
  const firstLeft = await clips
    .nth(0)
    .evaluate((clip) => parseFloat((clip as HTMLElement).style.left));
  const secondLeft = await clips
    .nth(1)
    .evaluate((clip) => parseFloat((clip as HTMLElement).style.left));
  expect(secondLeft).toBeGreaterThan(firstLeft);

  await clips.nth(0).locator(":scope > button").first().click();
  await page.keyboard.press("Delete");
  await expect(clips).toHaveCount(1);
  await expect
    .poll(() => clips.nth(0).evaluate((clip) => parseFloat((clip as HTMLElement).style.left)))
    .toBe(firstLeft);
});

test("Transcript word cuts own Backspace and ripple linked media with undo", async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, "Transcript edit route proof");
  await seedTranscriptEditProject(page);

  const primaryVideo = page.locator('[data-timeline-item-id="video-primary"]');
  const laterVideo = page.locator('[data-timeline-item-id="video-later"]');
  const laterAudio = page.locator('[data-timeline-item-id="audio-later"]');
  await primaryVideo.locator(":scope > button").first().click();

  const inspector = page.getByRole("complementary", { name: "Edit" });
  await inspector.getByRole("tab", { name: "Transcript" }).click();
  const transcript = inspector.getByTestId("transcript-panel");
  await transcript.getByRole("button", { name: "Edit video by transcript" }).click();
  const fillerWord = transcript.getByRole("button", { name: 'Select "um"' });

  await fillerWord.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  await fillerWord.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Stage words" })).toBeVisible();
  await page.keyboard.press("Escape");
  await fillerWord.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Stage words" })).toBeVisible();
  await page.keyboard.press("Escape");

  const videoLeftBefore = await laterVideo.evaluate((clip) =>
    parseFloat((clip as HTMLElement).style.left),
  );
  const audioLeftBefore = await laterAudio.evaluate((clip) =>
    parseFloat((clip as HTMLElement).style.left),
  );
  await fillerWord.click();
  await page.keyboard.press("Backspace");
  await expect(transcript.getByText("1 staged · 0.5s")).toBeVisible();
  await expect(primaryVideo).toBeVisible();

  await transcript.getByRole("button", { name: "Cut staged words" }).click();
  await expect(fillerWord).toHaveCount(0);
  const program = page.getByRole("application", { name: "Program" });
  await expect(program.getByRole("img", { name: "Please continue" })).toBeVisible();
  const videoLeftAfter = await laterVideo.evaluate((clip) =>
    parseFloat((clip as HTMLElement).style.left),
  );
  const audioLeftAfter = await laterAudio.evaluate((clip) =>
    parseFloat((clip as HTMLElement).style.left),
  );
  expect(videoLeftAfter).toBeLessThan(videoLeftBefore);
  expect(audioLeftAfter).toBeLessThan(audioLeftBefore);
  expect(audioLeftAfter).toBe(videoLeftAfter);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(transcript.getByRole("button", { name: 'Select "um"' })).toBeVisible();
  await expect(program.getByRole("img", { name: "Please um continue" })).toBeVisible();
  await expect
    .poll(() => laterVideo.evaluate((clip) => parseFloat((clip as HTMLElement).style.left)))
    .toBe(videoLeftBefore);
  await expect
    .poll(() => laterAudio.evaluate((clip) => parseFloat((clip as HTMLElement).style.left)))
    .toBe(audioLeftBefore);
});

test("Speed curves retime linked picture and sound from the inspector", async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, "Speed curve route proof");
  await seedTranscriptEditProject(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  const primaryVideo = page.locator('[data-timeline-item-id="video-primary"]');
  const primaryAudio = page.locator('[data-timeline-item-id="audio-primary"]');
  await primaryVideo.locator(":scope > button").first().click();
  const videoWidthBefore = await primaryVideo.evaluate((clip) =>
    parseFloat((clip as HTMLElement).style.width),
  );
  const audioWidthBefore = await primaryAudio.evaluate((clip) =>
    parseFloat((clip as HTMLElement).style.width),
  );

  const playhead = page.getByRole("slider", { name: "Timeline playhead" });
  await playhead.focus();
  for (let frame = 0; frame < 30; frame += 1) await page.keyboard.press("ArrowRight");

  const inspector = page.getByRole("complementary", { name: "Edit" });
  const speedCurve = inspector.getByTestId("speed-ramp-editor");
  await speedCurve.getByRole("button", { name: "Add point" }).click();
  await speedCurve.getByRole("spinbutton", { name: "Speed 2" }).fill("2");
  await speedCurve.getByRole("spinbutton", { name: "Speed 2" }).press("Enter");
  await speedCurve.getByRole("button", { name: "Easing for segment starting at frame 30" }).click();
  await page.getByRole("option", { name: "Hold" }).click();

  await expect(speedCurve.getByRole("img", { name: "Speed" })).toBeVisible();
  await expect(speedCurve.getByRole("button", { name: "Delete Speed 2" })).toBeVisible();
  await expect
    .poll(() => primaryVideo.evaluate((clip) => parseFloat((clip as HTMLElement).style.width)))
    .toBeLessThan(videoWidthBefore);
  await expect
    .poll(() => primaryAudio.evaluate((clip) => parseFloat((clip as HTMLElement).style.width)))
    .toBeLessThan(audioWidthBefore);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-speed-curve-1280.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePanels = page.getByRole("navigation", { name: "Editor panels" });
  await mobilePanels.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(speedCurve).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "frontend/.svelte-kit/openpost-video-editor-speed-curve-390.png",
    fullPage: true,
  });
});

test("Video Editor restores its workspace before reloading a project deep link", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await createProject(page, "Reload route proof");

  const projectUrl = page.url();
  await page.reload();

  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await expect(page.getByText("Workspace root is not set")).toBeHidden();
});

test("Video Editor restores its workspace before a direct new-project handoff", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await createProject(page, "Workspace seed");

  await page.goto("about:blank");
  await page.goto("/video-editor/new?name=Direct%20handoff&return=draft-123");

  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?return=draft-123$/u);
  await expect(page.getByText("Direct handoff")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
});

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
  await createProject(page, "Composer send proof");
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
