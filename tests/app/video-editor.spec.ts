import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
  const projects = page.getByRole("heading", { name: "Projects" });
  const openEditor = page.getByRole("button", { name: "Open Video Editor", exact: true });
  await expect(projects.or(openEditor)).toBeVisible();
  if (await projects.isVisible()) {
    await page.getByRole("button", { name: "Custom project" }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
  } else {
    await openEditor.click();
  }
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  const projectName = page.getByRole("textbox", { name: "Project name" });
  if ((await projectName.inputValue()) !== name) await projectName.fill(name);
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

async function seedDistinctSequences(page: Page): Promise<void> {
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  if (!projectId) throw new Error("Video project id is missing from the editor URL");
  await page.evaluate(
    async ({ id }) => {
      const root = await navigator.storage.getDirectory();
      const projects = await root.getDirectoryHandle("projects");
      const directory = await projects.getDirectoryHandle(id);
      const handle = await directory.getFileHandle("project.json");
      const project = JSON.parse(await (await handle.getFile()).text());
      const tracks = project.timeline.tracks;
      const videoTrack = tracks.find((track: { kind: string }) => track.kind === "video");
      if (!videoTrack) throw new Error("Video project has no visual track");
      const textItem = (id: string, text: string) => ({
        id,
        type: "text",
        trackId: videoTrack.id,
        from: 0,
        durationInFrames: 150,
        label: text,
        text,
        fontSize: 96,
        color: "#ffffff",
        transform: { x: 960, y: 540, width: 1000, height: 240, opacity: 1 },
      });
      const composition = (
        id: string,
        name: string,
        items: Array<ReturnType<typeof textItem>>,
        editorKind = "sequence",
      ) => ({
        id,
        name,
        editorKind,
        items,
        tracks,
        transitions: [],
        fps: project.metadata.fps,
        width: project.metadata.width,
        height: project.metadata.height,
        durationInFrames: 150,
      });
      const compoundId = "switch-proof-compound";
      project.timeline = {
        ...project.timeline,
        items: [textItem("switch-proof-main", "Main slate")],
        compositions: [
          composition("switch-proof-alpha", "Alpha sequence", [
            textItem("switch-proof-alpha-item", "Alpha slate"),
          ]),
          composition("switch-proof-beta", "Beta sequence", [
            {
              id: "switch-proof-beta-wrapper",
              type: "composition",
              trackId: videoTrack.id,
              from: 0,
              durationInFrames: 150,
              label: "Nested compound",
              compositionId: compoundId,
              compositionWidth: project.metadata.width,
              compositionHeight: project.metadata.height,
              sourceStart: 0,
              sourceEnd: 150,
              sourceDuration: 150,
              sourceFps: project.metadata.fps,
              speed: 1,
              transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
            },
          ]),
          composition(compoundId, "Nested compound", [
            textItem("switch-proof-compound-item", "Compound slate"),
          ]),
          composition(
            "switch-proof-motion",
            "Existing motion",
            [textItem("switch-proof-motion-item", "Motion slate")],
            "composite-2d",
          ),
        ],
        topLevelSequenceIds: ["switch-proof-alpha", "switch-proof-beta"],
      };
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(project));
      await writable.close();
    },
    { id: projectId },
  );
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 20_000,
  });
}

