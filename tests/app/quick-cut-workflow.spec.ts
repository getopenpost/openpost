import path from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  await page.screenshot({ path: testInfo.outputPath("qct-rejected-restored.png") });
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
  await page.screenshot({ path: testInfo.outputPath("qct-cold-restored.png") });
  await page
    .locator("summary")
    .filter({ hasText: /^Segment files$/ })
    .click();
  await page.getByRole("button", { name: "Segment files", exact: true }).click();
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
  await page.screenshot({ path: testInfo.outputPath("qci-rejected-import.png") });
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
  await expect(
    page.getByText("Keep only this selection, or remove it from your edit.", { exact: true }),
  ).toBeVisible();
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
  await page.screenshot({ path: testInfo.outputPath("qcr-final-short-part.png") });
  await preview.click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const stopped = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await page.waitForTimeout(350);
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
  await page.screenshot({ path: "test-results/f007-cold-source-name.png" });
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

for (const scheme of ["light", "dark"] as const) {
  test(`Quick Cut keeps cuts readable on desktop and phones in ${scheme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => {
      localStorage.setItem("mode-watcher-mode", mode);
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined });
    }, scheme);
    await page.goto("/quick-cut");
    await expect(page.getByRole("button", { name: "Open videos", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`start-${scheme}.png`) });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open videos", exact: true }).click();
    await (await chooser).setFiles(fixture);
    await expect(page.locator("video")).toBeVisible();
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);
    await seek(page, 1);
    await page.getByRole("button", { name: /^Mark in/ }).click();
    await seek(page, 5);
    await page.getByRole("button", { name: /^Mark out/ }).click();
    await page.getByRole("button", { name: "Keep selection", exact: true }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("video")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Mark in 1" })).toBeVisible();
      const markIn = page.getByRole("button", { name: /^Mark in/ });
      const toolbar = page.getByRole("toolbar").filter({ has: markIn });
      await toolbar.scrollIntoViewIfNeeded();
      const toolbarBounds = await toolbar.boundingBox();
      const buttonBounds = await markIn.boundingBox();
      expect(toolbarBounds!.height).toBeGreaterThanOrEqual(buttonBounds!.height);
      const visibleToolbar = await toolbar.locator("..").boundingBox();
      expect(visibleToolbar!.height).toBeGreaterThanOrEqual(buttonBounds!.height);
      const range = page.getByText("00:01.00 → 00:05.00", { exact: true });
      const bounds = await range.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.height).toBeLessThan(20);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`workspace-${scheme}-${width}.png`),
        fullPage: true,
      });
      await page.getByRole("textbox", { name: "Mark out 1" }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`cuts-${scheme}-${width}.png`),
        fullPage: true,
      });
    }
  });
}

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
        { kind: "set", target: "timeline:segments", path: "/timeline/segments", value: priorCuts },
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
  for (const { width, scheme } of [
    { width: 1280, scheme: "light" },
    { width: 1280, scheme: "dark" },
    { width: 390, scheme: "light" },
    { width: 320, scheme: "dark" },
  ] as const) {
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: testInfo.outputPath(`qsp-restored-${width}-${scheme}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("group", { name: "Editing tools", exact: true })
        .getByRole("button", { name: "Cuts", exact: true }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "Segment 1", exact: true })).toBeVisible();
  }
});
