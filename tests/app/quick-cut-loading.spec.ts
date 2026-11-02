import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  for (const width of [1280, 390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await refresh.scrollIntoViewIfNeeded();
      await refresh.focus();
      await expect(refresh).toBeFocused();
      expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`recovery-${width}-${colorScheme}.png`) });
    }
  }
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
    // Observe the released continuation long enough for this small local source to be inspected.
    await page.waitForTimeout(1_000);
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