test("Video Editor quick export saves an MP4 in the workspace", async ({ page }) => {
  test.setTimeout(90_000);
  const projectName = "Quick export proof";
  await createProject(page, projectName);
  await addTextItem(page);

  await openHeaderMoreMenu(page);
  await page.getByRole("menuitem", { name: "Export MP4" }).click();
  await expect(page.getByText(`Saved ${projectName}.mp4.`)).toBeVisible({
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

  await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Render now" })).toBeEnabled();
});

test("sequence switches synchronize tracks, preview, and selection", async ({ page, request }) => {
  const auth = await registerUser(request, `sequence-switch-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Sequence switch synchronization");
  await authenticatePage(page, auth.token);
  await createProject(page, "Sequence switch synchronization", { selectLocalProjects: true });
  await seedDistinctSequences(page);

  const expectTimeline = async (itemId: string, previewText: string) => {
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await expect(page.locator(`[data-timeline-item-id="${itemId}"]`)).toBeVisible();
    await expect(page.locator(`[data-preview-item="${itemId}"]`)).toBeVisible();
    await expect(
      page.getByRole("application", { name: "Program" }).getByRole("img", {
        name: previewText,
      }),
    ).toBeVisible();
  };
  const inspectorHeading = page.locator("#video-editor-tools-panel h2");

  await expectTimeline("switch-proof-main", "Main slate");
  await page.locator('[data-timeline-item-id="switch-proof-main"] button').first().click();
  await expect(inspectorHeading).toHaveText("Main slate");

  await page.getByRole("button", { name: "Alpha sequence", exact: true }).click();
  await expectTimeline("switch-proof-alpha-item", "Alpha slate");
  await expect(inspectorHeading).toHaveText("Edit");
  await page.locator('[data-timeline-item-id="switch-proof-alpha-item"] button').first().click();
  await expect(inspectorHeading).toHaveText("Alpha slate");

  await page.getByRole("button", { name: "Beta sequence", exact: true }).click();
  await expect(page.locator('[data-timeline-item-id="switch-proof-beta-wrapper"]')).toBeVisible();
  await expect(page.locator('[data-preview-item="switch-proof-beta-wrapper"]')).toBeVisible();
  await expect(inspectorHeading).toHaveText("Edit");
  await page
    .locator('[data-timeline-item-id="switch-proof-beta-wrapper"]')
    .getByRole("button", { name: /^Nested compound\. Drag to move/u })
    .dblclick();
  await expect(page.getByRole("button", { name: "Nested compound", exact: true })).toBeVisible();
  await expectTimeline("switch-proof-compound-item", "Compound slate");
  await expect(inspectorHeading).toHaveText("Edit");

  await page.getByRole("button", { name: "Alpha sequence", exact: true }).click();
  await expectTimeline("switch-proof-alpha-item", "Alpha slate");
  await expect(inspectorHeading).toHaveText("Alpha slate");
  await page.getByRole("button", { name: "Main", exact: true }).click();
  await expectTimeline("switch-proof-main", "Main slate");
  await expect(inspectorHeading).toHaveText("Main slate");
});

test("selected clip split leaves other overlapping tracks intact", async ({ page }) => {
  await createProject(page, "Selected split");
  await addTextItem(page);
  await addTextItem(page);
  const clips = page.locator("[data-timeline-item-id]");
  await expect(clips).toHaveCount(2);
  const selected = clips.last();
  const untouchedId = await clips.first().getAttribute("data-timeline-item-id");
  const untouched = page.locator(`[data-timeline-item-id="${untouchedId}"]`);
  const untouchedWidth = (await untouched.boundingBox())!.width;
  await page.getByRole("slider", { name: "Timeline playhead", exact: true }).press("ArrowRight");
  await selected.getByRole("button", { name: /Drag to move/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Split at playhead/ }).click();
  await expect(clips).toHaveCount(3);
  expect((await untouched.boundingBox())!.width).toBe(untouchedWidth);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(clips).toHaveCount(2);
  await page.getByRole("region", { name: "Timeline", exact: true }).focus();
  await page.keyboard.press("b");
  await expect(clips).toHaveCount(3);
  expect((await untouched.boundingBox())!.width).toBe(untouchedWidth);
});

test("transition feedback explains the single-clip requirement", async ({ page }, testInfo) => {
  await createProject(page, "Transition selection");
  await addTextItem(page);
  await addTextItem(page);
  const clips = page.locator("[data-timeline-item-id]");
  await clips
    .first()
    .getByRole("button", { name: /Drag to move/ })
    .click();
  await clips
    .last()
    .getByRole("button", { name: /Drag to move/ })
    .click({ modifiers: ["Shift"] });
  await expect(page.getByRole("heading", { name: "2 clips selected" })).toBeVisible();
  await page.getByRole("tab", { name: "Transition", exact: true }).click();
  await page.getByRole("button", { name: "Cross dissolve", exact: true }).click();
  await expect(
    page.getByText("Select one clip to add a transition.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("transition-selection-fixed.png") });
});

test("Motion distinguishes an empty composition from a selection and restores Edit selection", async ({
  page,
}, testInfo) => {
  await createProject(page, "Motion creation intent");
  await seedDistinctSequences(page);
  await page.getByRole("button", { name: /^Main slate\. Drag/ }).click();
  await page.getByRole("tab", { name: "Motion", exact: true }).first().click();
  await expect(page.getByTestId("composition-new")).toHaveAccessibleName("New composition");
  await page.getByTestId("composition-new").click();
  await expect(page.getByRole("dialog", { name: "New composition" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("motion-new-composition-fixed.png") });
  await page.getByTestId("new-composition-cancel").click();
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await expect(page.locator("#video-editor-tools-panel h2")).toHaveText("Main slate");
});

for (const scheme of ["light", "dark"] as const) {
  test(`Motion creation controls remain readable in ${scheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await createProject(page, "Motion contrast");
    await seedDistinctSequences(page);
    await page.getByRole("tab", { name: "Motion", exact: true }).click();
    await page.getByTestId("composition-new").click();
    const cancel = page.getByTestId("new-composition-cancel");
    const contrast = await cancel.evaluate((button) => {
      const surface = button.closest('[role="dialog"]')!;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const text = luminance(getComputedStyle(button).color);
      const background = luminance(getComputedStyle(surface).backgroundColor);
      return {
        ratio: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05),
        buttonBackground: getComputedStyle(button).backgroundColor,
      };
    });
    expect(contrast.buttonBackground).toBe("rgba(0, 0, 0, 0)");
    expect(
      contrast.ratio,
      "Cancel text meets normal-text contrast on the Motion dialog",
    ).toBeGreaterThanOrEqual(4.5);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: testInfo.outputPath(`motion-creation-${scheme}-${width}.png`),
      });
    }
  });
}

