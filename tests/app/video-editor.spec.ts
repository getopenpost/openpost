import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";
import { type components } from "@openpost/api-contract";

// Waits two animation frames so "nothing further was drawn" checks follow a real paint.
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function installLocalWorkspacePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!("showOpenFilePicker" in window)) {
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => [],
      });
    }
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
    await page.getByRole("button", { name: "This device" }).click();
  }
  await page.getByRole("button", { name: "Choose folder" }).click();
  const projects = page.getByRole("heading", { name: "Projects" });
  const openEditor = page.getByRole("button", { name: "Open Video Editor", exact: true });
  await expect(projects.or(openEditor).first()).toBeVisible();
  if (await projects.isVisible()) {
    await page.getByRole("button", { name: "Custom project" }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
  } else {
    await openEditor.click();
  }
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await page.locator("[data-project-details]").click();
  const projectName = page.getByRole("textbox", { name: "Project name" });
  if ((await projectName.inputValue()) !== name) {
    await projectName.fill(name);
    await projectName.press("Tab");
  }
  await page.keyboard.press("Escape");
}

test.describe("video editor", () => {
  async function addTextItem(page: Page): Promise<void> {
    await page.locator("header").getByRole("button", { name: "More actions", exact: true }).click();
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

  test("Video Editor renders and saves an MP4 in the workspace", async ({ page }) => {
    test.setTimeout(90_000);
    const projectName = "Quick export proof";
    await createProject(page, projectName);
    await addTextItem(page);

    await openHeaderMoreMenu(page);
    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    await page.getByRole("dialog").getByText("WebM", { exact: true }).click();
    await page.getByRole("option", { name: "MP4", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Render now", exact: true }).click();
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

  test("sequence switches synchronize tracks, preview, and selection", async ({
    page,
    request,
  }) => {
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
    const projectNameHeading = (
      (await page.locator("[data-project-details]").textContent()) ?? ""
    ).trim();

    await expectTimeline("switch-proof-main", "Main slate");
    await page.locator('[data-timeline-item-id="switch-proof-main"] button').first().click();
    await expect(inspectorHeading).toHaveText("Main slate");

    await page.getByRole("button", { name: "Alpha sequence", exact: true }).click();
    await expectTimeline("switch-proof-alpha-item", "Alpha slate");
    await expect(inspectorHeading).toHaveText(projectNameHeading);
    await page.locator('[data-timeline-item-id="switch-proof-alpha-item"] button').first().click();
    await expect(inspectorHeading).toHaveText("Alpha slate");

    await page.getByRole("button", { name: "Beta sequence", exact: true }).click();
    await expect(page.locator('[data-timeline-item-id="switch-proof-beta-wrapper"]')).toBeVisible();
    await expect(page.locator('[data-preview-item="switch-proof-beta-wrapper"]')).toBeVisible();
    await expect(inspectorHeading).toHaveText(projectNameHeading);
    await page
      .locator('[data-timeline-item-id="switch-proof-beta-wrapper"]')
      .getByRole("button", { name: /^Nested compound\. Drag to move/u })
      .dblclick();
    await expect(page.getByRole("button", { name: "Nested compound", exact: true })).toBeVisible();
    await expectTimeline("switch-proof-compound-item", "Compound slate");
    await expect(inspectorHeading).toHaveText(projectNameHeading);

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
    if (!(await page.locator('[data-left-group-tab="transitions"]:visible').count())) {
      await page
        .getByRole("navigation", { name: "Assets", exact: true })
        .getByRole("tab", { name: "Effects", exact: true })
        .click();
    }
    await page.locator('[data-left-group-tab="transitions"]:visible').click();
    await page.getByRole("button", { name: "Cross dissolve", exact: true }).click();
    await expect(
      page.getByText("Select one clip to add a transition.", { exact: true }),
    ).toBeVisible();
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
    await page.getByTestId("new-composition-cancel").click();
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
    await expect(page.locator("#video-editor-tools-panel h2")).toHaveText("Main slate");
  });

  test(`Motion creation controls remain readable in light`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
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
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(cancel).toBeInViewport({ ratio: 1 });
  });

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
    const leftPanelTab = (value: string) =>
      page.locator(`[data-left-panel-tab="${value}"]:visible`);
    const leftGroupTab = (value: string) =>
      page.locator(`[data-left-group-tab="${value}"]:visible`);

    await leftGroupTab("stock").click();
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
    await leftGroupTab("project").click();
    await expect(query).toBeHidden();
    await leftGroupTab("stock").click();
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

  test("the timeline ruler keeps its own row above track labels", async ({ page }, info) => {
    await createProject(page, "Ruler boundary");
    await addTextItem(page);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    const timeline = page.locator("#video-editor-timeline-scroll");
    const ruler = page.getByRole("slider", { name: "Timeline playhead", exact: true });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.reload();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: 844 });
    await ruler.press("Home");
    await ruler.press("ArrowRight");
    await expect(ruler).toHaveAttribute("aria-valuenow", "1");
    await expect(ruler).toBeFocused();
    expect(await ruler.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
      "none",
    );
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    const ticks = (await ruler.boundingBox())!;
    const labels = (await page.locator("[data-track-header]").first().boundingBox())!;
    expect(
      labels.y,
      "The ruler must have its own row above the first track",
    ).toBeGreaterThanOrEqual(ticks.y + ticks.height);
    await timeline.evaluate((element) => {
      element.scrollTop = 24;
    });
    expect(
      await ruler.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(bounds.x + 40, bounds.y + 12));
      }),
      "The pinned ruler must cover track labels that scroll underneath it",
    ).toBe(true);
    const resize = (await page.locator("[data-track-resize]").first().boundingBox())!;
    await timeline.evaluate(
      (element, offset) => {
        element.scrollTop += offset;
      },
      resize.y + resize.height / 2 - ticks.y - ticks.height / 2,
    );
    expect(
      await ruler.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(bounds.x + 200, bounds.y + 12));
      }),
      "Track resize handles must not intercept the pinned ruler",
    ).toBe(true);
  });

  test("horizontal timeline scrolling keeps the playhead behind track headers", async ({
    page,
  }, info) => {
    await createProject(page, "Playhead boundary");
    await addTextItem(page);
    const timeline = page.locator("#video-editor-timeline-scroll");
    const header = page.locator("[data-track-header]").first();
    await page.getByRole("slider", { name: "Timeline playhead", exact: true }).press("Home");
    await page.mouse.move(0, 0);
    const bounds = (await header.boundingBox())!;
    const playheadSlice = () =>
      page.screenshot({
        clip: {
          x: bounds.x + bounds.width + 8,
          y: bounds.y + 8,
          width: 100,
          height: bounds.height - 16,
        },
      });
    const withoutPlayhead = await playheadSlice();
    const ruler = page.getByRole("slider", { name: "Timeline playhead", exact: true });
    await ruler.press("Shift+ArrowRight");
    const visiblePlayhead = await playheadSlice();
    expect(visiblePlayhead.equals(withoutPlayhead), "The playhead must paint a visible line").toBe(
      false,
    );
    const before = await header.screenshot();
    await timeline.evaluate((element) => {
      element.scrollLeft = 90;
    });
    await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBe(90);
    const after = await header.screenshot();
    expect(
      after.equals(before),
      "Panning the timeline must not draw its playhead over track labels",
    ).toBe(true);
    await timeline.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBe(0);
    expect(
      (await playheadSlice()).equals(visiblePlayhead),
      "Scrolling back must restore the visible playhead",
    ).toBe(true);
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
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
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
});

test.describe("video editor gallery previews", () => {
  test("background and effect catalogs compile only the active preview", async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          const handle = await navigator.storage.getDirectory();
          const prototype = Object.getPrototypeOf(handle);
          prototype.queryPermission = async () => "granted";
          prototype.requestPermission = async () => "granted";
          return handle;
        },
      });
    });
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Choose folder", exact: true }).click();
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await page.getByRole("tablist", { name: "Editor workspaces" }).waitFor();
    await page.evaluate(() => {
      const metrics = { compiles: 0, draws: 0, compileMs: 0 };
      Object.assign(window, { catalogMetrics: metrics });
      const compile = WebGL2RenderingContext.prototype.compileShader;
      WebGL2RenderingContext.prototype.compileShader = function (shader) {
        const start = performance.now();
        compile.call(this, shader);
        metrics.compiles++;
        metrics.compileMs += performance.now() - start;
      };
      const draw = WebGL2RenderingContext.prototype.drawArrays;
      WebGL2RenderingContext.prototype.drawArrays = function (...args) {
        metrics.draws++;
        draw.apply(this, args);
      };
    });
    const metrics = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              catalogMetrics: { compiles: number; draws: number; compileMs: number };
            }
          ).catalogMetrics,
      );
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Elements", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Elements", exact: true })
      .getByRole("tab", { name: "Backgrounds", exact: true })
      .click();
    const backgrounds = page.getByRole("searchbox", { name: "Search backgrounds" });
    await backgrounds.fill("Warp");
    const warp = page.getByRole("button", { name: "Warp", exact: true });
    await expect(warp.locator("img")).toBeVisible();
    await expect
      .poll(() =>
        warp
          .locator("img")
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    expect((await metrics()).compiles).toBe(0);
    await warp.hover();
    await expect(warp.locator("canvas")).toBeVisible();
    await expect.poll(async () => (await metrics()).draws).toBeGreaterThan(2);
    await backgrounds.hover();
    await expect(warp.locator("canvas")).toHaveCount(0);
    const stopped = await metrics();
    await settleFrames(page);
    expect((await metrics()).draws).toBe(stopped.draws);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await warp.focus();
    await settleFrames(page);
    await expect(warp.locator("canvas")).toHaveCount(0);
    expect((await metrics()).draws).toBe(stopped.draws);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await backgrounds.focus();
    await warp.focus();
    await expect(warp.locator("canvas")).toBeVisible();
    await backgrounds.focus();
    await backgrounds.fill("");
    const beforeEffects = await metrics();
    await page
      .getByRole("tablist", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Effects", exact: true })
      .click();
    await page.getByRole("searchbox", { name: "Search effects", exact: true }).fill("Shaders");
    const heatmap = page.locator('[data-effect-catalog-id="gpu-paper-heatmap"]');
    await heatmap.scrollIntoViewIfNeeded();
    await expect(heatmap.locator("canvas")).toHaveAttribute("data-rendered", "true");
    expect((await metrics()).compiles).toBe(beforeEffects.compiles);
    await heatmap.hover();
    await expect
      .poll(async () => (await metrics()).compiles)
      .toBeGreaterThan(beforeEffects.compiles);
    await page.getByRole("searchbox", { name: "Search effects", exact: true }).hover();
    await settleFrames(page);
    const effectStopped = await metrics();
    await settleFrames(page);
    expect((await metrics()).draws).toBe(effectStopped.draws);
    expect(errors).toEqual([]);
  });
});

test.describe("video editor import discovery", () => {
  test("disconnected local projects explain how to reach project bundle import", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `bundle-discovery-${Date.now()}@example.com`);
    await createWorkspace(request, auth.token, "Bundle discovery");
    await authenticatePage(page, auth.token);
    await page.goto("/video-editor");
    const local = page.getByRole("region", { name: "Local only", exact: true });
    await expect(local).toBeVisible();
    await expect(local.getByRole("button", { name: "Import bundle", exact: true })).toBeVisible();
    await expect(local.getByRole("button", { name: "Import bundle", exact: true })).toBeDisabled();
    await expect(
      local.getByText("Project bundle imports require a connected local folder.", { exact: true }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 844 });
    const button = local.getByRole("button", { name: "Import bundle", exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeDisabled();
    await expect(
      local.getByText("Project bundle imports require a connected local folder.", {
        exact: true,
      }),
    ).toBeVisible();
  });
});

