import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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

test.describe("video editor panels", () => {
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
});

test.describe("video editor repair", () => {
  const CLOUD_SAVE_TIMEOUT_MS = 15_000;

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
});

test.describe("video editor shaders", () => {
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