test("reload restores the active sequence without editing the project", async ({ page }) => {
  await createProject(page, "Sequence continuity");
  await seedDistinctSequences(page);
  await page.getByRole("button", { name: "Alpha sequence", exact: true }).click();
  await expect(page.locator('[data-timeline-item-id="switch-proof-alpha-item"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-timeline-item-id="switch-proof-alpha-item"]')).toBeVisible();
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await expect(page.getByTestId("composition-layer-switch-proof-motion-item")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("composition-layer-switch-proof-motion-item")).toBeVisible();
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await expect(page.locator('[data-timeline-item-id="switch-proof-alpha-item"]')).toBeVisible();
  await page.getByRole("button", { name: "Main", exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-timeline-item-id="switch-proof-main"]')).toBeVisible();
});

test("Stock and Create keep working state while another tool is open", async ({
  page,
  request,
}) => {
  let providerRequests = 0;
  await page.route("**/api/v1/stock-media/providers", (route) => {
    providerRequests += 1;
    return route.fulfill({
      json: {
        providers: [
          {
            key: "pexels",
            name: "Pexels",
            provider_url: "https://www.pexels.com",
            photos: true,
            videos: true,
            audio: false,
            photo_filters: ["orientation", "size", "color", "locale"],
            video_filters: ["orientation", "size", "locale"],
            attribution: "Photos and videos provided by Pexels",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/stock-media/search**", (route) =>
    route.fulfill({ status: 503, json: { detail: "Stock search test failure" } }),
  );
  const auth = await registerUser(request, `stateful-tools-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Stateful tools");
  await authenticatePage(page, auth.token);
  await createProject(page, "Stateful tools", { selectLocalProjects: true });
  await page.setViewportSize({ width: 1280, height: 500 });
  expect(providerRequests).toBe(0);
  const leftPanelTab = (value: string) => page.locator(`[data-left-panel-tab="${value}"]:visible`);

  await leftPanelTab("stock").click();
  await expect.poll(() => providerRequests).toBe(1);
  const query = page.getByRole("textbox", { name: "Search stock media", exact: true });
  await query.fill("Lisbon rooftops");
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByRole("option", { name: "Videos", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Stock search test failure", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const stockPanel = page.locator('#video-editor-left-tool-panel div[aria-label="Stock"]');
  await stockPanel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const stockScrollTop = await stockPanel.evaluate((element) => element.scrollTop);
  expect(stockScrollTop).toBeGreaterThan(0);
  await leftPanelTab("media").click();
  await expect(query).toBeHidden();
  await leftPanelTab("stock").click();
  expect(await stockPanel.evaluate((element) => element.scrollTop)).toBe(stockScrollTop);
  expect(providerRequests).toBe(1);
  await expect(query).toHaveValue("Lisbon rooftops");
  await expect(page.getByRole("button", { name: "Type", exact: true })).toContainText("Videos");
  await expect(page.getByText("Stock search test failure", { exact: true })).toBeVisible();

  await leftPanelTab("ai").click();
  await page.getByRole("tab", { name: "Generate", exact: true }).click();
  const script = page.locator("#local-ai-script");
  await script.fill("Keep this generated speech draft");
  await page.getByTestId("local-ai-panel").evaluate((element) => {
    element.dataset.persistenceProbe = "mounted";
  });
  await page.getByRole("tab", { name: "Assistant", exact: true }).click();
  await expect(page.getByTestId("local-ai-panel")).toBeHidden();
  await page.getByRole("tab", { name: "Generate", exact: true }).click();
  await expect(page.getByTestId("local-ai-panel")).toHaveAttribute(
    "data-persistence-probe",
    "mounted",
  );
  await expect(script).toHaveValue("Keep this generated speech draft");
  await leftPanelTab("media").click();
  await expect(page.getByTestId("editor-assistant-panel")).toBeHidden();
  await leftPanelTab("ai").click();
  await expect(script).toHaveValue("Keep this generated speech draft");
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

  await page.getByRole("button", { name: "Custom project" }).click();
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
  await expect(page.getByRole("banner").getByRole("status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 20_000,
  });
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