test.describe("video editor library", () => {
  test.describe(`touch timer library at 320px in light`, () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
    test("keeps favorite controls reachable on a small screen", async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
      await page.setViewportSize({ width: 1280, height: 800 });
      await createProject(page, "Touch timer library");
      await page.setViewportSize({ width: 320, height: 844 });
      await page
        .getByRole("navigation", { name: "Editor panels", exact: true })
        .getByRole("button", { name: "Media", exact: true })
        .click();
      await page
        .getByRole("tablist", { name: "Assets", exact: true })
        .getByRole("tab", { name: "Elements", exact: true })
        .click();
      await page
        .getByRole("tablist", { name: "Elements", exact: true })
        .getByRole("tab", { name: "Timers", exact: true })
        .click();
      const ringCard = page.getByRole("button", { name: "Ring", exact: true }).last();
      const cardBounds = await ringCard.boundingBox();
      const previewBounds = await ringCard.locator("canvas").boundingBox();
      expect(previewBounds!.y).toBeGreaterThanOrEqual(cardBounds!.y);
      expect(previewBounds!.y + previewBounds!.height).toBeLessThanOrEqual(
        cardBounds!.y + cardBounds!.height,
      );
      const favorite = page.getByRole("button", { name: "Favorite Ring", exact: true });
      await favorite.scrollIntoViewIfNeeded();
      const bounds = await favorite.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      const cardAfterScroll = await ringCard.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
        cardAfterScroll!.y + cardAfterScroll!.height,
      );
      await expect(favorite).toHaveCSS("opacity", "1");
      await favorite.tap();
      await expect(favorite).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("tab", { name: "Library", exact: true }).click();
      await expect(page.getByRole("button", { name: "Ring", exact: true }).first()).toBeVisible();
    });
  });

  test(`library hearts follow the hovered or focused card in light`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.setViewportSize({ width: 1280, height: 800 });
    await createProject(page, "Contextual library favorites");
    const openPanel = async (tab: string) => {
      const rail = page.getByRole("navigation", { name: "Assets", exact: true });
      if (tab === "Transition") {
        await page
          .getByRole("tablist", { name: "Effects", exact: true })
          .getByRole("tab", { name: "Transition", exact: true })
          .click();
      } else if (tab === "Timers") {
        await rail.getByRole("tab", { name: "Elements", exact: true }).click();
        await page
          .getByRole("tablist", { name: "Elements", exact: true })
          .getByRole("tab", { name: "Timers", exact: true })
          .click();
      } else {
        await rail.getByRole("tab", { name: tab, exact: true }).click();
      }
    };
    for (const tab of ["Effects", "Transition", "Text", "Timers"]) {
      await openPanel(tab);
      const hearts = page.getByRole("button", { name: /^Favorite / });
      const heart = hearts.first();
      const card = heart.locator("..");
      const item = card.getByRole("button").first();
      await expect(heart).toBeAttached();
      await page.mouse.move(1000, 100);
      await page.getByRole("tab", { name: "Edit", exact: true }).focus();
      await expect(heart).toHaveCSS("opacity", "0");
      await item.hover();
      await expect(heart).toHaveCSS("opacity", "1");
      await expect(hearts.nth(1)).toHaveCSS("opacity", "0");
      const bounds = await heart.boundingBox();
      const itemBounds = await item.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(itemBounds!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(itemBounds!.x + itemBounds!.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(itemBounds!.y);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(itemBounds!.y + itemBounds!.height);
      await heart.hover();
      await expect(heart).toHaveCSS("opacity", "1");
      await page.mouse.move(1000, 100);
      await expect(heart).toHaveCSS("opacity", "0");
      await item.focus();
      await expect(heart).toHaveCSS("opacity", "1");
      await page.keyboard.press("Tab");
      await expect(heart).toBeFocused();
      await expect(heart).toHaveCSS("opacity", "1");
      await heart.press("Enter");
      await expect(heart).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("tab", { name: "Edit", exact: true }).focus();
      await expect(heart).toHaveCSS("opacity", "0");
    }
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Library", exact: true })
      .click();
    const savedHeart = page.getByRole("button", { name: "Favorite Countdown", exact: true });
    await expect(savedHeart).toHaveCSS("opacity", "0");
    await page.getByRole("button", { name: "Countdown", exact: true }).first().hover();
    await expect(savedHeart).toHaveCSS("opacity", "1");
    await page.mouse.move(1000, 100);
    await expect(savedHeart).toHaveCSS("opacity", "0");
    await savedHeart.focus();
    await expect(savedHeart).toHaveCSS("opacity", "1");
  });

  test(`saved timers, repeat, chapters and frame handoff in light`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.setViewportSize({ width: 1280, height: 800 });
    await createProject(page, "Reusable timer workflow");
    const projectURL = page.url();
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Elements", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Elements", exact: true })
      .getByRole("tab", { name: "Timers", exact: true })
      .click();
    const ringCard = page.getByRole("button", { name: "Ring", exact: true });
    const cardBounds = await ringCard.boundingBox();
    const previewBounds = await ringCard.locator("canvas").boundingBox();
    expect(previewBounds!.y).toBeGreaterThanOrEqual(cardBounds!.y);
    expect(previewBounds!.y + previewBounds!.height).toBeLessThanOrEqual(
      cardBounds!.y + cardBounds!.height,
    );
    const favoriteRing = page.getByRole("button", { name: "Favorite Ring", exact: true });
    await favoriteRing.focus();
    await favoriteRing.press("Enter");
    await expect(favoriteRing).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Ring", exact: true }).first().click();
    const duration = page.getByRole("spinbutton", {
      name: "Duration (seconds)",
      exact: true,
    });
    await duration.fill("45");
    await duration.press("Tab");
    await expect(duration).toHaveValue("45");
    await page
      .getByRole("region", { name: "Text", exact: true })
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    const thickness = page.getByRole("spinbutton", { name: "Thickness (%)", exact: true });
    const segments = page.getByRole("spinbutton", { name: "Segments", exact: true });
    await thickness.fill("12");
    await thickness.press("Tab");
    await segments.fill("8");
    await segments.press("Tab");
    await expect(thickness).toHaveValue("12");
    await page.getByRole("textbox", { name: "Finish text", exact: true }).fill("GO");
    await page.getByRole("textbox", { name: "Finish text", exact: true }).press("Tab");
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Library", exact: true })
      .click();
    await page.getByRole("button", { name: "Save selection to library", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("My rest timer");
    await page
      .getByRole("textbox", { name: "Collection, optional", exact: true })
      .fill("Tutorials");
    await page.locator("form button[type=submit]").click();
    await expect(
      page.getByRole("button", { name: "My rest timer", exact: true }).first(),
    ).toBeVisible();
    await page.getByText("Repeat selection", { exact: true }).first().click();
    await page.getByRole("button", { name: "Repeat selection", exact: true }).click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(3);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await expect
      .poll(() =>
        page.locator("#video-editor-program-panel canvas").evaluateAll((canvases) =>
          canvases.some((element) => {
            const canvas = element as HTMLCanvasElement;
            const context = canvas.getContext("2d");
            if (!context || !canvas.width) return false;
            const pixels = context.getImageData(
              Math.floor(canvas.width * 0.4),
              Math.floor(canvas.height * 0.4),
              Math.max(1, Math.floor(canvas.width * 0.2)),
              Math.max(1, Math.floor(canvas.height * 0.2)),
            ).data;
            return pixels.some(
              (value, index) =>
                index % 4 === 0 &&
                value > 250 &&
                pixels[index + 1]! > 250 &&
                pixels[index + 2]! > 250 &&
                pixels[index + 3]! > 250,
            );
          }),
        ),
      )
      .toBe(true);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Save", exact: true }).click();
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    const savedTimer = page.getByRole("button", { name: "My rest timer", exact: true }).first();
    try {
      await expect(savedTimer).toBeVisible({ timeout: 15_000 });
    } catch {
      await page
        .getByRole("navigation", { name: "Assets", exact: true })
        .getByRole("tab", { name: "Library", exact: true })
        .click();
      await expect(savedTimer).toBeVisible({ timeout: 10_000 });
    }
    await savedTimer.click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(2);
    await expect(duration).toHaveValue("45");
    await page
      .getByRole("region", { name: "Text", exact: true })
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await expect(thickness).toHaveValue("12");
    await expect(segments).toHaveValue("8");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page.setViewportSize({ width: 320, height: 844 });
    await page
      .getByRole("navigation", { name: "Editor panels", exact: true })
      .getByRole("button", { name: "Media", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Elements", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Elements", exact: true })
      .getByRole("tab", { name: "Timers", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "My rest timer", exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "My rest timer", exact: true })
      .first()
      .scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "Add marker", exact: true }).click();
    await page.getByRole("textbox", { name: "Label", exact: true }).fill("Warm up");
    await page.getByRole("textbox", { name: "Label", exact: true }).press("Enter");
    await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Export video",
      exact: true,
    });
    await dialog.locator("summary").filter({ hasText: "Chapters" }).click();
    await expect(dialog.getByRole("textbox", { name: "Chapters", exact: true })).toHaveValue(
      "00:00 Warm up",
    );
    await dialog.getByRole("textbox", { name: "Chapters", exact: true }).fill("00:00 Introduction");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await dialog.getByRole("button", { name: "Copy chapters", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("00:00 Introduction");
    await page.keyboard.press("Escape");
    await page
      .locator("#video-editor-program-panel")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", {
        name: "Open current frame in Image Editor",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/image-editor\//u, { timeout: 30_000 });
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(
        () =>
          page
            .locator("canvas.lower-canvas")
            .first()
            .evaluate((element) => {
              const canvas = element as HTMLCanvasElement;
              const data = canvas
                .getContext("2d")!
                .getImageData(0, 0, canvas.width, canvas.height).data;
              let white = 0;
              for (let index = 0; index < data.length; index += 4)
                if (
                  data[index]! > 250 &&
                  data[index + 1]! > 250 &&
                  data[index + 2]! > 250 &&
                  data[index + 3]! > 250
                )
                  white++;
              return white;
            }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(100);
    await page.goto(projectURL);
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  for (const style of ["Bomb", "Tomato"] as const) {
    test(`sculpted ${style} appearance controls`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await createProject(page, `${style} timer`);
      await page
        .getByRole("navigation", { name: "Assets", exact: true })
        .getByRole("tab", { name: "Elements", exact: true })
        .click();
      await page
        .getByRole("tablist", { name: "Elements", exact: true })
        .getByRole("tab", { name: "Timers", exact: true })
        .click();
      await page.getByRole("button", { name: style, exact: true }).click();
      await page
        .getByRole("region", { name: "Text", exact: true })
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await expect(
        page.getByRole("checkbox", { name: "Completion effect", exact: true }),
      ).toBeChecked();
      await page.getByRole("checkbox", { name: "Show numbers", exact: true }).uncheck();
      await page.getByRole("checkbox", { name: "Show numbers", exact: true }).check();
      const bodyColor = page.getByRole("button", { name: "Body color", exact: true });
      await bodyColor.click();
      const hex = page.getByRole("textbox", { name: "Hex color", exact: true });
      await hex.fill("#2855FF");
      await hex.press("Enter");
      await page.keyboard.press("Escape");
      await expect(bodyColor).toHaveAttribute("title", "Body color: #2855FF");
      await page.setViewportSize({ width: 320, height: 844 });
      await page.getByRole("button", { name: "Properties", exact: true }).click();
      await bodyColor.scrollIntoViewIfNeeded();
      await expect(bodyColor).toBeVisible();
    });
  }
});

test.describe("video editor media recovery", () => {
  async function createProject(page: Page): Promise<string> {
    await installLocalWorkspacePicker(page);
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Choose folder" }).click();
    await page.getByRole("button", { name: "Custom project" }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Recovery proof");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
    return new URL(page.url()).pathname.split("/").at(-1)!;
  }

  async function seedMissingMedia(page: Page, projectId: string): Promise<void> {
    await page.evaluate(async (id) => {
      const root = await navigator.storage.getDirectory();
      const png = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        ),
        (character) => character.charCodeAt(0),
      );
      async function directory(path: string[]): Promise<FileSystemDirectoryHandle> {
        let current = root;
        for (const segment of path)
          current = await current.getDirectoryHandle(segment, { create: true });
        return current;
      }
      async function write(path: string[], value: string | Uint8Array): Promise<void> {
        const parent = await directory(path.slice(0, -1));
        const handle = await parent.getFileHandle(path.at(-1)!, { create: true });
        const writable = await handle.createWritable();
        await writable.write(value);
        await writable.close();
      }

      await write(["recovery", "exact", "source.png"], png);
      await write(["recovery", "one", "duplicate.png"], png);
      await write(["recovery", "two", "duplicate.png"], png);

      const metadata = (mediaId: string, fileName: string, sourcePath?: string) => ({
        id: mediaId,
        storageType: "workspace",
        fileName,
        fileSize: png.byteLength,
        sourcePath,
        mimeType: "image/png",
        duration: 0,
        width: 1,
        height: 1,
        fps: 0,
        codec: "",
        bitrate: 0,
        tags: ["image"],
      });
      await write(
        ["media", "exact", "metadata.json"],
        JSON.stringify(metadata("exact", "source.png", "recovery/exact/source.png")),
      );
      await write(
        ["media", "conflict", "metadata.json"],
        JSON.stringify(metadata("conflict", "duplicate.png")),
      );
      await write(
        ["media", "unmatched", "metadata.json"],
        JSON.stringify(metadata("unmatched", "gone.png")),
      );
      await write(
        ["projects", id, "media-links.json"],
        JSON.stringify({
          version: "1.0",
          mediaIds: ["exact", "conflict", "unmatched"].map((mediaId) => ({
            id: mediaId,
            addedAt: Date.now(),
          })),
        }),
      );
    }, projectId);
  }

  test("Video Editor previews safe folder matches before batch recovery", async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ colorScheme: "light" });
    const projectId = await createProject(page);
    await seedMissingMedia(page, projectId);
    await page.reload();

    await expect(page.getByRole("heading", { name: "Restore project media" })).toBeVisible();
    await page.getByRole("button", { name: "Scan folder" }).click();
    await expect(page.getByText("1 ready, 1 need review, 1 not found")).toBeVisible();
    await expect(page.getByText("recovery/exact/source.png", { exact: true })).toBeVisible();
    await expect(page.getByText("recovery/one/duplicate.png", { exact: true })).toBeVisible();
    await expect(page.getByText("recovery/two/duplicate.png", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Relink files (1)" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(false);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.setViewportSize({ width: 320, height: 720 });

    await page.getByRole("button", { name: "Relink files (1)" }).click();
    await expect(page.getByText("0 ready, 1 need review, 1 not found")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Scan folder" })).toBeEnabled();
    await page.reload();
    const recovery = page.getByRole("dialog", { name: "Restore project media" });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByText("source.png", { exact: true })).toHaveCount(0);
    await expect(recovery.getByText("duplicate.png", { exact: true })).toBeVisible();
    await expect(recovery.getByText("gone.png", { exact: true })).toBeVisible();
  });
});

