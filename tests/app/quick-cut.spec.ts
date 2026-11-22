import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

test.describe("quick cut cloud", () => {
  test("Quick Cut saves a source project to OpenPost and opens it again", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(240_000);
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `quick-cut-cloud-${unique}@example.com`);
    const workspace = z
      .object({ id: z.string() })
      .parse(await createWorkspace(request, auth.token, "Quick Cut Cloud E2E"));
    await authenticatePage(page, auth.token);

    await page.addInitScript(() => {
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: undefined,
      });
    });

    await page.goto("/quick-cut");
    await expect(page.getByRole("button", { name: "OpenPost cloud" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const chooserPromise = page.waitForEvent("filechooser");
    const cloudCreatePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/v1/video-projects"),
    );
    await page.getByRole("button", { name: "Open videos" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(
      path.join(process.cwd(), "tests/app/fixtures/product-screenshots/study-sos-demo.mp4"),
    );

    await expect((await cloudCreatePromise).ok()).toBe(true);
    await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
    await expect(page).toHaveURL(/\/quick-cut\?project=[^&]+&storage=cloud$/u);
    const savedProjectURL = page.url();
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open videos", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(savedProjectURL);
    await expect(
      page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    const projectName = page.getByRole("textbox", { name: "Project name" });
    const renameResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/mutations"),
    );
    await projectName.fill("Launch trim");
    await expect((await renameResponse).ok()).toBe(true);
    await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Launch trim");
    await expect
      .poll(
        async () => {
          const response = await request.get(
            `/api/v1/video-projects?workspace_id=${workspace.id}`,
            {
              headers: { Authorization: `Bearer ${auth.token}` },
            },
          );
          return response.ok()
            ? z.array(z.unknown()).parse(await response.json()).length
            : -response.status();
        },
        { timeout: 90_000 },
      )
      .toBe(1);

    const exportButton = page
      .locator("header.editor-header")
      .getByRole("button", { name: "Export", exact: true });
    const width = 1280;

    const colorScheme = "light";
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
    await expect(exportButton).toBeVisible();
    await exportButton.focus();
    await expect(exportButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Export", exact: true })).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("link", { name: "Back", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/quick-cut$/u);
    await expect(page.getByRole("button", { name: "Open videos", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveCount(0);
    await page.reload();
    const savedProject = page.getByRole("listitem").filter({ hasText: "Launch trim" });
    await expect(savedProject).toBeVisible();
    await savedProject.getByRole("button", { name: /Launch trim/ }).click();
    await expect(
      page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
    ).toBeVisible({
      timeout: 90_000,
    });
    const preview = page.locator(".viewer").getByRole("button", { name: "Preview", exact: true });
    await preview.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
  });
});

test.describe("quick cut loading", () => {
  test.use({ serviceWorkers: "block" });

  test("Quick Cut protects unsaved work and offers a project backup after an export download failure", async ({
    page,
    request,
  }, testInfo) => {
    const { token } = await registerUser(request, `quick-cut-loading-${randomUUID()}@example.com`);
    await createWorkspace(request, token, "Quick Cut loading");
    await authenticatePage(page, token);
    await page.goto("/quick-cut");
    await expect(page.getByRole("button", { name: "Open videos", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import project", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "saved-cuts.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          id: "saved-cuts",
          name: "Saved cuts",
          createdAt: 1,
          updatedAt: 1,
          cutMode: "nearestKeyframe",
          merge: true,
          sources: [
            {
              id: "source",
              name: "recording.mp4",
              size: 1024,
              mimeType: "video/mp4",
              duration: 8,
              width: 640,
              height: 360,
              videoCodec: "avc",
              audioCodec: null,
              sampleRate: null,
              channels: null,
              rotation: 0,
              fps: 30,
              keyframeTimestamps: [0, 2, 4, 6],
              keyframeState: "known",
              videoStreams: [
                {
                  index: 0,
                  codec: "avc",
                  width: 640,
                  height: 360,
                  rotation: 0,
                  fps: 30,
                  keyframeTimestamps: [0, 2, 4, 6],
                  keyframeState: "known",
                },
              ],
              audioStreams: [],
            },
          ],
          segments: [
            {
              id: "cut",
              sourceId: "source",
              start: 2,
              end: 4,
              name: "Chosen section",
              enabled: false,
            },
          ],
        }),
      ),
    });
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(
      "Saved cuts",
    );
    // Import uses its own lazy modules. Fail downloads only once the project is
    // open; enabling the saved cut then requests the export runtime for preflight.
    await page.route("**/*.js", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Segment 1", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Enable segment", exact: true }).click();
    await page
      .locator("header.editor-header")
      .getByRole("button", { name: "Export", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "The export could not finish." }),
    ).toBeVisible();
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await expect(refresh).toBeVisible();
    const width = 320;

    const colorScheme = "light";
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await refresh.scrollIntoViewIfNeeded();
    await refresh.focus();
    await expect(refresh).toBeFocused();
    expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await expect(page.locator("html")).toHaveAttribute("data-unsaved-changes", "1");
    const preventedRefresh = page.waitForEvent("dialog");
    const refreshRequested = page.keyboard.press("Enter");
    const beforeUnload = await preventedRefresh;
    expect(beforeUnload.type()).toBe("beforeunload");
    await beforeUnload.dismiss();
    await refreshRequested;
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(
      "Saved cuts",
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export project", exact: true }).click();
    const backup = await download;
    const backupPath = testInfo.outputPath("saved-cuts.json");
    await backup.saveAs(backupPath);
    const saved = JSON.parse(await readFile(backupPath, "utf8"));
    expect(saved.name).toBe("Saved cuts");
    expect(saved.segments).toEqual([
      expect.objectContaining({ sourceId: "source", start: 2, end: 4, name: "Chosen section" }),
    ]);
    await page.unroute("**/*.js");
    page.once("dialog", (dialog) => dialog.accept());
    await refresh.click();
    await expect(page.getByRole("button", { name: "Import project", exact: true })).toBeVisible();
    const restore = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import project", exact: true }).click();
    await (await restore).setFiles(backupPath);
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(
      "Saved cuts",
    );
    await page
      .locator("header.editor-header")
      .getByRole("button", { name: "Export", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Export merged", exact: true })).toBeEnabled();
  });

  test("leaving Quick Cut cancels a source whose processing module is still loading", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(request, `quick-cut-leave-${randomUUID()}@example.com`);
    const workspace = z
      .object({ id: z.string() })
      .parse(await createWorkspace(request, token, "Quick Cut cancellation"));
    await authenticatePage(page, token);
    await page.addInitScript(() => {
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined });
      const createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        if (blob instanceof File && blob.name === "study-sos-demo.mp4") {
          document.documentElement.dataset.quickCutSourceUrls = String(
            Number(document.documentElement.dataset.quickCutSourceUrls ?? 0) + 1,
          );
        }
        return createObjectURL(blob);
      };
    });
    await page.goto("/studio");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /Quick Cut/ }).click();
    await expect(page).toHaveURL(/\/quick-cut$/);
    await page.waitForLoadState("networkidle");
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let holding = false;
    let heldURL = "";
    await page.route("**/*.js", async (route) => {
      if (!holding) {
        holding = true;
        heldURL = route.request().url();
        markHeld();
        await released;
      }
      await route.continue();
    });
    try {
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Open videos", exact: true }).click();
      await (await chooser).setFiles("tests/app/fixtures/product-screenshots/study-sos-demo.mp4");
      await held;
      await page.goBack();
      await expect(page).toHaveURL(/\/studio$/);
      await page.getByRole("link", { name: /Image Editor/ }).click();
      await expect(page).toHaveURL(/\/image-editor$/);
      const delivered = page.waitForResponse(heldURL);
      release();
      await (await delivered).finished();
      // A bounded frame window lets the released continuation run before asserting nothing was created.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let frames = 0;
            const tick = () => (++frames < 60 ? requestAnimationFrame(tick) : resolve());
            tick();
          }),
      );
      const projects = await request.get(`/api/v1/video-projects?workspace_id=${workspace.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(projects.ok()).toBe(true);
      expect(await projects.json()).toEqual([]);
      expect(await page.locator("html").getAttribute("data-quick-cut-source-urls")).toBeNull();
      await expect(page).toHaveURL(/\/image-editor$/);
    } finally {
      release();
    }
  });

  test("a first cloud save completing during export does not ask to discard the export", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(
      request,
      `quick-cut-save-export-${randomUUID()}@example.com`,
    );
    await createWorkspace(request, token, "Quick Cut save during export");
    await authenticatePage(page, token);
    await page.addInitScript(() => {
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined });
    });
    const createGate = Promise.withResolvers<void>();
    const uploadGate = Promise.withResolvers<void>();
    const uploadHeld = Promise.withResolvers<void>();
    await page.route(/\/api\/v1\/video-projects(?:\?|$)/, async (route) => {
      if (route.request().method() === "POST") await createGate.promise;
      await route.continue();
    });
    let holdingExport = false;
    await page.route("**/api/v1/media/upload**", async (route) => {
      if (!holdingExport && route.request().method() === "POST") {
        holdingExport = true;
        uploadHeld.resolve();
        await uploadGate.promise;
      }
      await route.continue();
    });
    const unexpectedDialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      unexpectedDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    try {
      await page.goto("/quick-cut");
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Open videos", exact: true }).click();
      await (await chooser).setFiles("tests/app/fixtures/product-screenshots/study-sos-demo.mp4");
      await page
        .locator("header.editor-header")
        .getByRole("button", { name: "Export", exact: true })
        .click();
      await page.getByRole("button", { name: "Send to OpenPost", exact: true }).click();
      await uploadHeld.promise;
      createGate.resolve();
      await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
      expect(unexpectedDialogs).toEqual([]);
      uploadGate.resolve();
      await expect(page.getByText("Sent to OpenPost.", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/quick-cut\?project=[^&]+&storage=cloud$/);
      expect(unexpectedDialogs).toEqual([]);
    } finally {
      createGate.resolve();
      uploadGate.resolve();
    }
  });
});

test.describe("quick cut repurpose", () => {
  const projectSchema = z
    .object({
      id: z.string(),
      document: z
        .object({
          timeline: z
            .object({
              sources: z.array(
                z
                  .object({
                    id: z.string(),
                    duration: z.number(),
                    transcript: z.unknown().optional(),
                  })
                  .passthrough(),
              ),
              segments: z.array(
                z
                  .object({
                    sourceId: z.string(),
                    start: z.number(),
                    end: z.number(),
                    cutMode: z.string().optional(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough();
  const suggestionRequestSchema = z.object({
    workspace_id: z.string(),
    source: z.object({ id: z.string(), revision: z.string(), audio_track_index: z.number() }),
  });

  test("Repurpose reviews real source clips and creates independent editable projects that reopen", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(300_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const auth = await registerUser(request, `repurpose-${Date.now()}@example.com`);
    const workspace = z
      .object({ id: z.string() })
      .parse(await createWorkspace(request, auth.token, "Repurpose review"));
    const headers = { Authorization: `Bearer ${auth.token}` };
    await authenticatePage(page, auth.token);
    await page.addInitScript(() =>
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
    );
    await page.goto("/quick-cut");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open videos", exact: true }).click();
    await (
      await chooser
    ).setFiles(
      path.join(process.cwd(), "tests/app/fixtures/product-screenshots/study-sos-demo.mp4"),
    );
    await expect(page).toHaveURL(/project=[^&]+&storage=cloud/u);
    await expect(page.getByRole("img", { name: /Saved to OpenPost/u })).toBeVisible();
    const originalId = new URL(page.url()).searchParams.get("project")!;
    const original = projectSchema.parse(
      await (
        await request.get(`/api/v1/video-projects/${originalId}`, {
          headers,
          params: { workspace_id: workspace.id },
        })
      ).json(),
    );
    const words = [
      "We",
      "launched",
      "a",
      "simpler",
      "workflow",
      "today.",
      "Customers",
      "save",
      "time.",
      "Thanks.",
    ].map((text, index) => ({ text, start: index * 0.7 + 0.1, end: index * 0.7 + 0.6 }));
    // A legacy saved transcript exercises migration into the real browser-local transcript owner.
    await page.route(
      (url) => url.pathname === `/api/v1/video-projects/${originalId}`,
      async (route) => {
        const response = await route.fetch();
        const saved = projectSchema.parse(await response.json());
        saved.document.timeline.sources[0]!.transcript = { audioTrackIndex: 0, words };
        await route.fulfill({ response, json: saved });
      },
      { times: 1 },
    );
    let suggestion: object | null = null;
    let submissions = 0;
    await page.route("**/api/v1/repurpose-suggestions", async (route) => {
      const body = suggestionRequestSchema.parse(route.request().postDataJSON());
      submissions++;
      expect(body.source.audio_track_index).toBe(0);
      suggestion = {
        id: "review-one",
        revision: 1,
        workspace_id: workspace.id,
        source_id: body.source.id,
        source_revision: body.source.revision,
        state: "ready",
        updated_at: new Date().toISOString(),
        candidates: [
          {
            id: "launch",
            title: "A simpler workflow",
            rationale: "A complete product update",
            context_warning: "Check the opening words",
            first_word: 1,
            last_word: 5,
            start: words[1]!.start,
            end: words[5]!.end,
          },
          {
            id: "benefit",
            title: "Customers save time",
            rationale: "A concise benefit",
            context_warning: "",
            first_word: 6,
            last_word: 8,
            start: words[6]!.start,
            end: words[8]!.end,
          },
        ],
      };
      await route.fulfill({ status: 202, json: suggestion });
    });
    await page.route("**/api/v1/repurpose-suggestions/review-one", async (route) =>
      route.fulfill({ json: suggestion }),
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Cleanup", exact: true }).click();
    await expect(page.getByRole("button", { name: "Find clips", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Find clips", exact: true }).click();
    await page.getByRole("button", { name: "Find clips", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "A simpler workflow", exact: true }),
    ).toBeVisible();
    expect(submissions).toBe(1);
    const before = await request.get(`/api/v1/video-projects?workspace_id=${workspace.id}`, {
      headers,
    });
    expect(z.array(z.unknown()).parse(await before.json())).toHaveLength(1);

    const touch = await page.context().newCDPSession(page);
    const width = 320;

    await touch.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    const colorScheme = "light";
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(
      page.getByRole("button", { name: "A simpler workflow", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);

    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const checkbox = page.getByRole("checkbox", {
      name: "Include Customers save time",
      exact: true,
    });
    await checkbox.scrollIntoViewIfNeeded();
    const bounds = await checkbox.boundingBox();
    for (const checked of [false, true]) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }],
      });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(checkbox).toHaveAttribute("aria-checked", String(checked));
    }

    await page.getByRole("button", { name: "Find again", exact: true }).scrollIntoViewIfNeeded();

    const create = page.getByRole("button", { name: "Create clips (2)", exact: true });
    await create.scrollIntoViewIfNeeded();
    await expect(create).toBeInViewport();
    expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    expect(submissions).toBe(1);
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("textbox", { name: "Start", exact: true }).fill("0.1");
    await page.keyboard.press("Tab");
    await page
      .getByRole("checkbox", { name: "Include Customers save time", exact: true })
      .uncheck();
    await page.getByRole("button", { name: "Preview clip", exact: true }).focus();
    await page.keyboard.press("Enter");
    const preview = page.getByLabel("Preview A simpler workflow", { exact: true });
    await expect(preview).toBeVisible({ timeout: 90_000 });
    await preview.evaluate(async (element: HTMLVideoElement) => {
      await element.play();
    });
    await expect
      .poll(() => preview.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0);
    await preview.evaluate((element: HTMLVideoElement) => element.pause());
    await page.getByRole("button", { name: "Create clips (1)", exact: true }).click();
    const outputLink = page.getByRole("link", { name: "Open clip project", exact: true });
    await expect(outputLink).toBeVisible({ timeout: 90_000 });
    const href = await outputLink.getAttribute("href");
    const outputId = new URL(href!, page.url()).searchParams.get("project")!;
    const output = projectSchema.parse(
      await (
        await request.get(`/api/v1/video-projects/${outputId}`, {
          headers,
          params: { workspace_id: workspace.id },
        })
      ).json(),
    );
    expect(outputId).not.toBe(originalId);
    expect(output.document.timeline.sources[0]!.id).not.toBe(
      original.document.timeline.sources[0]!.id,
    );
    expect(output.document.timeline.sources[0]!.duration).toBe(
      original.document.timeline.sources[0]!.duration,
    );
    expect(output.document.timeline.sources[0]!.transcript).toBeUndefined();
    expect(output.document.timeline.segments).toMatchObject([
      { start: 0.1, end: words[5]!.end, cutMode: "exact" },
    ]);
    const unchanged = projectSchema.parse(
      await (
        await request.get(`/api/v1/video-projects/${originalId}`, {
          headers,
          params: { workspace_id: workspace.id },
        })
      ).json(),
    );
    expect(unchanged.document.timeline.segments).toEqual(original.document.timeline.segments);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Cleanup", exact: true }).click();
    await page.getByRole("button", { name: "Find clips", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Start", exact: true })).toHaveValue("00:00.10");
    await expect(
      page.getByRole("checkbox", { name: "Include Customers save time", exact: true }),
    ).not.toBeChecked();
    await page.getByRole("link", { name: "Open clip project", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "A simpler workflow",
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Cleanup", exact: true }).click();
    await page.getByRole("button", { name: "Find clips", exact: true }).click();
    await expect(page.getByRole("button", { name: /Find (clips|again)/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Create transcript", exact: true })).toHaveCount(
      0,
    );
    expect(pageErrors).toEqual([]);
  });
});

test.describe("quick cut workflow", () => {
  const fixture = path.join(
    process.cwd(),
    "tests/app/fixtures/product-screenshots/study-sos-demo.mp4",
  );
  async function seek(page: Page, time: number) {
    await page.locator("video").evaluate(async (video: HTMLVideoElement, time) => {
      video.pause();
      if (Math.abs(video.currentTime - time) < 0.001) return;
      await new Promise<void>((resolve) => {
        video.addEventListener("seeked", () => resolve(), { once: true });
        video.currentTime = time;
      });
    }, time);
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeCloseTo(time, 1);
  }

  test("Quick Cut keeps earlier cuts, supports undo, markers, and exports the edited duration", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const auth = await registerUser(request, `quick-workflow-${Date.now()}@example.com`);
    await createWorkspace(request, auth.token, "Quick workflow");
    await authenticatePage(page, auth.token);
    await page.addInitScript(() =>
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
    );
    await page.goto("/quick-cut");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open videos", exact: true }).click();
    await (await chooser).setFiles(fixture);
    await expect(page.locator("video")).toBeVisible();
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);

    await page.getByRole("button", { name: "Segment 1", exact: true }).click();
    const markIn = page.getByRole("textbox", { name: "Mark in 1", exact: true });
    const markOut = page.getByRole("textbox", { name: "Mark out 1", exact: true });
    await expect(markOut).toBeVisible();
    const originalOut = await markOut.inputValue();
    await markIn.fill("1");
    await markIn.press("Tab");
    await expect(markIn).toHaveValue("00:01.00");
    await markOut.fill("banana");
    await markOut.press("Tab");
    await expect(markOut).toHaveValue(originalOut);
    await expect(
      page.getByRole("status").filter({ hasText: "Enter seconds or a timecode" }),
    ).toBeVisible();
    await markOut.fill("0");
    await markOut.press("Tab");
    await expect(markOut).toHaveValue(originalOut);
    await expect(page.getByText("Keep at least 0.05 seconds.", { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await page
          .getByText("Keep at least 0.05 seconds.", { exact: true })
          .boundingBox();
        return !!bounds && bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize()!.height;
      })
      .toBe(true);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(markIn).toHaveValue("00:00.00");
    await expect(markOut).toHaveValue(originalOut);
    await markIn.fill("2");
    await markIn.press("Escape");
    await expect(markIn).toHaveValue("00:00.00");
    await markIn.press("Tab");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
    await page.reload();
    await expect(markIn).toHaveValue("00:00.00");
    await expect(markOut).toHaveValue(originalOut);
    await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
    await page.locator('[data-collapsible-trigger][aria-label="Segment files"]').click();
    await page.getByRole("button", { name: "Segment files", exact: true }).last().click();
    const importSegments = page.getByRole("menuitem", { name: /^Import segments/ });
    await expect(importSegments).toBeVisible();
    const [segmentChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15_000 }),
      importSegments.click(),
    ]);
    await segmentChooser.setFiles({
      name: "overlap.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("start,end,name\n0,1,Overlapping part\n"),
    });
    await expect(
      page.getByText("Ranges overlap. Adjust or remove an existing range before trying again.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Segment 2", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect
      .poll(async () => {
        const bounds = await page
          .getByText("Ranges overlap. Adjust or remove an existing range before trying again.", {
            exact: true,
          })
          .boundingBox();
        return !!bounds && bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize()!.height;
      })
      .toBe(true);
    await expect(markIn).toHaveValue("00:00.00");
    await expect(markOut).toHaveValue(originalOut);
    await page.reload();
    await expect(markIn).toHaveValue("00:00.00");
    await expect(markOut).toHaveValue(originalOut);
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);

    // The playhead follows pointer input without waiting for a slow decoder.
    const timeline = page.getByRole("button", { name: "Seek in timeline", exact: true });
    const bounds = await timeline.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width * 0.7, bounds!.y + bounds!.height / 2, {
      steps: 40,
    });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.locator("video").evaluate((video) => {
          if (!(video instanceof HTMLVideoElement)) throw new Error("Video element expected");
          const media = video;
          return Math.abs(media.currentTime - media.duration * 0.7);
        }),
      )
      .toBeLessThan(0.1);
    await seek(page, 2);
    await page.getByRole("button", { name: /^Mark in/ }).click();
    await seek(page, 3);
    await page.getByRole("button", { name: /^Mark out/ }).click();
    await expect(page.getByRole("button", { name: "Remove selection", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Keep selection", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Remove selection", exact: true }).click();
    await expect(page.getByRole("button", { name: "Segment 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Segment 2", exact: true }).click();
    const secondIn = page.getByRole("textbox", { name: "Mark in 2", exact: true });
    await secondIn.fill("1");
    await secondIn.press("Tab");
    await expect(secondIn).toHaveValue("00:03.00");
    await expect(
      page.getByText("Ranges overlap. Adjust or remove an existing range before trying again.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Ranges overlap." })
      .getByRole("button", { name: "Close toast" })
      .click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Segment 2", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await seek(page, 1);
    await page.getByRole("button", { name: /^Mark in/ }).click();
    await seek(page, 7);
    await page.getByRole("button", { name: /^Mark out/ }).click();
    await page.getByRole("button", { name: "Keep selection", exact: true }).click();
    await expect(page.getByRole("button", { name: "Segment 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add marker", exact: true }).click();
    await page.getByRole("textbox", { name: "Marker name" }).fill("Review take");
    await page.getByRole("textbox", { name: "Marker name" }).press("Tab");
    await page.getByRole("button", { name: "Preview edit", exact: true }).click();
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime), {
        timeout: 15_000,
      })
      .toBeGreaterThan(3);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export merged", exact: true }).click();
    const exported = await download;
    expect(await exported.failure()).toBeNull();
    const output = await readFile((await exported.path())!);
    const duration = await page.evaluate(async (bytes) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/mp4" }));
      const video = document.createElement("video");
      video.src = url;
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error("Export cannot play"));
        });
        return video.duration;
      } finally {
        video.src = "";
        URL.revokeObjectURL(url);
      }
    }, Array.from(output));
    expect(duration).toBeCloseTo(5, 1);
  });

  test("reordered whole-edit preview plays the final short source range and cancels cleanly", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.addInitScript(() =>
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
    );
    await page.goto("/quick-cut");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open videos", exact: true }).click();
    await (await chooser).setFiles(fixture);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);
    await page.getByRole("button", { name: "Segment 1", exact: true }).click();
    const out = page.getByRole("textbox", { name: "Mark out 1", exact: true });
    await out.fill("8");
    await out.press("Tab");
    await seek(page, 1);
    await page.getByRole("button", { name: /^Mark in/ }).click();
    await seek(page, 3);
    await page.getByRole("button", { name: /^Mark out/ }).click();
    await page.getByRole("button", { name: "Remove selection", exact: true }).click();
    await page.getByRole("button", { name: "Move down", exact: true }).first().click();
    await page.getByRole("button", { name: "Segment 1", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Mark in 1", exact: true })).toHaveValue(
      "00:03.00",
    );
    await page.getByRole("button", { name: "Segment 2", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Mark out 2", exact: true })).toHaveValue(
      "00:01.00",
    );
    const preview = page.getByRole("button", { name: "Preview edit", exact: true });
    await preview.focus();
    await preview.press("Enter");
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(3);
    // Observe a presented decoded frame in the final source range, not merely a seek assignment.
    await video.evaluate(
      (element: HTMLVideoElement) =>
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Final short part never presented a progressing frame")),
            12_000,
          );
          const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
            if (metadata.mediaTime > 0.2 && metadata.mediaTime < 1) {
              clearTimeout(timeout);
              resolve();
            } else element.requestVideoFrameCallback(frame);
          };
          element.requestVideoFrameCallback(frame);
        }),
    );
    await expect
      .poll(
        () =>
          video.evaluate(
            (element: HTMLVideoElement) => element.paused && element.currentTime >= 0.98,
          ),
        { timeout: 3000 },
      )
      .toBe(true);
    await preview.click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const stopped = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    // Paused playback must stay still across a bounded window of frames.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let frames = 0;
          const tick = () => (++frames < 20 ? requestAnimationFrame(tick) : resolve());
          tick();
        }),
    );
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
      stopped,
      2,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("button", { name: "Segment 1", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Mark in 1", exact: true })).toHaveValue(
      "00:00.00",
    );
  });

  test("guest Quick Cut keeps unsaved local work explicit", async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() =>
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
    );
    await page.goto("/quick-cut");
    await expect(page.getByRole("button", { name: "Open videos", exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Projects are saved in the workspace folder when one is chosen. Otherwise import/export works via files.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 3000 });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open videos", exact: true }).click();
    await (await chooser).setFiles(fixture);
    await expect(page.locator("video")).toBeVisible();
    await expect(page.getByRole("img", { name: "Local only · Unsaved changes" })).toBeVisible();
    await expect(page).toHaveURL(/\/quick-cut$/u);
    await page.getByRole("button", { name: "Zoom in timeline" }).click();
    await expect(page.getByRole("button", { name: "Reset timeline zoom" })).toHaveText("200%");
  });

  test("video creation offers both editors and imports composer media into either one", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const auth = await registerUser(request, `video-choice-${Date.now()}@example.com`);
    const workspace = z
      .object({ id: z.string() })
      .parse(await createWorkspace(request, auth.token, "Video choice"));
    const upload = await request.post("/api/v1/media/upload", {
      headers: { Authorization: `Bearer ${auth.token}` },
      multipart: {
        workspace_id: workspace.id,
        source: "upload",
        asset_kind: "library",
        retention_class: "library",
        file: { name: "recording.mp4", mimeType: "video/mp4", buffer: await readFile(fixture) },
      },
    });
    expect(upload.ok()).toBe(true);
    const media = z.object({ id: z.string() }).parse(await upload.json());
    const metadata = await request.get(
      `/api/v1/media/metadata?workspace_id=${workspace.id}&media_ids=${media.id}`,
      {
        headers: { Authorization: `Bearer ${auth.token}` },
      },
    );
    expect(metadata.ok()).toBe(true);
    expect(
      z
        .object({ media: z.array(z.object({ id: z.string(), original_filename: z.string() })) })
        .parse(await metadata.json()).media,
    ).toEqual([{ id: media.id, original_filename: "recording.mp4" }]);
    await authenticatePage(page, auth.token);
    const start = `/video-editor/new?source=media:${media.id}`;
    await page.goto(start);
    await page.getByRole("link", { name: "Open Quick Cut", exact: true }).click();
    await expect(page.locator("video")).toBeVisible({ timeout: 90_000 });
    await expect(
      page
        .getByRole("group", { name: "Sources", exact: true })
        .getByRole("button", { name: /recording\.mp4$/ }),
    ).toBeVisible();
    await page.goto(start);
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await expect(page).toHaveURL(/\/video-editor\/[^/?]+\?storage=cloud$/, { timeout: 90_000 });
    await expect(page.getByRole("button", { name: /recording\.mp4/ }).first()).toBeVisible({
      timeout: 90_000,
    });
    await page.reload();
    await expect(page.getByRole("button", { name: /recording\.mp4/ }).first()).toBeVisible({
      timeout: 90_000,
    });
  });

  test("local Quick Cut library survives a corrupt project and reopens after reload", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: () => navigator.storage.getDirectory(),
      });
    });
    await page.goto("/quick-cut");
    await page.getByRole("button", { name: "Choose folder", exact: true }).click();
    await page.evaluate(() =>
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
    );
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open videos", exact: true }).click();
    await (await chooser).setFiles(fixture);
    await expect(page).toHaveURL(/project=.+&storage=local/);
    const savedURL = page.url();
    await expect(page.getByRole("img", { name: "Local only", exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const cuts = await root.getDirectoryHandle("quick-cut");
      const projects = await cuts.getDirectoryHandle("projects");
      const broken = await projects.getFileHandle("broken.json", { create: true });
      const writer = await broken.createWritable();
      await writer.write("invalid JSON");
      await writer.close();
    });
    await page.goto("/quick-cut");
    await expect(page.getByRole("alert").filter({ hasText: "broken.json" })).toBeVisible();
    await page
      .getByRole("button")
      .filter({ has: page.getByRole("img", { name: "Local only", exact: true }) })
      .click();
    await expect(page).toHaveURL(savedURL);
    await expect(page.locator("video")).toBeVisible();
    await page.reload();
    await expect(page.locator("video")).toBeVisible();
  });

  test("Quick Cut explains saved removed words and restores a phrase through kept ranges", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const auth = await registerUser(request, `quick-speech-recovery-${Date.now()}@example.com`);
    const workspace = z
      .object({ id: z.string() })
      .parse(await createWorkspace(request, auth.token, "Speech recovery"));
    await authenticatePage(page, auth.token);
    await page.addInitScript(() =>
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
    );
    await page.goto("/quick-cut");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open videos", exact: true }).click();
    await (await chooser).setFiles(fixture);
    await expect(page).toHaveURL(/\/quick-cut\?project=[^&]+&storage=cloud$/u);
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);
    const projectId = new URL(page.url()).searchParams.get("project")!;
    const headers = { Authorization: `Bearer ${auth.token}` };
    const projectURL = `/api/v1/video-projects/${projectId}?workspace_id=${workspace.id}`;
    const schema = z.object({
      head_revision: z.number(),
      document: z
        .object({
          timeline: z
            .object({
              sources: z.array(
                z
                  .object({
                    id: z.string(),
                    duration: z.number(),
                    audioStreams: z.array(z.object({ index: z.number() }).passthrough()),
                  })
                  .passthrough(),
              ),
              segments: z.array(
                z
                  .object({
                    id: z.string(),
                    sourceId: z.string(),
                    start: z.number(),
                    end: z.number(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        })
        .passthrough(),
    });
    const saved = schema.parse(await (await request.get(projectURL, { headers })).json());
    const input = saved.document.timeline.sources[0]!;
    const transcript = {
      audioTrackIndex: input.audioStreams[0]!.index,
      words: [
        { text: "Hello", start: 0, end: 0.5 },
        { text: "again", start: 1, end: 1.5 },
        { text: "friends", start: 2, end: 2.5 },
      ],
    };
    const priorCuts = [
      { id: "before-phrase", sourceId: input.id, start: 0.5, end: 1, cutMode: "exact" },
      { id: "after-phrase", sourceId: input.id, start: 1.5, end: input.duration, cutMode: "exact" },
    ];
    const seed = await request.post(`/api/v1/video-projects/${projectId}/mutations`, {
      headers,
      data: {
        workspace_id: workspace.id,
        mutation_id: `speech-recovery-${Date.now()}`,
        base_revision: saved.head_revision,
        operations: [
          {
            kind: "set",
            target: `source:${input.id}`,
            path: "/timeline/sources",
            value: [{ ...input, transcript }],
          },
          {
            kind: "set",
            target: "timeline:segments",
            path: "/timeline/segments",
            value: priorCuts,
          },
        ],
      },
    });
    expect(seed.ok()).toBe(true);
    expect(z.object({ outcome: z.string() }).parse(await seed.json()).outcome).toBe("applied");
    await page.reload();
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    const transcriptTab = page.getByRole("button", { name: "Transcript", exact: true });
    await transcriptTab.click();
    await expect(page.getByRole("button", { name: "again", exact: true })).toBeDisabled();
    const hint = page.getByText(
      "Removed words stay in the transcript. Open Cuts and adjust or add a kept range to include their source times.",
      { exact: true },
    );
    await expect(hint).toBeVisible();
    await expect(page.getByText("again · 00:01.00 → 00:01.50", { exact: true })).toBeVisible();
    const openCuts = hint.locator("..").getByRole("button", { name: "Cuts", exact: true });
    await openCuts.focus();
    await expect(openCuts).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("group", { name: "Editing tools", exact: true })
        .getByRole("button", { name: "Cuts", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Segment 1", exact: true }).click();
    const end = page.getByRole("textbox", { name: "Mark out 1", exact: true });
    await end.fill("1.5");
    await end.press("Tab");
    await expect(end).toHaveValue("00:01.50");
    await transcriptTab.click();
    await expect(page.getByRole("button", { name: "again", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Hello", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "again", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByRole("button", { name: "again", exact: true })).toBeEnabled();
    await expect
      .poll(async () => {
        const current = schema.parse(await (await request.get(projectURL, { headers })).json());
        return current.document.timeline.segments;
      })
      .toEqual([{ ...priorCuts[0], end: 1.5 }, priorCuts[1]]);
    await page.reload();
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);
    await transcriptTab.click();
    await expect(page.getByRole("button", { name: "again", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Hello", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "friends", exact: true })).toBeEnabled();
    await expect(page.getByText("Hello · 00:00.00 → 00:00.50", { exact: true })).toBeVisible();
    const restored = schema.parse(await (await request.get(projectURL, { headers })).json());
    expect(restored.document.timeline.sources).toEqual([input]);
    expect(restored.document.timeline.sources[0]).not.toHaveProperty("transcript");
    const width = 390;
    const scheme = "light";

    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.reload();
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);
    await transcriptTab.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    await expect(page.getByRole("button", { name: "again", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Hello", exact: true })).toBeDisabled();
    await expect(hint).toBeVisible();
    await page.getByRole("button", { name: "again", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove word", exact: true })).toBeEnabled();
    await openCuts.scrollIntoViewIfNeeded();
    await openCuts.focus();
    await expect(openCuts).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("group", { name: "Editing tools", exact: true })
        .getByRole("button", { name: "Cuts", exact: true }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "Segment 1", exact: true })).toBeVisible();
  });
});