test.describe("video editor motion group", () => {
  test("Motion repeated Group keeps one saved group and one undoable edit", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await createProject(page, "Audit Motion repeated Group");
    await page.getByRole("tab", { name: "Motion", exact: true }).click();
    await page.getByRole("button", { name: "New composition", exact: true }).click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const timeline = page.getByRole("region", { name: "Composition timeline", exact: true });
    for (let index = 0; index < 3; index++) {
      await timeline.getByRole("button", { name: "Text", exact: true }).first().click();
    }
    const layers = timeline.locator('[role="button"][data-testid^="composition-layer-"]');
    await expect(layers).toHaveCount(3);
    await layers.nth(0).focus();
    await page.keyboard.press("Enter");
    await layers.nth(1).focus();
    await page.keyboard.press("Control+Enter");
    await expect(layers.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(layers.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("composition-group").click();
    const groups = timeline.locator('[data-testid^="group-row-"]');
    await expect(groups).toHaveCount(1);
    const originalId = await groups.first().getAttribute("data-testid");
    await layers.nth(0).focus();
    await page.keyboard.press("Control+g");
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toHaveAttribute("data-testid", originalId!);
    await expect(page.getByTestId("composition-group")).toBeDisabled();
    for (const command of ["Undo", "Redo"]) {
      await page
        .getByRole("banner")
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await page.getByRole("menuitem", { name: command, exact: true }).click();
      await expect(groups).toHaveCount(command === "Undo" ? 0 : 1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
    }
    await expect(groups.first()).toHaveAttribute("data-testid", originalId!);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Save", exact: true }).click();
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.reload();
    await page.getByRole("tab", { name: "Motion", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toHaveAttribute("data-testid", originalId!);
    await expect(layers).toHaveCount(3);
    await layers.nth(0).focus();
    await page.keyboard.press("Enter");
    await layers.nth(1).focus();
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("composition-group")).toBeDisabled();
    await page.keyboard.press("Control+g");
    await expect(groups).toHaveCount(1);
    await groups.first().scrollIntoViewIfNeeded();
    expect(errors).toEqual([]);
  });
});

test.describe("video editor panels", () => {
  test("animation application settings survive inspector tab switches without creating history", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await createProject(page, "Animation application settings");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    const inspector = page.locator("#video-editor-tools-panel");
    const animation = inspector.locator('[data-edit-inspector-tab="motion"]');
    const saveIndicator = page.getByRole("banner").locator('[role="status"][data-state]');
    const duration = inspector.getByRole("slider", { name: "Duration", exact: true });
    const intensity = inspector.getByRole("slider", { name: "Intensity", exact: true });
    const stagger = inspector.getByRole("slider", { name: "Stagger frames", exact: true });
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.reload();
    await page.locator("[data-timeline-item-id]").click();
    await animation.click();
    const originalSaveState = (await saveIndicator.getAttribute("data-state")) ?? "";
    expect(["idle", "saved"]).toContain(originalSaveState);
    await duration.press("End");
    await intensity.press("Home");
    await stagger.press("ArrowRight");
    await stagger.press("ArrowRight");
    await inspector.getByRole("button", { name: "Add", exact: true }).click();
    await expect(duration).toHaveAttribute("aria-valuenow", "3");
    await expect(intensity).toHaveAttribute("aria-valuenow", "0");
    await expect(stagger).toHaveAttribute("aria-valuenow", "2");
    await page.setViewportSize({ width: 1280, height: 844 });
    await animation.focus();
    await animation.press("Home");
    await expect(inspector.locator('[data-edit-inspector-tab="properties"]')).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(animation).toBeFocused();
    await expect(duration).toHaveAttribute("aria-valuenow", "3");
    await expect(intensity).toHaveAttribute("aria-valuenow", "0");
    await expect(stagger).toHaveAttribute("aria-valuenow", "2");
    await expect(inspector.getByRole("button", { name: "Add", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await stagger.scrollIntoViewIfNeeded();
    await expect(saveIndicator).toHaveAttribute("data-state", originalSaveState);
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Undo", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await page.locator("[data-timeline-item-id]").click();
    await animation.click();
    await expect(duration).toHaveAttribute("aria-valuenow", "1");
    await expect(intensity).toHaveAttribute("aria-valuenow", "1");
    await expect(stagger).toHaveAttribute("aria-valuenow", "0");
    await expect(inspector.getByRole("button", { name: "Replace", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test(`Color keeps its viewer and complete wheels usable on a laptop in light`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.setViewportSize({ width: 1280, height: 720 });
    await createProject(page, "Focused Color layout");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await page.getByRole("tab", { name: "Color", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Lift color wheel", exact: true })).toBeVisible();

    for (const label of ["Show one scope", "Show all scopes"]) {
      const control = page.getByRole("button", { name: label, exact: true });
      const offset = await control.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        const icon = button.firstElementChild!.getBoundingClientRect();
        return {
          x: Math.abs(bounds.x + bounds.width / 2 - icon.x - icon.width / 2),
          y: Math.abs(bounds.y + bounds.height / 2 - icon.y - icon.height / 2),
        };
      });
      expect(offset.x, `${label} icon must be horizontally centered`).toBeLessThanOrEqual(1);
      expect(offset.y, `${label} icon must be vertically centered`).toBeLessThanOrEqual(1);
    }

    const viewer = page.locator("#video-editor-program-panel");
    await expect.poll(async () => (await viewer.boundingBox())!.height).toBeGreaterThanOrEqual(280);
    for (const name of ["Lift", "Gamma", "Gain", "Offset"]) {
      const wheel = page.getByRole("slider", { name: `${name} color wheel`, exact: true });
      await expect.poll(async () => (await wheel.boundingBox())!.width).toBeGreaterThanOrEqual(104);
      const visibleFraction = await wheel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        let top = Math.max(0, bounds.top);
        let bottom = Math.min(innerHeight, bounds.bottom);
        let left = Math.max(0, bounds.left);
        let right = Math.min(innerWidth, bounds.right);
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const rect = ancestor.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            top = Math.max(top, rect.top);
            bottom = Math.min(bottom, rect.bottom);
          }
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            left = Math.max(left, rect.left);
            right = Math.min(right, rect.right);
          }
        }
        return (
          (Math.max(0, bottom - top) * Math.max(0, right - left)) / (bounds.width * bounds.height)
        );
      });
      expect(visibleFraction, `${name} wheel must not be clipped by its panel`).toBeGreaterThan(
        0.98,
      );
    }
    await expect(page.getByRole("toolbar", { name: "On-canvas editing tools" })).toBeHidden();
    const lift = page.getByRole("slider", { name: "Lift color wheel", exact: true });
    const originalLift = await lift.getAttribute("aria-valuetext");
    await lift.press("ArrowRight");
    await expect(lift).not.toHaveAttribute("aria-valuetext", originalLift!);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    await expect(lift).toHaveAttribute("aria-valuetext", originalLift!);
    await page.getByRole("tab", { name: "Curves", exact: true }).click();
    await expect(
      page.getByRole("group", { name: "Master curve editor", exact: true }),
    ).toBeVisible();
    await expect(lift).toBeHidden();
    const curveMarker = page
      .locator("[data-curves-editor] circle, [data-curves-editor] ellipse")
      .nth(1);
    await expect
      .poll(async () => {
        const box = await curveMarker.boundingBox();
        return box ? Math.abs(box.width - box.height) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThan(1);
    const markerBox = (await curveMarker.boundingBox())!;
    expect(markerBox.width).toBeGreaterThanOrEqual(8);
    expect(markerBox.width).toBeLessThanOrEqual(16);
    await expect(
      page.getByRole("button", { name: "Toggle auto-keyframe", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Before", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Effects", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add effect", exact: true })).toBeVisible();
    const keyframes = page.getByRole("button", { name: "Keyframes", exact: true });
    await keyframes.click();
    await expect(
      page.getByRole("button", { name: "Toggle auto-keyframe", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
    await page.getByRole("tab", { name: "Color", exact: true }).click();
    await expect(keyframes).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "Primaries", exact: true }).click();
    const scopes = page.getByRole("complementary", { name: "Scopes", exact: true });
    const previewWidth = (await viewer.boundingBox())!.width;
    await page.getByRole("button", { name: "Scopes", exact: true }).click();
    await expect(scopes).toBeHidden();
    await expect
      .poll(async () => (await viewer.boundingBox())!.width)
      .toBeGreaterThan(previewWidth);
    await expect(lift).toHaveAttribute("aria-valuetext", originalLift!);
    await page.getByRole("tab", { name: "Curves", exact: true }).click();
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
    await page.getByRole("tab", { name: "Color", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Curves", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(scopes).toBeHidden();
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Save", exact: true }).click();
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("tab", { name: "Curves", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(scopes).toBeHidden();
    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByRole("tab", { name: "Secondary Qualifier", exact: true }).click();
    await expect(
      page.getByRole("tabpanel", { name: "Secondary Qualifier", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add effect · Secondary Qualifier", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Curves", exact: true }).click();
  });

  test("text content is immediately editable without scrolling past transforms or templates", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await createProject(page, "Text inspector priority");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    const inspector = page.locator("#video-editor-tools-panel");
    const content = inspector.locator("textarea");
    await expect(content).toBeInViewport({ ratio: 1 });
    await expect(inspector.getByRole("spinbutton", { name: "Size", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(inspector.getByRole("button", { name: "Text color", exact: true })).toBeInViewport(
      {
        ratio: 1,
      },
    );
    await content.fill("Words come first");
    await content.press("Tab");
    await expect(page.locator("[data-timeline-item-id]")).toContainText("Words come first");
    await inspector.getByRole("button", { name: "Browse styles", exact: true }).click();
    const style = page.getByRole("button", { name: "Apply Clean", exact: true });
    await style.click();
    await expect(style).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await expect(content).toHaveValue("Words come first");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    await expect(style).toHaveAttribute("aria-pressed", "false");
  });

  test("sidebar columns leave the preview visible and bound the timeline", async ({ page }) => {
    await createProject(page, "Panel layout");
    const preview = page.locator("#video-editor-program-panel");

    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.locator('[data-layout-toggle="expand-column-right"]').click();
    await expect(preview).toBeVisible();
    const tools = await page.locator("#video-editor-tools-panel").boundingBox();
    const timeline = await page.locator("footer").boundingBox();
    expect(tools!.y + tools!.height).toBeCloseTo(timeline!.y + timeline!.height, 0);
    expect(timeline!.x + timeline!.width).toBeLessThanOrEqual(tools!.x + 1);
  });

  test("a collapsed asset tab opens its panel in one click", async ({ page }) => {
    await createProject(page, "Collapsed tabs");
    await page.locator('[data-layout-toggle="collapse-left"]').click();
    await page.locator('[data-left-panel-tab="media"][data-tab-orientation="vertical"]').click();
    await expect(page.locator('[data-layout-toggle="collapse-left"]')).toBeVisible();
  });

  test(`property panels stay neutral while controls retain their accent in light`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await createProject(page, "Neutral properties");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    const panels = page.getByTestId("clip-transform-panel").locator("section");
    await expect(panels).toHaveCount(2);
    for (const panel of await panels.all()) {
      const colors = await panel.evaluate((element) => {
        const probe = document.createElement("span");
        element.append(probe);
        probe.style.backgroundColor = "var(--card)";
        const neutral = getComputedStyle(probe).backgroundColor;
        probe.style.backgroundColor = "var(--action-ordinary-hover)";
        const hover = getComputedStyle(probe).backgroundColor;
        probe.remove();
        let surface: Element | null = element;
        let actual = "rgba(0, 0, 0, 0)";
        while (surface) {
          const background = getComputedStyle(surface).backgroundColor;
          if (background !== "rgba(0, 0, 0, 0)") {
            actual = background;
            break;
          }
          surface = surface.parentElement;
        }
        return { actual, neutral, hover };
      });
      expect(colors.actual).toBe(colors.neutral);
      expect(colors.actual).not.toBe(colors.hover);
    }
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const opacity = page.getByRole("slider", { name: "Opacity", exact: true });
    await opacity.focus();
    await opacity.press("ArrowLeft");
    await expect(opacity).toHaveAttribute("aria-valuenow", "99");
    const accents = await opacity.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.transition = "none";
      element.append(probe);
      const color = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const focus = color("--ring");
      const editor = color("--video-editor-focus");
      const primary = color("--action-focal");
      probe.remove();
      return { focus, editor, primary };
    });
    const hue = (color: string) => {
      const coordinates = /^oklch\([\d.]+\s+[\d.]+\s+([\d.]+)\)$/.exec(color);
      expect(coordinates, `expected a computed OKLCH color, received ${color}`).not.toBeNull();
      return Number(coordinates![1]);
    };
    expect(hue(accents.focus), "focus follows the active theme's hue").toBe(hue(accents.primary));
    expect(accents.editor, "editor selections follow the same focus accent").toBe(accents.focus);
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(page.locator("[data-program-monitor]")).toBeVisible();
  });

  test(`panel transitions preserve geometry and size in light`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await createProject(page, "Panel transitions");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await expect(page.locator("[data-program-monitor]")).toBeVisible();
    const assets = page.locator("#video-editor-assets-panel");
    const tools = page.locator("#video-editor-tools-panel");
    const preview = page.locator("#video-editor-program-panel");
    const footer = page.locator("footer");
    async function toggleDock(attribute: string) {
      await page
        .getByRole("banner")
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await page.locator(`[data-layout-toggle="${attribute}"]`).click();
    }
    const player = await preview.locator("[data-program-monitor]").elementHandle();
    async function assertLayout(leftFull: boolean, rightFull: boolean) {
      await expect(preview).toBeVisible();
      await expect(async () => {
        const [a, t, f] = await page.evaluate(() =>
          ["#video-editor-assets-panel", "#video-editor-tools-panel", "footer"].map((selector) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );
        expect(f.x).toBeCloseTo(leftFull ? a.x + a.width : a.x, 0);
        expect(f.x + f.width).toBeCloseTo(rightFull ? t.x : t.x + t.width, 0);
        expect(a.y + a.height).toBeCloseTo(leftFull ? f.y + f.height : f.y, 0);
        expect(t.y + t.height).toBeCloseTo(rightFull ? f.y + f.height : f.y, 0);
      }).toPass({ timeout: 3000 });
      expect(await player!.evaluate((node) => node.isConnected)).toBe(true);
    }
    async function assertFullColumns() {
      await page
        .getByRole("banner")
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await expect(page.locator('[data-layout-toggle="expand-column-left"]')).toHaveText(
        "Place panel above timeline",
      );
      await expect(page.locator('[data-layout-toggle="expand-column-right"]')).toHaveText(
        "Place panel above timeline",
      );
      await page.keyboard.press("Escape");
    }
    await assertLayout(true, false);
    const resize = page.getByRole("separator", { name: "Assets", exact: true });
    await resize.press("ArrowRight");
    await expect.poll(async () => (await assets.boundingBox())!.width).toBeGreaterThan(336);
    const resizedWidth = (await assets.boundingBox())!.width;
    expect(resizedWidth).toBeGreaterThan(336);
    const timelineResize = page.getByRole("separator", { name: "Timeline", exact: true });
    const beforeHeight = (await footer.boundingBox())!.height;
    const grip = (await timelineResize.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y - 40, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => (await footer.boundingBox())!.height)
      .toBeGreaterThan(beforeHeight + 30);
    for (let repeat = 0; repeat < 2; repeat++) {
      await toggleDock("expand-column-right");
      await assertLayout(true, true);
      await toggleDock("expand-column-left");
      await assertLayout(false, true);
      await toggleDock("expand-column-right");
      await assertLayout(false, false);
      await toggleDock("expand-column-left");
      await assertLayout(true, false);
      await page.locator('[data-layout-toggle="collapse-left"]').click();
      await assertLayout(true, false);
      await page.locator('[data-layout-toggle="expand-left"]').click();
      await page.locator('[data-layout-toggle="collapse-right"]').click();
      await assertLayout(true, false);
      await page.locator('[data-layout-toggle="expand-right"]').click();
      expect((await assets.boundingBox())!.width).toBeCloseTo(resizedWidth, 0);
    }
    await page.locator("[data-program-monitor]").focus();
    await page.keyboard.press("ControlOrMeta+Alt+ArrowRight");
    await assertLayout(true, true);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    async function enterTheater() {
      await preview.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Enter theater mode", exact: true }).click();
    }
    await enterTheater();
    await assertLayout(false, false);
    await page.keyboard.press("Escape");
    await assertLayout(true, true);
    await enterTheater();
    await page.locator("[data-program-monitor]").focus();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(page.locator("[data-program-monitor]")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Alt+ArrowRight");
    await expect(page.locator('[data-layout-toggle="theater"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await assertLayout(true, false);
    await toggleDock("expand-column-right");
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 20_000,
    });
    await assertFullColumns();
    expect((await assets.boundingBox())!.width).toBeCloseTo(resizedWidth, 0);
    for (const workspace of ["Color", "Motion", "Edit"]) {
      await page
        .getByRole("tablist", { name: "Editor workspaces" })
        .getByRole("tab", { name: workspace, exact: true })
        .click();
      await expect(page.locator("#editor-workspace-panel")).toBeVisible();
    }
    await assertFullColumns();
    await page.setViewportSize({ width: 1024, height: 900 });

    await expect(preview).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Color palettes explain their action and landscape workspaces retain a usable preview", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await createProject(page, "Palette and landscape review");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await page.getByRole("tab", { name: "Color", exact: true }).click();
    for (const palette of ["Secondary Qualifier", "Power Window", "3D LUT"]) {
      await page.getByRole("tab", { name: palette, exact: true }).click();
      await expect(
        page.getByRole("button", { name: `Add effect · ${palette}`, exact: true }),
      ).toBeVisible();
      await expect(page.getByText("No effects on this clip.", { exact: true })).toBeHidden();
    }
    await page.getByRole("tab", { name: "Secondary Qualifier", exact: true }).click();
    await page
      .getByRole("button", { name: "Add effect · Secondary Qualifier", exact: true })
      .click();
    await expect(page.locator("[data-effect-id]")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Add effect · Secondary Qualifier", exact: true })
      .click();
    await expect(page.locator("[data-effect-id]")).toHaveCount(2);
    await page.setViewportSize({ width: 320, height: 844 });
    const program = page.locator("#video-editor-program-panel");
    expect((await program.boundingBox())!.height).toBeGreaterThanOrEqual(190);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(
      page.getByRole("button", { name: "Enter preview fullscreen", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    const transportMenu = program.getByRole("button", { name: "More actions", exact: true });
    await transportMenu.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "Step one frame forward", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(transportMenu).toBeFocused();
    await page.setViewportSize({ width: 640, height: 450 });
    await page.getByRole("tab", { name: "Motion", exact: true }).click();
    await expect(page.getByRole("button", { name: "New composition", exact: true })).toBeVisible();
    await expect(page.getByRole("separator", { name: "Timeline", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "New composition", exact: true }).click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const timeline = page.getByRole("region", { name: "Composition timeline", exact: true });
    await timeline.getByRole("button", { name: "Text", exact: true }).first().click();
    expect(
      (await page.locator("#video-editor-program-panel").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(160);
    await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export video", exact: true });
    await expect(dialog.getByRole("button", { name: "Render now", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "Render now", exact: true })).toBeInViewport({
      ratio: 1,
    });
  });

  test(`Transcript fills the phone Assets pane and keeps its controls usable in light`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await createProject(page, "Readable transcript");
    await page.getByRole("tab", { name: "Captions", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 844 });
    await page
      .getByRole("navigation", { name: "Editor panels", exact: true })
      .getByRole("button", { name: "Media", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Captions", exact: true })
      .click();
    const transcript = page.getByRole("region", { name: "Transcript", exact: true });
    await expect(transcript).toBeVisible();
    const assetsBounds = (await page.locator("#video-editor-assets-panel").boundingBox())!;
    const transcriptBounds = (await transcript.boundingBox())!;
    expect(
      Math.abs(transcriptBounds.y + transcriptBounds.height - assetsBounds.y - assetsBounds.height),
    ).toBeLessThanOrEqual(1);
    await expect(transcript.getByText("No captions yet.", { exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(page.getByRole("searchbox", { name: "Search transcript" })).toBeInViewport({
      ratio: 1,
    });
    const search = transcript.getByRole("searchbox", { name: "Search transcript" });
    await search.focus();
    await page.keyboard.type("No caption fixture");
    await expect(search).toHaveValue("No caption fixture");
    await page.keyboard.press("Enter");
    await expect(transcript.getByText("No matches", { exact: true })).toBeVisible();
    await search.fill("");
    const options = transcript.getByRole("button", { name: "Transcript options", exact: true });
    await options.press("Enter");
    await expect(options).toHaveAttribute("aria-expanded", "true");
    await expect(
      transcript.getByRole("button", { name: "Auto-scroll", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await options.press("Enter");
    await expect(options).toHaveAttribute("aria-expanded", "false");
    await page
      .getByRole("navigation", { name: "Editor panels", exact: true })
      .getByRole("button", { name: "Timeline", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(transcript).toBeHidden();
  });

  test("Motion uses authored duration in its summary, transport, and export", async ({ page }) => {
    test.setTimeout(90_000);
    await createProject(page, "Motion duration");
    await page.getByRole("tab", { name: "Motion", exact: true }).click();
    await page.getByRole("button", { name: "New composition", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("320");
    await page.getByRole("spinbutton", { name: "Height", exact: true }).fill("240");
    await page.getByRole("spinbutton", { name: "Duration (seconds)", exact: true }).fill("12");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page
      .getByRole("toolbar", { name: "Layer tools" })
      .getByRole("button", { name: "Text", exact: true })
      .click();
    await page.locator("[data-project-details]").click();
    await expect(page.getByText(/320×240 · 30 fps · 0:12 · Clips: 1/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("img", { name: "00:00:00:00 / 00:00:12:00", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Export video" }).getByText(/12\.0s/),
    ).toBeVisible();
  });

  async function checkShortViewportPanels(
    page: Page,
    size: { width: number; height: number },
    failures: string[],
  ): Promise<void> {
    await page.setViewportSize(size);
    if (size.width < 1024) {
      await page
        .getByRole("navigation", { name: "Editor panels", exact: true })
        .getByRole("button", { name: "Media", exact: true })
        .click();
    }
    const assets = page.getByRole("complementary", { name: "Assets", exact: true });
    const assetTabs = page.getByRole("tablist", { name: "Assets", exact: true });
    for (const name of ["Media", "Text", "Captions", "Effects", "Elements", "Library"]) {
      await assetTabs.getByRole("tab", { name, exact: true }).click();
      await assets.locator("button:visible").last().focus();
      const geometry = await page.evaluate(() => ({
        height: innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        headerTop: document.querySelector("header")!.getBoundingClientRect().top,
        timelineBottom: document.querySelector("footer")!.getBoundingClientRect().bottom,
        assetsBottom: document.querySelector("#video-editor-assets-panel")!.getBoundingClientRect()
          .bottom,
        contentBottom: document
          .querySelector("#video-editor-left-tool-panel")!
          .getBoundingClientRect().bottom,
        overviewBottom: document
          .querySelector('[role="group"][aria-label="Timeline overview"]')!
          .getBoundingClientRect().bottom,
      }));
      if (
        geometry.contentBottom > geometry.assetsBottom + 1 ||
        geometry.overviewBottom > geometry.timelineBottom + 1 ||
        geometry.documentHeight > geometry.height + 1 ||
        Math.abs(geometry.headerTop) > 1 ||
        geometry.timelineBottom > geometry.height + 1
      ) {
        failures.push(`${size.width}x${size.height} ${name}: ${JSON.stringify(geometry)}`);
      }
    }
    if (size.width < 1024) {
      await page
        .getByRole("navigation", { name: "Editor panels", exact: true })
        .getByRole("button", { name: "Timeline", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Add marker", exact: true }).click();
    for (const name of ["Audio mixer", "Beat markers"]) {
      await page.getByRole("button", { name, exact: true }).click();
      if (name === "Audio mixer") {
        await page.getByRole("slider", { name: "Master output volume", exact: true }).focus();
      }
      const bounds = await page.evaluate(() => ({
        footer: document.querySelector("footer")!.getBoundingClientRect().bottom,
        trackHeight: document
          .querySelector("#video-editor-timeline-scroll")!
          .getBoundingClientRect().height,
        overview: document
          .querySelector('[role="group"][aria-label="Timeline overview"]')!
          .getBoundingClientRect().bottom,
      }));
      if (bounds.overview > bounds.footer + 1 || bounds.trackHeight < 24)
        failures.push(`${size.width}x${size.height} ${name}: ${JSON.stringify(bounds)}`);
      await page.getByRole("button", { name, exact: true }).click();
    }
  }

  test("panel content stays inside the editor when the window is short", async ({ page }) => {
    test.setTimeout(120_000);
    await createProject(page, "Contained panels");
    const failures: string[] = [];
    for (const size of [
      { width: 1440, height: 700 },
      { width: 1024, height: 500 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 320, height: 568 },
    ]) {
      await checkShortViewportPanels(page, size, failures);
    }
    expect(failures).toEqual([]);
  });
});

test.describe("video editor project summary", () => {
  async function openProjectDetails(page: Page): Promise<void> {
    await page.locator("[data-project-details]").click();
    await expect(page.locator("[data-project-summary]")).toBeVisible();
  }

  test("project summary labels stay grammatical through clip creation, Undo and saved reload", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(90_000);
    const auth = await registerUser(request, `project-summary-${Date.now()}@example.com`);
    await createWorkspace(request, auth.token, "Project summary");
    await authenticatePage(page, auth.token);
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await expect(page).toHaveURL(/\/video-editor\/[\da-f-]+\?storage=cloud/);
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
    const summary = page.locator("[data-project-summary]");
    const clips = page.locator("[data-timeline-item-id]");
    await expect(clips).toHaveCount(0);
    await openProjectDetails(page);
    await expect(summary).toHaveText("1920×1080 · 30 fps · 0:00 · Clips: 0 · Media: 0 · Issues: 0");
    for (const count of [1, 2]) {
      await page
        .getByRole("banner")
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
      await expect(clips).toHaveCount(count);
      await openProjectDetails(page);
      await expect(summary).toContainText(`Clips: ${count} · Media: 0 · Issues: 0`);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-project-summary]")).toHaveCount(0);
    await page.getByRole("application", { name: "Program", exact: true }).focus();
    const modifier = await page.evaluate(() =>
      /Mac|iPhone|iPad/i.test(navigator.platform) ? "Meta" : "Control",
    );
    await page.keyboard.press(`${modifier}+z`);
    await expect(clips).toHaveCount(1);
    await openProjectDetails(page);
    await expect(summary).toHaveText("1920×1080 · 30 fps · 0:03 · Clips: 1 · Media: 0 · Issues: 0");
    await expect(page.locator('[role="status"][data-state="saved"]')).toBeVisible();
    const projectURL = page.url();
    await page.reload();
    await expect(page).toHaveURL(projectURL);
    await expect(clips).toHaveCount(1);
    await openProjectDetails(page);
    await expect(summary).toHaveText("1920×1080 · 30 fps · 0:03 · Clips: 1 · Media: 0 · Issues: 0");
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProjectDetails(page);
    await expect(summary).toHaveAttribute(
      "title",
      "1920×1080 · 30 fps · 0:03 · Clips: 1 · Media: 0 · Issues: 0",
    );
    await expect(summary).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await page.keyboard.press("Escape");
  });
});

test.describe("video editor repair", () => {
  const CLOUD_SAVE_TIMEOUT_MS = 15_000;

  async function openRecorder(page: Page): Promise<void> {
    const assetsPanel = page.getByRole("complementary", { name: "Assets", exact: true });
    if (!(await assetsPanel.isVisible())) {
      await page
        .getByRole("navigation", { name: "Editor panels", exact: true })
        .getByRole("button", { name: "Media", exact: true })
        .click();
    }
    await assetsPanel.getByRole("button", { name: "More ways to add media", exact: true }).click();
    await page.getByRole("menuitem", { name: "Record", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Recorder", exact: true })).toBeVisible();
  }

  async function expectProjectSummary(page: Page, expected: string | RegExp): Promise<void> {
    const details = page.locator("[data-project-details]");
    if (await details.isVisible()) {
      await details.click();
      await expect(page.locator("[data-project-summary]")).toContainText(expected);
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-project-summary]")).toHaveCount(0);
      return;
    }
    // Narrow headers hide the project title; the timeline carries the same clip count.
    const expectedClips = Number(String(expected).match(/\d+/)?.[0] ?? "-1");
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(expectedClips);
  }

  test("header history actions close after the selected command becomes disabled", async ({
    page,
    request,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `history-menu-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "History menu");
    await authenticatePage(page, auth.token);
    await newProject(page, "History menu proof");
    await page.locator("header").getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    const header = page.getByRole("banner");
    const more = header.getByRole("button", { name: "More actions", exact: true });
    await expectProjectSummary(page, "Clips: 1");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
    await page.setViewportSize({ width: 1280, height: 844 });
    for (const command of ["Undo", "Redo"] as const) {
      await more.click();
      const action = page.getByRole("menuitem", { name: command, exact: true });
      await action.click();
      await expect(page.getByRole("menu")).toHaveCount(0);

      await expectProjectSummary(page, command === "Undo" ? "Clips: 0" : "Clips: 1");
    }
    await more.click();
    await expect(page.getByRole("menuitem", { name: "Redo", exact: true })).toBeDisabled();
    await page.getByRole("menuitem", { name: "Save", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(header.locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    await expectProjectSummary(page, "Clips: 1");
    expect(errors).toEqual([]);
  });

  async function newProject(page: Page, name: string) {
    if (new URL(page.url()).pathname !== "/video-editor") await page.goto("/video-editor");
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await page.locator("[data-project-details]").click();
    const title = page.getByRole("textbox", { name: "Project name" });
    await expect(title).toHaveValue("Untitled project");
    await title.fill(name);
    await title.press("Tab");
    await page.keyboard.press("Escape");
    await expect(page.locator('header [role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
      {
        timeout: CLOUD_SAVE_TIMEOUT_MS,
      },
    );
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  }

  test("cloud editing saves text, preserves spaces and reopens without a refresh", async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);
    const auth = await registerUser(request, `editor-repair-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Editor repair");
    await authenticatePage(page, auth.token);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.log(message.text());
    });
    await page.setViewportSize({ width: 1600, height: 900 });
    await newProject(page, "Text proof");
    const header = page.getByRole("banner");
    const controls = [
      header.getByRole("button", { name: "Undo", exact: true }),
      header.getByRole("button", { name: "Redo", exact: true }),
      header.getByRole("button", { name: "More actions", exact: true }),
      header.getByRole("button", { name: "Export", exact: true }),
    ];
    let previousRight = 0;
    for (const control of controls) {
      await expect(control).toBeInViewport();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(previousRight);
      previousRight = bounds!.x + bounds!.width;
    }
    await expect(header.getByRole("button").last()).toHaveAccessibleName("Export");
    const url = page.url();
    await page.locator("header").getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await page
      .getByRole("toolbar", { name: "On-canvas editing tools" })
      .getByRole("button", { name: "Text", exact: true })
      .click();
    const editor = page.getByRole("textbox", { name: /Edit text on canvas/ });
    await expect(editor).toBeFocused();
    await editor.press("ControlOrMeta+a");
    await editor.pressSequentially("A launch with spaces");
    await expect(editor).toHaveText("A launch with spaces");
    await editor.press("ControlOrMeta+Enter");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByRole("img", { name: "Your text", exact: true })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(
      page.getByRole("img", { name: "A launch with spaces", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.locator('header [role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
      {
        timeout: CLOUD_SAVE_TIMEOUT_MS,
      },
    );
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await page.goto(url);
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
    await expect(
      page.getByRole("img", { name: "A launch with spaces", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Save failed", { exact: false })).toHaveCount(0);
    await page.locator("header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    await page.getByRole("dialog").getByText("WebM", { exact: true }).click();
    await page.getByRole("option", { name: "MP4", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Render now", exact: true }).click();
    await expect(
      page.getByText("Saved Text proof.mp4.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: "Exports", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Download Text proof.mp4", exact: true }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await newProject(page, "Text proof");
    await expectProjectSummary(page, "Clips: 0");
    expect(errors).toEqual([]);
  });

  test("a new cloud project cannot edit the previous project while its document loads", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const auth = await registerUser(request, `editor-switch-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Editor switch");
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await newProject(page, "Previous project");
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await expect(page).toHaveURL(/\/video-editor$/u);
    await newProject(page, "Next project");
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await expect(page).toHaveURL(/\/video-editor$/u);
    await page.reload();
    await page
      .getByRole("article")
      .filter({ hasText: "Previous project" })
      .getByRole("button", { name: "Open" })
      .click();
    await page.locator("[data-project-details]").click();
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "Previous project",
    );
    await page.keyboard.press("Escape");
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await expect(page).toHaveURL(/\/video-editor$/u);

    let releaseLoad!: () => void;
    const heldLoad = new Promise<void>((resolve) => (releaseLoad = resolve));
    let loadStarted!: () => void;
    const started = new Promise<void>((resolve) => (loadStarted = resolve));
    await page.route(/\/api\/v1\/video-projects\/[^/?]+\?/, async (route) => {
      loadStarted();
      await heldLoad;
      await route.continue();
    });

    try {
      await page
        .getByRole("article")
        .filter({ hasText: "Next project" })
        .getByRole("button", { name: "Open" })
        .click();
      await started;
      await expect(page.locator("[data-project-details]")).toHaveCount(0);
      await expect(page.locator("header [role=status][data-state=saved]")).toHaveCount(0);
    } finally {
      releaseLoad();
    }
    await page.locator("[data-project-details]").click();
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Next project");
  });

  test("switching projects hides the old editor until its pending save finishes", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const auth = await registerUser(request, `editor-pending-save-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Editor pending save");
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await newProject(page, "Previous project");
    const previousURL = page.url();
    const previousID = new URL(previousURL).pathname.split("/").at(-1);
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await newProject(page, "Next project");
    const nextURL = page.url();
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await page
      .getByRole("article")
      .filter({ hasText: "Previous project" })
      .getByRole("button", { name: "Open" })
      .click();
    await page.locator("[data-project-details]").click();
    const title = page.getByRole("textbox", { name: "Project name" });
    await expect(title).toHaveValue("Previous project");
    await page.keyboard.press("Escape");

    let releaseSave!: () => void;
    const heldSave = new Promise<void>((resolve) => (releaseSave = resolve));
    let saveStarted!: () => void;
    const started = new Promise<void>((resolve) => (saveStarted = resolve));
    await page.route(
      new RegExp(`/api/v1/video-projects/${previousID}/mutations(?:\\?|$)`),
      async (route) => {
        saveStarted();
        await heldSave;
        await route.continue();
      },
    );

    await page.locator("[data-project-details]").click();
    await title.fill("Pending previous");
    await page.keyboard.press("Escape");
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await started;
    try {
      await page
        .getByRole("article")
        .filter({ hasText: "Next project" })
        .getByRole("button", { name: "Open" })
        .click();
      await expect(page).toHaveURL(nextURL);
      await expect(page.locator("[data-project-details]")).toHaveCount(0);
      await expect(page.getByRole("tabpanel", { name: "Editor workspaces" })).toHaveCount(0);
      await expect(page.locator("header [role=status][data-state=saved]")).toHaveCount(0);
    } finally {
      releaseSave();
    }
    await page.locator("[data-project-details]").click();
    await expect(title).toHaveValue("Next project");
    await page.goto(previousURL);
    await page.locator("[data-project-details]").click();
    await expect(title).toHaveValue("Pending previous");
  });

  test("a failed save blocks the project switch until retry succeeds", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const auth = await registerUser(request, `editor-save-retry-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Editor save retry");
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await newProject(page, "Previous project");
    const previousURL = page.url();
    const previousID = new URL(previousURL).pathname.split("/").at(-1);
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await newProject(page, "Next project");
    const nextURL = page.url();
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await page
      .getByRole("article")
      .filter({ hasText: "Previous project" })
      .getByRole("button", { name: "Open" })
      .click();
    await page.locator("[data-project-details]").click();
    const title = page.getByRole("textbox", { name: "Project name" });
    await expect(title).toHaveValue("Previous project");
    await page.keyboard.press("Escape");

    let releaseFailure!: () => void;
    const heldFailure = new Promise<void>((resolve) => (releaseFailure = resolve));
    let saveStarted!: () => void;
    const started = new Promise<void>((resolve) => (saveStarted = resolve));
    let failOnce = true;
    await page.route(
      new RegExp(`/api/v1/video-projects/${previousID}/mutations(?:\\?|$)`),
      async (route) => {
        if (!failOnce) return route.continue();
        failOnce = false;
        saveStarted();
        await heldFailure;
        await route.fulfill({ status: 503, json: { error: "Temporary save failure" } });
      },
    );

    await page.locator("[data-project-details]").click();
    await title.fill("Recovered previous");
    await page.keyboard.press("Escape");
    await page
      .locator("header")
      .getByRole("link", { name: /Video Editor/u })
      .click();
    await started;
    try {
      await page
        .getByRole("article")
        .filter({ hasText: "Next project" })
        .getByRole("button", { name: "Open" })
        .click();
      await expect(page).toHaveURL(nextURL);
    } finally {
      releaseFailure();
    }
    await expect(
      page.getByText("Cloud Video Project save is waiting for a connection"),
    ).toBeVisible();
    await expect(page.locator("[data-project-details]")).toHaveCount(0);
    await page
      .locator("header")
      .getByRole("button", { name: /save failed.*try again/i })
      .click();
    await page.locator("[data-project-details]").click();
    await expect(title).toHaveValue("Next project", { timeout: CLOUD_SAVE_TIMEOUT_MS });
    await page.goto(previousURL);
    await page.locator("[data-project-details]").click();
    await expect(title).toHaveValue("Recovered previous");
  });

  async function waitForRecording(dialog: Locator): Promise<void> {
    await expect(dialog.getByRole("button", { name: "Stop recording" })).toBeEnabled({
      timeout: 15000,
    });
    await expect
      .poll(
        async () => {
          const elapsed = await dialog.getByText(/\d+:\d{2}/).innerText();
          const time = elapsed.match(/(\d+):(\d{2})/)!;
          return Number(time[1]) * 60 + Number(time[2]);
        },
        { timeout: 15000 },
      )
      .toBeGreaterThanOrEqual(2);
  }

  test("recording setup fits both themes and imports a real streaming WebM", async ({
    page,
    request,
  }) => {
    test.setTimeout(150000);
    const auth = await registerUser(request, `recorder-repair-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Recording repair");
    await authenticatePage(page, auth.token);
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          const context = canvas.getContext("2d")!;
          let frame = 0;
          const draw = () => {
            context.fillStyle = frame++ % 2 ? "#345abc" : "#123456";
            context.fillRect(0, 0, 320, 180);
          };
          draw();
          const interval = setInterval(draw, 40);
          const stream = canvas.captureStream(25);
          const track = stream.getVideoTracks()[0];
          track.addEventListener("ended", () => clearInterval(interval));
          window.addEventListener(
            "test-stop-sharing",
            () => {
              track.stop();
              track.dispatchEvent(new Event("ended"));
            },
            { once: true },
          );
          return stream;
        },
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await newProject(page, "Recording proof");
    await expect(page.getByText(/Workspace root is not set/)).toHaveCount(0);
    {
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openRecorder(page);
      const dialog = page.getByRole("dialog", { name: "Recorder", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Microphone", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Microphone", exact: true }).click();
      await expect(page.getByRole("option", { name: "Device default", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRecorder(page);
    const dialog = page.getByRole("dialog", { name: "Recorder", exact: true });
    await dialog.getByRole("checkbox", { name: "Microphone", exact: true }).uncheck();
    await dialog.getByText("Advanced", { exact: true }).click();
    await dialog.getByRole("button", { name: "Countdown" }).click();
    await page.getByRole("option", { name: "Off", exact: true }).click();
    await dialog.getByRole("button", { name: "Start recording" }).click();
    await waitForRecording(dialog);
    await dialog.getByRole("button", { name: "Stop recording" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30000 });
    await expectProjectSummary(page, "Clips: 1");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.locator('header [role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
      {
        timeout: 15000,
      },
    );
    await openRecorder(page);
    await dialog.getByRole("button", { name: "Start recording" }).click();
    await waitForRecording(dialog);
    await page.evaluate(() => window.dispatchEvent(new Event("test-stop-sharing")));
    await expect(dialog).not.toBeVisible({ timeout: 30000 });
    await expectProjectSummary(page, "Clips: 2");
    const uploadRoute = /\/api\/v1\/media\/upload(?:-session)?(?:\?|$)/;
    await page.route(uploadRoute, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Deliberate upload failure" }),
      }),
    );
    await openRecorder(page);
    await dialog.getByRole("button", { name: "Start recording" }).click();
    await waitForRecording(dialog);
    await dialog.getByRole("button", { name: "Stop recording" }).click();
    await expect(
      page.getByText("The recording could not be added to this project.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Download Screen", exact: true })).toHaveCount(1);
    await page.unroute(uploadRoute);
    let releaseRecoveryUpload!: () => void;
    const heldRecoveryUpload = new Promise<void>((resolve) => (releaseRecoveryUpload = resolve));
    await page.route(uploadRoute, async (route) => {
      await heldRecoveryUpload;
      await route.continue();
    });
    let uploadResponse!: ReturnType<Page["waitForResponse"]>;
    try {
      const pendingUpload = page.waitForRequest(uploadRoute, { timeout: 30_000 });
      await dialog.getByRole("button", { name: "Recover recording", exact: true }).click();
      const uploadRequest = await pendingUpload;
      uploadResponse = page.waitForResponse((response) => response.url() === uploadRequest.url(), {
        timeout: 30_000,
      });
      await expect(
        dialog.getByRole("button", { name: "Recover recording", exact: true }),
      ).toBeHidden();
      await expect(dialog.getByRole("status")).toHaveAttribute("aria-busy", "true");
      await expect(dialog.getByRole("status")).toContainText("Saving");
      await expect(dialog.getByRole("link", { name: "Download Screen", exact: true })).toHaveCount(
        0,
      );
      // The recovery dialog owns the page while the upload is held, so the clip
      // count comes from the timeline rather than the project details popover.
      await expect(page.locator("[data-timeline-item-id]")).toHaveCount(2);
    } finally {
      releaseRecoveryUpload();
    }
    expect((await uploadResponse).ok()).toBe(true);
    await expect(dialog.getByRole("link", { name: "Download Screen", exact: true })).toHaveCount(
      0,
      {
        timeout: 30_000,
      },
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(dialog).toHaveCount(0);
    await expectProjectSummary(page, "Clips: 3");
  });

  test("editing text over a background does not leave the old lettering underneath", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `composited-text-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Composited text");
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await newProject(page, "Background text");
    await page.locator("header").getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Elements", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Elements", exact: true })
      .getByRole("tab", { name: "Backgrounds", exact: true })
      .click();
    await page.getByRole("button", { name: "Ocean mesh", exact: true }).click();
    const canvas = page.locator<HTMLCanvasElement>("[data-stacked-preview]");
    const overlay = page.getByRole("group", { name: "Visual 2", exact: true });
    await overlay.getByRole("button", { name: "Hide track", exact: true }).click();
    await expect
      .poll(() =>
        canvas.evaluate(
          (el) => el.getContext("2d")!.getImageData(el.width / 2, el.height / 2, 1, 1).data[2],
        ),
      )
      .toBeGreaterThan(0);
    const background = await canvas.evaluate((el) => el.toDataURL());
    await overlay.getByRole("button", { name: "Show track", exact: true }).click();
    await page.getByRole("button", { name: /^Your text\. Drag to move/ }).click();
    await expect
      .poll(() => canvas.evaluate((el, baseline) => el.toDataURL() !== baseline, background))
      .toBe(true);
    await page
      .getByRole("toolbar", { name: "On-canvas editing tools" })
      .getByRole("button", { name: "Text", exact: true })
      .click();
    const editor = page.getByRole("textbox", { name: /Edit text on canvas/ });
    await editor.fill("");
    await expect
      .poll(() => canvas.evaluate((el, baseline) => el.toDataURL() === baseline, background))
      .toBe(true);
    await editor.pressSequentially("Clear new text");
    await expect(editor).toHaveText("Clear new text");
    await expect
      .poll(() => canvas.evaluate((el, baseline) => el.toDataURL() === baseline, background))
      .toBe(true);
    await editor.press("ControlOrMeta+Enter");
    await expect
      .poll(() => canvas.evaluate((el, baseline) => el.toDataURL() !== baseline, background))
      .toBe(true);
  });
});

test.describe("video editor shaders", () => {
  // IntersectionObserver rounds fractional CSS pixels at phone widths.
  const FULLY_VISIBLE_RATIO = 0.999;
  // Gallery tiles are edge-aligned by scrollIntoViewIfNeeded, so headless
  // sub-pixel rounding can clip a fraction of a pixel. 0.99 still fails on any
  // real (whole-pixel) clipping of the 56px tiles.
  const GALLERY_VISIBLE_RATIO = 0.99;

  async function expectRenderedShader(page: Page) {
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      );
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect
      .poll(() =>
        page.locator("canvas[data-stacked-preview]").evaluate((canvas: HTMLCanvasElement) => {
          const pixels = canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 100) return true;
          }
          return false;
        }),
      )
      .toBe(true);
  }

  async function createShaderProject(
    page: Page,
    preset = "Aurora",
    resolution?: { width: number; height: number },
  ) {
    await page.addInitScript(() => {
      if (!("showOpenFilePicker" in window)) {
        Object.defineProperty(window, "showOpenFilePicker", {
          configurable: true,
          value: async () => [],
        });
      }
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          const handle = await navigator.storage.getDirectory();
          const prototype = Object.getPrototypeOf(handle);
          prototype.queryPermission = async () => "granted";
          prototype.requestPermission = async () => "granted";
          return handle;
        },
      });
    });
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Choose folder", exact: true }).click();
    if (resolution) {
      await page.getByRole("button", { name: "Custom project", exact: true }).click();
      await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Shader proof");
      await page
        .getByRole("button", {
          name: "Custom Custom size Enter width, height and frame rate",
          exact: true,
        })
        .click();
      await page
        .getByRole("spinbutton", { name: "Width", exact: true })
        .fill(String(resolution.width));
      await page
        .getByRole("spinbutton", { name: "Height", exact: true })
        .fill(String(resolution.height));
      await page.getByRole("button", { name: "Create", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    }
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator("[data-project-details]").click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Shader proof");
    await page.keyboard.press("Escape");
    const backgroundsSearch = page.getByRole("searchbox", {
      name: "Search backgrounds",
      exact: true,
    });
    if (!(await backgroundsSearch.isVisible())) {
      const elementsGroup = page.getByRole("tablist", { name: "Elements", exact: true });
      if (
        !(await elementsGroup.getByRole("tab", { name: "Backgrounds", exact: true }).isVisible())
      ) {
        await page
          .getByRole("navigation", { name: "Assets", exact: true })
          .getByRole("tab", { name: "Elements", exact: true })
          .click();
      }
      await elementsGroup.getByRole("tab", { name: "Backgrounds", exact: true }).click();
    }
    await page.getByRole("searchbox", { name: "Search backgrounds" }).fill(preset);
    await page.getByRole("button", { name: preset, exact: true }).click();
    await page.getByRole("searchbox", { name: "Search backgrounds" }).fill("");
    await expect(page.getByRole("button", { name: "Preset", exact: true })).toHaveText(preset);
  }

  test("shader clips preserve edits, seek and export an MP4", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await createShaderProject(page);
    const canvas = page.locator("canvas[data-stacked-preview]");
    const transport = page.locator("[data-video-transport]");
    const initial = await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await transport.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Step one frame forward", exact: true }).click();
    await expect
      .poll(() => canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
      .not.toBe(initial);
    await transport.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Go to start", exact: true }).click();
    await expect
      .poll(() => canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
      .toBe(initial);
    const speed = page.getByRole("slider", { name: "Speed", exact: true });
    await speed.press("Home");
    await expect(speed).toHaveAttribute("aria-valuenow", "0");
    await page.getByRole("slider", { name: "Starting phase" }).press("ArrowRight");
    await expect(page.getByRole("slider", { name: "Starting phase" })).toHaveAttribute(
      "aria-valuenow",
      "0.1",
    );
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByRole("slider", { name: "Starting phase" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByRole("slider", { name: "Starting phase" })).toHaveAttribute(
      "aria-valuenow",
      "0.1",
    );
    await speed.press("ArrowRight");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    const projectURL = page.url();
    await page.goto("/video-editor");
    await page.goto(projectURL);
    const restoredSearch = page.getByRole("searchbox", { name: "Search backgrounds", exact: true });
    await expect(restoredSearch).toBeVisible({ timeout: 15_000 });
    await expect(canvas).toBeVisible();
    await page.locator("header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    await page.getByRole("dialog").getByText("WebM", { exact: true }).click();
    await page.getByRole("option", { name: "MP4", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Render now", exact: true }).click();
    await expect(page.getByText("Saved Shader proof.mp4.", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Exports", exact: true }).click();
    const download = page.getByRole("button", { name: "Download Shader proof.mp4", exact: true });
    await expect(download).toBeEnabled();
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    await file.saveAs(test.info().outputPath("shader-proof.mp4"));
    expect(errors).toEqual([]);
  });

  test(`shader gallery and controls fit desktop and phones in light`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await createShaderProject(page, "Warp");
    await page.getByRole("slider", { name: "Warp: Speed", exact: true }).press("Home");
    await expect(page.getByRole("button", { name: "Neural", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Aurora", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Aurora", exact: true })).toBeFocused();
    await expectRenderedShader(page);
    await page.setViewportSize({ width: 320, height: 900 });
    const panels = page.getByRole("navigation", { name: "Editor panels" });
    for (const name of ["Media", "Properties", "Timeline"]) {
      await panels.getByRole("button", { name, exact: true }).click();
      await expect(panels.getByRole("button", { name, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      if (name === "Media") {
        await page
          .getByRole("tablist", { name: "Assets", exact: true })
          .getByRole("tab", { name: "Elements", exact: true })
          .click();
        await page
          .getByRole("tablist", { name: "Elements", exact: true })
          .getByRole("tab", { name: "Backgrounds", exact: true })
          .click();
        for (const preset of ["Aurora", "Warp", "God rays", "Static radial gradient"]) {
          await page.getByRole("searchbox", { name: "Search backgrounds" }).fill(preset);
          const tile = page.getByRole("button", { name: preset, exact: true });
          await tile.scrollIntoViewIfNeeded();
          await expect(tile).toBeInViewport({ ratio: GALLERY_VISIBLE_RATIO });
          await expect(tile.getByText(preset, { exact: true })).toBeInViewport({
            ratio: GALLERY_VISIBLE_RATIO,
          });
        }
      }
      if (name === "Properties") {
        await page
          .getByRole("button", { name: "Warp: Shape", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByRole("button", { name: "Warp: Shape", exact: true }),
        ).toBeInViewport();
      }
      await expectRenderedShader(page);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    await page
      .getByRole("tablist", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Effects", exact: true })
      .click();
    await page.getByRole("searchbox", { name: "Search effects", exact: true }).fill("Shaders");
    await expect(page.locator('[data-effect-catalog-id^="gpu-paper-"]')).toHaveCount(10);
    const heatmap = page.locator('[data-effect-catalog-id="gpu-paper-heatmap"]');
    await heatmap.scrollIntoViewIfNeeded();
    await expect(heatmap.locator("canvas")).toHaveAttribute("data-rendered", "true");
    const tile = page.locator('[data-effect-catalog-id="gpu-paper-gem-smoke"]');
    await tile.evaluate((element) =>
      element.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    await expect(tile).toBeInViewport({ ratio: FULLY_VISIBLE_RATIO });
    await expectRenderedShader(page);
    expect(errors).toEqual([]);
  });

  test("Paper backgrounds and chained shader effects survive reopening and export", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Keep the real 90-frame shader-chain export affordable on CI's software renderer.
    await createShaderProject(page, "Warp", { width: 640, height: 360 });
    const colors = page.getByRole("slider", { name: "Warp: Colors", exact: true });
    await colors.press("ArrowLeft");
    await expect(colors).toHaveAttribute("aria-valuenow", "3");
    await page.getByRole("button", { name: "Warp: Shape", exact: true }).click();
    await page.getByRole("option", { name: "Stripes", exact: true }).click();
    await page.locator("[data-timeline-item-id]").first().click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByRole("button", { name: "Warp: Shape", exact: true })).toHaveText(
      "Checks",
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByRole("button", { name: "Warp: Shape", exact: true })).toHaveText(
      "Stripes",
    );
    await page
      .getByRole("tablist", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Effects", exact: true })
      .click();
    const search = page.getByRole("searchbox", { name: "Search effects", exact: true });
    await search.fill("Shaders");
    await expect(page.locator('[data-effect-catalog-id^="gpu-paper-"]')).toHaveCount(10);
    await page.locator('[data-effect-catalog-id="gpu-paper-water"]').click();
    await page.locator('[data-effect-catalog-id="gpu-paper-heatmap"]').click();
    await page.locator('[data-edit-inspector-tab="effects"]').click();
    await page.getByRole("button", { name: "Heatmap: Logo source", exact: true }).click();
    await page.getByRole("option", { name: "Dark areas", exact: true }).click();
    // Heatmap's warm contours must replace the purple source in the settled preview.
    await expect
      .poll(() =>
        page.locator("canvas[data-stacked-preview]").evaluate((canvas: HTMLCanvasElement) => {
          const context = canvas.getContext("2d")!;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let warmPixels = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i]! > 180 && pixels[i + 1]! > 120 && pixels[i + 2]! < 90) warmPixels++;
          }
          return warmPixels;
        }),
      )
      .toBeGreaterThan(100);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    const projectURL = page.url();
    await page.goto("/video-editor");
    await page.goto(projectURL);
    await page.locator("[data-timeline-item-id]").first().click();
    await expect(page.getByRole("slider", { name: "Warp: Colors", exact: true })).toHaveAttribute(
      "aria-valuenow",
      "3",
    );
    await expect(page.getByRole("button", { name: "Warp: Shape", exact: true })).toHaveText(
      "Stripes",
    );
    await page.locator('[data-edit-inspector-tab="effects"]').click();
    await expect(
      page.getByRole("button", { name: "Heatmap: Logo source", exact: true }),
    ).toHaveText("Dark areas");
    await page.locator("header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    await page.getByRole("dialog").getByText("WebM", { exact: true }).click();
    await page.getByRole("option", { name: "MP4", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Render now", exact: true }).click();
    await expect(page.getByText("Saved Shader proof.mp4.", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Exports", exact: true }).click();
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Shader proof.mp4", exact: true }).click(),
    ]);
    await file.saveAs(test.info().outputPath("paper-shader-chain.mp4"));
    expect(errors).toEqual([]);
  });

  test("unavailable graphics prevents shader insertion from the gallery and inspector", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const getContext = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function (kind, ...args) {
        if (kind === "webgl2") return null;
        return getContext.call(this, kind, ...args);
      } as typeof getContext;
    });
    await createShaderProject(page, "Sunset mesh");
    await expect(page.getByRole("button", { name: "Aurora", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Preset", exact: true }).click();
    await expect(page.getByRole("option", { name: "Aurora", exact: true })).toBeDisabled();
    await expect(page.getByRole("option", { name: "Ocean mesh", exact: true })).toBeEnabled();
  });
});

test.describe("video editor trim", () => {
  test.use({ actionTimeout: 15_000 });

  test.describe("light", () => {
    test(`precise trimming and explicit media placement in light`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), "light");
      await page.setViewportSize({ width: 1280, height: 800 });
      await createProject(page, "Precise editing");
      const bytes = (
        await readFile(
          fileURLToPath(new URL("./fixtures/product-screenshots/lisbon-tram.png", import.meta.url)),
        )
      ).toString("base64");
      await page.evaluate(async (bytes) => {
        const root = await navigator.storage.getDirectory();
        const imports = await root.getDirectoryHandle("test-imports", { create: true });
        const handle = await imports.getFileHandle("lisbon-tram.png", { create: true });
        const writable = await handle.createWritable();
        await writable.write(Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0)));
        await writable.close();
        Object.defineProperty(window, "showOpenFilePicker", {
          configurable: true,
          value: async () => [handle],
        });
      }, bytes);
      await page.getByRole("button", { name: "Import media", exact: true }).click();
      await page
        .getByRole("button", { name: "More actions for lisbon-tram.png", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Add at playhead", exact: true }).click();
      const clips = page.locator("[data-timeline-item-id]");
      await expect(clips).toHaveCount(1);
      await clips
        .first()
        .getByRole("button", { name: /^lisbon-tram.png\. Drag/ })
        .click();
      await page.getByRole("slider", { name: "Timeline playhead", exact: true }).focus();
      await page.keyboard.press("Home");
      for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
      const clipOverflow = page.getByRole("button", {
        name: "lisbon-tram.png: More actions",
        exact: true,
      });
      await clipOverflow.click();
      const trimStart = page.getByRole("menuitem", {
        name: "Trim start to playhead",
        exact: true,
      });
      await expect(trimStart).toBeEnabled();
      const original = (await clips.first().boundingBox())!;
      await trimStart.click();
      await expect
        .poll(async () => (await clips.first().boundingBox())!.width)
        .toBeLessThan(original.width);
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(async () => (await clips.first().boundingBox())!.width)
        .toBeCloseTo(original.width, 0);
      await page.setViewportSize({ width: 1280, height: 844 });
      await clipOverflow.scrollIntoViewIfNeeded();
      await expect(clipOverflow).toBeInViewport();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page
        .getByRole("button", { name: "More actions for lisbon-tram.png", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Add at end of sequence", exact: true }).click();
      await expect(clips).toHaveCount(2);
      await page.setViewportSize({ width: 320, height: 844 });
      const panels = page.getByRole("navigation", { name: "Editor panels" });
      await panels.getByRole("button", { name: "Media", exact: true }).click();
      const sourceCard = page.getByRole("button", {
        name: "Source: lisbon-tram.png",
        exact: true,
      });
      await sourceCard.focus();
      await sourceCard.press("Enter");
      await expect(panels.getByRole("button", { name: "Timeline", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("region", { name: "Source", exact: true })).toBeVisible();
      const close = page.getByRole("button", { name: "Close source monitor", exact: true });
      await expect(close).toBeFocused();
      await close.click();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole("button", { name: "Source: lisbon-tram.png", exact: true }).click();
      const source = page.getByRole("region", { name: "Source", exact: true });
      const position = source.getByRole("slider", { name: "Source position", exact: true });
      const inPoint = source.getByRole("slider", { name: "Source in point", exact: true });
      const outPoint = source.getByRole("slider", { name: "Source out point", exact: true });
      await source.getByRole("button", { name: "Go to end", exact: true }).click();
      await expect(position).toHaveAttribute("aria-valuenow", "89");
      await position.focus();
      await page.keyboard.press("Home");
      await expect(position).toHaveAttribute("aria-valuenow", "0");
      await inPoint.focus();
      await page.keyboard.press("ArrowRight");
      await expect(inPoint).toHaveAttribute("aria-valuenow", "1");
      await page.keyboard.press("Home");
      await expect(inPoint).toHaveAttribute("aria-valuenow", "0");
      await outPoint.focus();
      await page.keyboard.press("Home");
      await expect(outPoint).toHaveAttribute("aria-valuenow", "1");
      await page.keyboard.press("End");
      await expect(outPoint).toHaveAttribute("aria-valuenow", "90");
      const append = page.getByRole("button", { name: "Add at end of sequence", exact: true });
      await expect(append).toHaveCount(1);
      await append.scrollIntoViewIfNeeded();
      await append.click();
      await expect(clips).toHaveCount(3);
      await page.keyboard.press("ControlOrMeta+s");
      await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
        "data-state",
        "saved",
      );
      await page.reload();
      await expect(clips).toHaveCount(3);
      expect(errors).toEqual([]);
    });
  });

  test("clip overflow trims the second half after splitting and trimming the first", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await createProject(page, "Split overflow");
    const bytes = (
      await readFile(
        fileURLToPath(
          new URL("./fixtures/product-screenshots/study-sos-demo.mp4", import.meta.url),
        ),
      )
    ).toString("base64");
    await page.evaluate(async (bytes) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle("study-sos-demo.mp4", { create: true });
      const writable = await handle.createWritable();
      await writable.write(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)));
      await writable.close();
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => [handle],
      });
    }, bytes);
    await page.getByRole("button", { name: "Import media", exact: true }).click();
    await page
      .getByRole("button", { name: "More actions for study-sos-demo.mp4", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add at playhead", exact: true }).click();
    const clips = page.locator("[data-timeline-item-id]");
    await expect(clips).toHaveCount(1);
    const firstID = await clips.first().getAttribute("data-timeline-item-id");
    const first = page.locator(`[data-timeline-item-id="${firstID}"]`);
    const seek = async (frame: number) => {
      const ruler = page.getByRole("slider", { name: "Timeline playhead", exact: true });
      await ruler.focus();
      await ruler.press("Home");
      for (let n = 0; n < Math.floor(frame / 10); n++) await ruler.press("Shift+ArrowRight");
      for (let n = 0; n < frame % 10; n++) await ruler.press("ArrowRight");
    };
    await seek(180);
    await first.getByRole("button", { name: /Drag to move/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Split at playhead/ }).click();
    await expect(clips).toHaveCount(2);
    const second = clips.last();
    await first.getByRole("button", { name: /Drag to move/ }).click();
    await seek(165);
    const more = page.getByRole("button", {
      name: "study-sos-demo.mp4: More actions",
      exact: true,
    });
    await more.click();
    await page.getByRole("menuitem", { name: "Trim end to playhead", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await second.getByRole("button", { name: /Drag to move/ }).click();
    await seek(195);
    const before = (await second.boundingBox())!;
    await more.click();
    await page.getByRole("menuitem", { name: "Trim start to playhead", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(async () => (await second.boundingBox())!.width).toBeLessThan(before.width);
  });
});

test.describe("video editor visual tracks", () => {
  test("a background moves between visual tracks with undo, cancel and persistence", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mode-watcher-mode", "light"));
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          const handle = await navigator.storage.getDirectory();
          const prototype = Object.getPrototypeOf(handle);
          prototype.queryPermission = async () => "granted";
          prototype.requestPermission = async () => "granted";
          return handle;
        },
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Choose folder", exact: true }).click();
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Assets", exact: true })
      .getByRole("tab", { name: "Elements", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Elements", exact: true })
      .getByRole("tab", { name: "Backgrounds", exact: true })
      .click();
    await page.getByRole("searchbox", { name: "Search backgrounds" }).fill("Sunset mesh");
    await page.getByRole("button", { name: "Sunset mesh", exact: true }).click();
    const source = page.locator('[data-track="track-video-main"]');
    const destination = page.locator('[data-track="track-video-overlay"]');
    const clip = page.locator("[data-timeline-item-id]");
    await expect(source.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page
      .getByRole("tablist", { name: "Elements", exact: true })
      .getByRole("tab", { name: "Backgrounds", exact: true })
      .focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(clip).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(clip).toHaveCount(1);

    const start = await clip.boundingBox();
    const target = await destination.boundingBox();
    expect(start).not.toBeNull();
    expect(target).not.toBeNull();
    await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
    await page.mouse.down();
    await page.mouse.move(start!.x + start!.width / 2, target!.y + target!.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(source.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
    const moved = await clip.boundingBox();
    const original = await source.boundingBox();
    await page.mouse.move(moved!.x + moved!.width / 2, moved!.y + moved!.height / 2);
    await page.mouse.down();
    await page.mouse.move(moved!.x + moved!.width / 2, original!.y + original!.height / 2, {
      steps: 8,
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
    const backgroundsSearch = page.getByRole("searchbox", { name: "Search backgrounds" });
    if (!(await backgroundsSearch.isVisible())) {
      await page
        .getByRole("navigation", { name: "Assets", exact: true })
        .getByRole("tab", { name: "Backgrounds", exact: true })
        .click();
    }
    await expect(backgroundsSearch).toBeVisible();
    await backgroundsSearch.fill("Ocean mesh");
    await page.getByRole("button", { name: "Ocean mesh", exact: true }).click();
    const sunset = page.getByRole("button", { name: /^Sunset mesh\. Drag/ });
    const ocean = page.getByRole("button", { name: /^Ocean mesh\. Drag/ });
    await sunset.click();
    await ocean.click({ modifiers: ["Shift"] });
    await expect(page.getByRole("heading", { name: "2 clips selected" })).toBeVisible();
    await ocean.click();
    await expect(page.getByRole("heading", { name: "Ocean mesh", exact: true })).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(ocean).toHaveCount(0);
    await expect(sunset).toHaveCount(1);
    await sunset.click();
    await page.getByRole("textbox", { name: "Width", exact: true }).scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(
      page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Properties", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "Width", exact: true }).scrollIntoViewIfNeeded();
  });
});

test.describe("cloud video conflict origin", () => {
  test("Cloud conflicts identify this browser and another device without presenting opaque names", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `video-conflict-origin-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Video conflict origins");
    await authenticatePage(page, auth.token);
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await page.locator("[data-project-details]").click();
    await page
      .getByRole("textbox", { name: "Project name", exact: true })
      .fill("Cloud origin fixture");
    await page.getByRole("textbox", { name: "Project name", exact: true }).press("Tab");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.keyboard.press("Escape");
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const headers = { Authorization: `Bearer ${auth.token}` };
    const get = await request.get(`/api/v1/video-projects/${id}?workspace_id=${workspace.id}`, {
      headers,
    });
    expect(get.ok()).toBe(true);
    const project = await get.json();
    const revisions = await request.get(
      `/api/v1/video-projects/${id}/revisions?workspace_id=${workspace.id}`,
      { headers },
    );
    expect(revisions.ok()).toBe(true);
    const thisDevice = (await revisions.json())[0].device_id;
    expect(thisDevice).toBeTruthy();
    const otherDevice = randomUUID();
    const change = async (device: string | undefined, description: string) => {
      const data: components["schemas"]["ApplyVideoProjectMutationInputBody"] = {
        workspace_id: workspace.id,
        mutation_id: randomUUID(),
        base_revision: project.head_revision,

        operations: [
          { kind: "set", target: "project:description", path: "/description", value: description },
        ],
      };
      if (device) data.device_id = device;
      const response = await request.post(`/api/v1/video-projects/${id}/mutations`, {
        headers,
        data,
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    expect((await change(thisDevice, "Current saved edit")).outcome).toBe("applied");
    expect((await change(otherDevice, "Other device edit")).outcome).toBe("conflict");
    expect((await change(thisDevice, "This browser edit")).outcome).toBe("conflict");
    expect((await change(undefined, "Unknown origin edit")).outcome).toBe("conflict");
    const snapshotResponse = await request.get(
      `/api/v1/video-projects/${id}/conflicts?workspace_id=${workspace.id}`,
      { headers },
    );
    const snapshot = await snapshotResponse.json();
    await page.locator("header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
    const history = page.getByRole("dialog", { name: "Version history", exact: true });
    await expect(history.getByText("Loading…", { exact: true })).toHaveCount(0);
    await expect(history.getByText(/^From another browser or device\s*·/)).toBeVisible();
    await expect(history.getByText(/^From this browser\s*·/)).toBeVisible();
    await expect(history.getByText(otherDevice, { exact: true })).toHaveCount(1);
    await expect(
      history.getByText(`Conflicting edit at saved revision ${project.head_revision + 1}`, {
        exact: true,
      }),
    ).toHaveCount(3);
    await page.setViewportSize({ width: 1280, height: 850 });
    await history.getByText(/^From another browser or device\s*·/).scrollIntoViewIfNeeded();
    const otherRow = history.getByText(/^From another browser or device\s*·/).locator("..");
    await expect(otherRow.getByText(otherDevice, { exact: true })).not.toBeVisible();
    await otherRow.getByText("Details", { exact: true }).first().focus();
    await otherRow.getByText("Details", { exact: true }).first().press("Enter");
    await expect(otherRow.getByText(otherDevice, { exact: true })).toBeVisible();
    await expect(otherRow.getByText("Other device edit", { exact: true })).toBeVisible();
    const after = await request.get(
      `/api/v1/video-projects/${id}/conflicts?workspace_id=${workspace.id}`,
      { headers },
    );
    expect(await after.json()).toEqual(snapshot);
    await page.reload();
    await page.locator("header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
    await expect(page.getByText(/^From another browser or device\s*·/)).toBeVisible();
    await expect(page.getByText(/^From this browser\s*·/)).toBeVisible();
  });
});

test.describe("cloud video history inspection", () => {
  test("Cloud history can inspect a saved version without restoring or changing the open project", async ({
    browser,
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `video-inspect-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Video history inspection");
    await authenticatePage(page, auth.token);
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Project name", exact: true });
    await page.locator("[data-project-details]").click();
    await title.fill("Earlier launch cut");
    await title.press("Tab");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.keyboard.press("Escape");
    const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
    const openHistory = async () => {
      await page.locator("header").getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
      const history = page.getByRole("dialog", { name: "Version history", exact: true });
      await expect(history.getByText("Loading…", { exact: true })).toHaveCount(0);
      return history;
    };
    let history = await openHistory();
    await history.getByRole("textbox", { name: "Checkpoint name" }).fill("Before rename");
    await history.getByRole("button", { name: "Create checkpoint", exact: true }).click();
    await expect(history.getByText("Before rename", { exact: true })).toBeVisible();
    await history
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.locator("[data-project-details]").click();
    await title.fill("Current launch cut");
    await title.press("Tab");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.keyboard.press("Escape");
    const read = async () => {
      const response = await request.get(
        `/api/v1/video-projects/${projectId}?workspace_id=${workspace.id}`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      );
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const saved = await read();
    const trackIndex = saved.document.timeline.tracks.findIndex(
      (track: { id: string }) => track.id === "track-video-main",
    );
    expect(trackIndex).toBeGreaterThanOrEqual(0);
    const rename = await request.post(`/api/v1/video-projects/${projectId}/mutations`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        workspace_id: workspace.id,
        mutation_id: randomUUID(),
        base_revision: saved.head_revision,
        device_id: "inspection-fixture",
        operations: [
          {
            kind: "set",
            target: "track:track-video-main.name",
            path: `/timeline/tracks/${trackIndex}/name`,
            value: "Current release track",
          },
        ],
      },
    });
    expect(rename.ok()).toBe(true);
    expect((await rename.json()).outcome).toBe("applied");
    await page.reload();
    await expect(page.locator("[data-project-details]")).toContainText("Current launch cut");
    const before = await read();
    history = await openHistory();
    const row = history
      .getByRole("listitem")
      .filter({ has: page.getByText("Before rename", { exact: true }) });
    await row.getByRole("button", { name: "Inspect version", exact: true }).click();
    await expect(row.getByText("Earlier launch cut", { exact: true })).toBeVisible();
    await expect(row.getByText("Title changed", { exact: true })).toBeVisible();
    await expect(
      row.getByText("Tracks: 0 added, 0 removed, 1 changed", { exact: true }),
    ).toBeVisible();
    await row.getByText("Details", { exact: true }).focus();
    await row.getByText("Details", { exact: true }).press("Enter");
    await expect(row.getByText("Visual 1", { exact: true })).toBeVisible();
    await expect(
      row.getByText("Compared with the latest saved version.", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 850 });
    await row.getByRole("button", { name: "Inspect version", exact: true }).focus();
    await expect(row.getByRole("button", { name: "Inspect version", exact: true })).toBeFocused();
    await row.scrollIntoViewIfNeeded();
    await row.getByRole("button", { name: "Inspect version", exact: true }).press("Enter");
    await expect(row.getByText("Earlier launch cut", { exact: true })).toHaveCount(0);
    await expect(await read()).toEqual(before);
    await history
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.setViewportSize({ width: 1280, height: 850 });
    await expect(page.locator("[data-project-details]")).toContainText("Current launch cut");
    await page.reload();
    history = await openHistory();
    await history
      .getByRole("listitem")
      .filter({ has: page.getByText("Before rename", { exact: true }) })
      .getByRole("button", { name: "Inspect version", exact: true })
      .click();
    await expect(history.getByText("Earlier launch cut", { exact: true })).toBeVisible();
    await expect(await read()).toEqual(before);
    const touchContext = await browser.newContext({
      viewport: { width: 320, height: 740 },
      hasTouch: true,
      isMobile: true,
    });
    const touchPage = await touchContext.newPage();
    await authenticatePage(touchPage, auth.token);
    await touchPage.goto(`/video-editor/${projectId}?storage=cloud`);
    await touchPage.locator("header").getByRole("button", { name: "More actions" }).tap();
    await touchPage.getByRole("menuitem", { name: "Version history", exact: true }).tap();
    const touchRow = touchPage
      .getByRole("dialog", { name: "Version history", exact: true })
      .getByRole("listitem")
      .filter({ has: touchPage.getByText("Before rename", { exact: true }) });
    const inspect = touchRow.getByRole("button", { name: "Inspect version", exact: true });
    await expect
      .poll(async () => (await inspect.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await inspect.tap();
    await expect(touchRow.getByText("Earlier launch cut", { exact: true })).toBeVisible();
    await touchContext.close();
  });
});

test.describe("cloud video projects", () => {
  test("Cloud Video Projects are the signed-in default with recovery on desktop and phone", async ({
    browser,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `cloud-video-projects-${unique}@example.com`);
    const workspace = (await createWorkspace(request, auth.token, "Cloud Video Projects E2E")) as {
      id: string;
    };
    await authenticatePage(page, auth.token);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/video-editor");
    await expect(page.getByRole("heading", { name: "Saved to OpenPost" })).toBeVisible();
    await expect(page.getByRole("button", { name: "OpenPost cloud" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Both libraries remain visible; the storage choice applies to new projects.
    await expect(
      page.getByRole("heading", { name: "Choose your editing workspace" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await page.locator("[data-project-details]").click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Cross-device launch");
    await page.getByRole("textbox", { name: "Project name" }).press("Tab");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?storage=cloud$/u);
    const projectId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await authenticatePage(secondPage, auth.token);
    await secondPage.goto(`/video-editor/${projectId}?storage=cloud`);
    await expect(secondPage.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
    const baseRevision = await page.evaluate(
      async ({ projectId, workspaceId }) => {
        const response = await fetch(
          `/api/v1/video-projects/${projectId}?workspace_id=${workspaceId}`,
        );
        return ((await response.json()) as { head_revision: number }).head_revision;
      },
      { projectId, workspaceId: workspace.id },
    );
    const mutate = async (
      targetPage: typeof page,
      mutationId: string,
      target: string,
      path: string,
      value: unknown,
    ) =>
      targetPage.evaluate(
        async ({ projectId, workspaceId, baseRevision, mutationId, target, path, value }) => {
          const response = await fetch(`/api/v1/video-projects/${projectId}/mutations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              workspace_id: workspaceId,
              mutation_id: mutationId,
              base_revision: baseRevision,
              device_id: mutationId.startsWith("desktop") ? "desktop-e2e" : "phone-e2e",
              operations: [{ kind: "set", target, path, value }],
            }),
          });
          return response.json() as Promise<{ outcome: string }>;
        },
        { projectId, workspaceId: workspace.id, baseRevision, mutationId, target, path, value },
      );
    await expect(
      mutate(page, "desktop-copy", "project:description", "/description", "Desktop copy"),
    ).resolves.toMatchObject({ outcome: "applied" });
    await expect(
      mutate(secondPage, "phone-name", "project:name", "/name", "Phone title"),
    ).resolves.toMatchObject({ outcome: "applied" });
    await expect(
      mutate(secondPage, "phone-copy", "project:description", "/description", "Phone copy"),
    ).resolves.toMatchObject({ outcome: "conflict" });
    await secondContext.close();

    await page.locator("header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Version history" }).click();
    const history = page.getByRole("dialog", { name: "Version history" });
    await expect(history).toBeVisible();
    await expect(history.getByText("Loading…", { exact: true })).toHaveCount(0);
    await history.getByRole("textbox", { name: "Checkpoint name" }).fill("Before captions");
    await history.getByRole("button", { name: "Create checkpoint" }).click();
    await expect(history.getByText("Before captions", { exact: true })).toBeVisible();
    await expect(
      history.getByRole("heading", { name: "This project changed elsewhere" }),
    ).toBeVisible();
    await history.getByRole("button", { name: "Load OpenPost version" }).click();
    await expect(
      history.getByRole("heading", { name: "This project changed elsewhere" }),
    ).toHaveCount(0);
    await history
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Close" })
      .click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator("header").getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Version history" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Version history" }).click();
    await expect(page.getByRole("dialog", { name: "Version history" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 720 });
    await page
      .getByRole("dialog", { name: "Version history" })
      .locator('[data-slot="dialog-footer"]')
      .getByRole("button", { name: "Close" })
      .click();

    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Keep available offline" }).click();
    await expect(page.getByText("Available offline", { exact: true })).toBeVisible();
  });

  test("lists a saved Cloud Video Project after returning from the editor", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `cloud-video-return-${unique}@example.com`);
    await createWorkspace(request, auth.token, "Cloud Video Return E2E");
    await authenticatePage(page, auth.token);
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await page.locator("[data-project-details]").click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Return to project");
    await page.getByRole("textbox", { name: "Project name" }).press("Tab");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?storage=cloud$/u);
    await page.goto("/video-editor");
    await expect(page.getByRole("heading", { name: "Return to project" })).toBeVisible();
  });

  test("saving a conflicting local edit as a copy retains its media and opens without re-saving the conflict", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const auth = await registerUser(
      request,
      `cloud-conflict-copy-${Date.now().toString(36)}@example.com`,
    );
    const workspace = (await createWorkspace(request, auth.token, "Conflict copy E2E")) as {
      id: string;
    };
    await authenticatePage(page, auth.token);
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?storage=cloud$/u);
    const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
    const bytes = (
      await readFile(
        fileURLToPath(new URL("./fixtures/product-screenshots/lisbon-tram.png", import.meta.url)),
      )
    ).toString("base64");
    await page.evaluate(async (bytes) => {
      const directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("conflict-copy-fixture", { create: true });
      const handle = await directory.getFileHandle("lisbon-tram.png", { create: true });
      const writable = await handle.createWritable();
      await writable.write(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)));
      await writable.close();
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => [handle],
      });
    }, bytes);
    await page.getByRole("button", { name: "Import media", exact: true }).click();
    await page
      .getByRole("button", { name: "Place on timeline: lisbon-tram.png", exact: true })
      .click();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    const headers = { Authorization: `Bearer ${auth.token}` };
    const projectURL = `/api/v1/video-projects/${projectId}?workspace_id=${workspace.id}`;
    const assetsURL = `/api/v1/video-projects/${projectId}/assets?workspace_id=${workspace.id}`;
    await expect
      .poll(async () => {
        const assets = (await (await request.get(assetsURL, { headers })).json()) as {
          status: string;
        }[];
        return assets.length === 1 && assets.every((asset) => asset.status === "ready");
      })
      .toBe(true);
    const originalAssets = (await (await request.get(assetsURL, { headers })).json()) as {
      id: string;
      media_id: string;
      stable_media_id: string;
    }[];
    const original = (await (await request.get(projectURL, { headers })).json()) as {
      head_revision: number;
    };
    const remote = await request.post(`/api/v1/video-projects/${projectId}/mutations`, {
      headers,
      data: {
        workspace_id: workspace.id,
        mutation_id: "remote-name",
        base_revision: original.head_revision,
        device_id: "remote-editor",
        operations: [
          { kind: "set", target: "project:name", path: "/name", value: "Remote version" },
        ],
      },
    });
    expect(remote.ok()).toBe(true);
    expect(await remote.json()).toMatchObject({ outcome: "applied" });
    await page.locator("[data-project-details]").click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Local version");
    await page.getByRole("textbox", { name: "Project name" }).press("Tab");
    await page.getByRole("button", { name: "This project changed elsewhere", exact: true }).click();
    const history = page.getByRole("dialog", { name: "Version history" });
    await page.route("**/api/v1/video-projects", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          title: "Conflict",
          status: 409,
          detail: "Source uploads are incomplete",
        }),
      });
    });
    await history.getByRole("button", { name: "Save local edit as a copy", exact: true }).click();
    await expect(
      history.getByText(
        "Finish uploading this project's media, then try saving a copy again. Your local edit has been kept.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/video-editor/${projectId}\\?`));
    await expect(page.locator("[data-project-details]")).toContainText("Local version");
    await page.unroute("**/api/v1/video-projects");
    await history.getByRole("button", { name: "Save local edit as a copy", exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(`/video-editor/${projectId}\\?`));
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
    await expect(page.locator("[data-project-details]")).toContainText("Local version copy");
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    const copyId = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(copyId).not.toBe(projectId);
    const copiedAssets = (await (
      await request.get(`/api/v1/video-projects/${copyId}/assets?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json()) as { id: string; media_id: string; stable_media_id: string }[];
    expect(copiedAssets).toHaveLength(1);
    expect(copiedAssets[0].id).not.toBe(originalAssets[0].id);
    expect(copiedAssets[0]).toMatchObject({
      media_id: originalAssets[0].media_id,
      stable_media_id: originalAssets[0].stable_media_id,
      status: "ready",
    });
    await page.reload();
    await page.locator("[data-project-details]").click();
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "Local version copy",
    );
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Place on timeline: lisbon-tram.png", exact: true }),
    ).toBeVisible();
    expect(await (await request.get(projectURL, { headers })).json()).toMatchObject({
      name: "Remote version",
    });
  });
});

test.describe("recorder editor entry", () => {
  async function savedAuthoredProject(page: Page, projectURL: string) {
    const id = new URL(projectURL).pathname.split("/").at(-1)!;
    return page.evaluate(async (projectId) => {
      const root = await navigator.storage.getDirectory();
      const projects = await root.getDirectoryHandle("projects");
      const project = await projects.getDirectoryHandle(projectId);
      const file = await project.getFileHandle("project.json");
      const document = JSON.parse(await (await file.getFile()).text());
      return { timeline: document.timeline, metadata: document.metadata };
    }, id);
  }

  test("an explicit recording handoff reveals persisted main-sequence media from remembered Motion", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => [],
      });
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          const root = await navigator.storage.getDirectory();
          const prototype = Object.getPrototypeOf(root);
          for (const method of ["queryPermission", "requestPermission"])
            if (!(method in prototype))
              Object.defineProperty(prototype, method, {
                configurable: true,
                value: async () => "granted",
              });
          return root;
        },
      });
    });
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Choose folder", exact: true }).click();
    await page.getByRole("button", { name: "Custom project", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Project name", exact: true })
      .fill("Synthetic recording handoff");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
    const ordinaryURL = page.url();
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "red";
      context.fillRect(0, 0, 160, 90);
      const stream = canvas.captureStream(30);
      const recording = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      recording.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const finished = new Promise<void>((resolve) => {
        recording.onstop = () => resolve();
      });
      recording.start();
      const drawing = setInterval(() => context.fillRect(0, 0, 160, 90), 33);
      await new Promise((resolve) => setTimeout(resolve, 350));
      recording.stop();
      await finished;
      clearInterval(drawing);
      stream.getTracks().forEach((track) => track.stop());
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("fixture-sources", { create: true });
      const handle = await directory.getFileHandle("synthetic-recording.webm", { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Blob(chunks, { type: "video/webm" }));
      await writable.close();
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => [handle],
      });
    });
    await page.getByRole("button", { name: "Import media", exact: true }).click();
    await page
      .getByRole("button", { name: "Place on timeline: synthetic-recording.webm", exact: true })
      .click();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    const authored = await savedAuthoredProject(page, ordinaryURL);
    await page.getByRole("tab", { name: "Motion", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "New composition", exact: true })).toBeVisible();
    await page.goto(`${ordinaryURL}?workspace=edit`);
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("tab", { name: "Edit", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    expect(await savedAuthoredProject(page, ordinaryURL)).toEqual(authored);
    await page.getByRole("tab", { name: "Motion", exact: true }).click();
    await page.goto(ordinaryURL);
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "New composition", exact: true })).toBeVisible();
  });
});

test.describe("recording cleanup", () => {
  async function createProject(
    page: Page,
    name: string,
    options: { selectLocalProjects?: boolean } = {},
  ): Promise<void> {
    await installLocalWorkspacePicker(page);
    await page.goto("/video-editor");
    if (options.selectLocalProjects) {
      await page.getByRole("button", { name: "This device" }).click();
    }
    await page.getByRole("button", { name: "Choose folder" }).click();
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await page.getByRole("button", { name: "Custom project" }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u, { timeout: 30_000 });
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
    await page.locator("[data-project-details]").click();
    const projectName = page.getByRole("textbox", { name: "Project name" });
    if ((await projectName.inputValue()) !== name) await projectName.fill(name);
    await page.keyboard.press("Escape");
  }

  test.use({ hasTouch: true });
  test("recording cleanup is reachable, touch usable, and persists voice treatment with its cuts", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 850 });
    await createProject(page, "Recording cleanup");
    const bytes = (
      await readFile(
        fileURLToPath(
          new URL("./fixtures/product-screenshots/study-sos-demo.mp4", import.meta.url),
        ),
      )
    ).toString("base64");
    await page.evaluate(async (bytes) => {
      const root = await navigator.storage.getDirectory();
      const imports = await root.getDirectoryHandle("test-imports", { create: true });
      const handle = await imports.getFileHandle("recording.mp4", { create: true });
      const writable = await handle.createWritable();
      await writable.write(Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0)));
      await writable.close();
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => [handle],
      });
    }, bytes);
    await page.getByRole("button", { name: "Import media", exact: true }).click();
    await page
      .getByRole("button", { name: "Place on timeline: recording.mp4", exact: true })
      .click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    // Fixture captions enter through the portable project document, then the real editor reopens it.
    await page.evaluate(async (id) => {
      const root = await navigator.storage.getDirectory();
      const projects = await root.getDirectoryHandle("projects");
      const directory = await projects.getDirectoryHandle(id);
      const handle = await directory.getFileHandle("project.json");
      const project = JSON.parse(await (await handle.getFile()).text());
      const clip = project.timeline.items.find((item: { type: string }) => item.type === "video");
      const fps = project.fps ?? project.metadata?.fps ?? 30;
      project.timeline.items.push({
        id: "review-captions",
        type: "subtitle",
        label: "Review captions",
        trackId: "track-video-overlay",
        from: 0,
        durationInFrames: clip.durationInFrames,
        captionSource: {
          type: "transcript",
          clipId: clip.id,
          mediaId: clip.mediaId,
          sourceStartSeconds: 0,
          sourceEndSeconds: clip.durationInFrames / fps,
        },
        cues: [
          {
            id: "review-cue",
            startFrame: 0,
            endFrame: clip.durationInFrames,
            text: "um this saves time",
            words: [
              { id: "um", text: "um", startFrame: 0, endFrame: 9 },
              { id: "this", text: "this", startFrame: 30, endFrame: 42 },
              { id: "saves", text: "saves", startFrame: 45, endFrame: 60 },
              { id: "time", text: "time", startFrame: 63, endFrame: 78 },
            ],
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(project));
      await writable.close();
    }, id);
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 30_000,
    });
    const entry = page
      .getByRole("banner")
      .getByRole("button", { name: "Clean up recording", exact: true });
    await expect(entry).toBeEnabled();
    await entry.click();
    const dialog = page.getByRole("dialog", { name: "Clean up recording", exact: true });
    await expect(dialog.getByRole("checkbox", { name: "Include um", exact: true })).toBeVisible();
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
    await page.setViewportSize({ width: 1280, height: 850 });
    await expect(dialog.getByRole("button", { name: "Apply changes", exact: true })).toBeVisible();
    const tabs = dialog.getByRole("tab");
    for (const tab of await tabs.all())
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dialog.getByRole("checkbox", { name: "Clean voice", exact: true }).tap();
    await dialog.getByRole("button", { name: "Apply changes", exact: true }).tap();
    await expect(dialog).not.toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    await page.getByRole("banner").getByRole("button", { name: "More actions", exact: true }).tap();
    await page.getByRole("menuitem", { name: "Clean up recording", exact: true }).tap();
    await expect(dialog).toBeVisible();
    const persisted = await page.evaluate(async (id) => {
      const root = await navigator.storage.getDirectory();
      const projects = await root.getDirectoryHandle("projects");
      const directory = await projects.getDirectoryHandle(id);
      return JSON.parse(
        await (await (await directory.getFileHandle("project.json")).getFile()).text(),
      );
    }, id);
    const clips = persisted.timeline.items.filter(
      (item: { type: string }) => item.type === "video",
    );
    expect(clips.length).toBeGreaterThan(0);
    expect(
      clips.every(
        (item: { audioNoiseReductionEnabled?: boolean; audioEffects?: Array<{ type: string }> }) =>
          item.audioNoiseReductionEnabled &&
          item.audioEffects?.some((effect) => effect.type === "compressor"),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
});
