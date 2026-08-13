import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("legacy Video Studio URLs redirect to the OpenPost Video Editor", async ({
  page,
}) => {
  await page.goto("/video-studio/new?legacy-route=1");
  await expect(page).toHaveURL(/\/video-editor\/new\?legacy-route=1$/);
});

async function syntheticVideo(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    const stream = canvas.captureStream(30);
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) throw new Error("No WebM recorder is available");
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(100);
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const draw = (now: number) => {
        const progress = Math.min(1, (now - started) / 1_200);
        const gradient = context.createLinearGradient(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        gradient.addColorStop(0, "#fb923c");
        gradient.addColorStop(1, "#7c3aed");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.font = "700 28px sans-serif";
        context.fillText("OpenPost", 82 + progress * 18, 98);
        if (progress < 1) requestAnimationFrame(draw);
        else resolve();
      };
      requestAnimationFrame(draw);
    });
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    stream.getTracks().forEach((track) => track.stop());
    return Array.from(
      new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer()),
    );
  });
  return Buffer.from(bytes);
}

async function readLocalVideoProject(
  page: Page,
  projectID: string,
): Promise<Record<string, unknown>> {
  return await page.evaluate(async (id) => {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const open = indexedDB.open("openpost-video-editor");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("projects");
        const get = tx.objectStore("projects").get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () =>
          resolve(structuredClone(get.result) as Record<string, unknown>);
        tx.oncomplete = () => database.close();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
    });
  }, projectID);
}

async function readLocalVideoProjectRevisions(
  page: Page,
  projectID: string,
): Promise<Record<string, unknown>[]> {
  return await page.evaluate(async (id) => {
    return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const open = indexedDB.open("openpost-video-editor");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("project-revisions");
        const getAll = tx.objectStore("project-revisions").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () =>
          resolve(
            getAll.result
              .filter((revision) => revision.project_id === id)
              .map((revision) => structuredClone(revision)),
          );
        tx.oncomplete = () => database.close();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
    });
  }, projectID);
}

function syntheticVideoWithAudio(): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "openpost-video-editor-e2e-"));
  const filename = join(directory, "analysis.webm");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x18181b:s=320x180:r=24:d=1.5",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.18*sin(2*PI*180*t)*between(t\\,0.2\\,0.9):s=48000:d=1.5",
      "-shortest",
      "-c:v",
      "libvpx",
      "-b:v",
      "200k",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      filename,
    ]);
    return readFileSync(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function syntheticBlackVideo(): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "openpost-text-parity-e2e-"));
  const filename = join(directory, "black.webm");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x180:r=24:d=1.2",
      "-c:v",
      "libvpx",
      "-b:v",
      "120k",
      filename,
    ]);
    return readFileSync(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function brightPixelCount(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (
      data[index]! >= 220 &&
      data[index + 1]! >= 220 &&
      data[index + 2]! >= 220
    ) {
      count += 1;
    }
  }
  return count;
}

function syntheticAudio(): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "openpost-audio-e2e-"));
  const filename = join(directory, "microphone.webm");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=180:sample_rate=48000:duration=1",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      filename,
    ]);
    return readFileSync(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("guest chooses Quick Cut and can move into the Full editor", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/video-editor/new");
  await expect(
    page.getByRole("heading", { name: "Choose how you want to edit" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Quick cut/ }).click();
  const video = await syntheticVideo(page);
  await page.locator("#video-editor-new-files").setInputFiles({
    name: "quick-cut-e2e.webm",
    mimeType: "video/webm",
    buffer: video,
  });

  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await expect(
    page.getByRole("heading", { name: "Source timeline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Kept sections" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Set in" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fast export" }).last(),
  ).toBeEnabled({ timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: "Fast export section 1" }),
  ).toBeEnabled();
  const [quickCutDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Fast export" }).last().click(),
  ]);
  expect(quickCutDownload.suggestedFilename()).toBe(
    "quick-cut-e2e-quick-cut.webm",
  );
  const quickCutStream = await quickCutDownload.createReadStream();
  const quickCutChunks: Buffer[] = [];
  for await (const chunk of quickCutStream) {
    quickCutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const quickCutBytes = Buffer.concat(quickCutChunks);
  expect(quickCutBytes.byteLength).toBeGreaterThan(1_000);
  expect([...quickCutBytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

  const sourceTimeline = page.getByRole("slider", {
    name: "Timeline",
    exact: true,
  });
  for (let step = 0; step < 4; step += 1)
    await sourceTimeline.press("ArrowRight");
  const sourceClock = page.getByText(/^Source \d{2}:\d{2}:\d{2}:\d{2}$/);
  const chosenSourceFrame = await sourceClock.textContent();
  if (!chosenSourceFrame)
    throw new Error("Quick Cut source clock is unavailable");
  await page.getByRole("button", { name: "Set in" }).click();
  await expect(sourceClock).toHaveText(chosenSourceFrame);
  await expect(
    page.getByText(/^00:00:00:00 \/ \d{2}:\d{2}:\d{2}:\d{2}$/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "Kept sections" })
      .getByText(`${chosenSourceFrame.replace("Source ", "")} →`, {
        exact: false,
      }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open Full editor" }).click();
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("guest imports, edits, autosaves, restores, and exports a local video", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });
  const browserErrors: string[] = [];
  const unexpectedWrites: string[] = [];
  page.on("pageerror", (error) =>
    browserErrors.push(error.stack ?? error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.url().includes("/api/v1/video-editor/projects")
    ) {
      unexpectedWrites.push(`${request.method()} ${request.url()}`);
    }
  });
  const stockPng = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fb923c";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  });
  const stockAsset = {
    external_id: "photo-1",
    kind: "photo",
    title: "Warm desk",
    width: 320,
    height: 180,
    thumbnail_url:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%23fb923c'/%3E%3C/svg%3E",
    source_url: "https://example.test/photo-1",
    creator_name: "OpenPost Test",
    creator_url: "https://example.test/creator",
    provider: "pexels",
    provider_url: "https://www.pexels.com",
    attribution_text: "OpenPost Test on Pexels",
    license_name: "Pexels License",
    license_url: "https://www.pexels.com/license/",
  };
  await page.route("**/api/v1/stock-media/providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        providers: [
          {
            key: "pexels",
            name: "Pexels",
            provider_url: "https://www.pexels.com",
            photos: true,
            videos: true,
            audio: false,
            attribution: "Photos provided by Pexels",
          },
        ],
      }),
    });
  });
  await page.route("**/api/v1/stock-media/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [stockAsset],
        page: 1,
        per_page: 24,
        total: 1,
        has_more: false,
        provider: "pexels",
        provider_url: "https://www.pexels.com",
      }),
    });
  });
  await page.route("**/api/v1/stock-media/selections", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...stockAsset,
        download_url: stockPng,
        mime_type: "image/png",
      }),
    });
  });

  await page.goto("/video-editor");
  await expect(
    page.getByRole("heading", { name: "Make the social cut here." }),
  ).toBeVisible();
  await expect(page.getByText(/Your edits stay in this browser/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const video = await syntheticVideo(page);
  await page.locator("#video-editor-import").setInputFiles({
    name: "openpost-e2e.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByText("openpost-e2e.webm").first()).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Timeline", exact: true }),
  ).toHaveCount(1);
  const familyTabsBounds = await page
    .locator("[data-video-editor-family-tabs]")
    .boundingBox();
  const subtabsBounds = await page
    .locator("[data-video-editor-subtabs]")
    .boundingBox();
  const toolContentBounds = await page
    .locator("[data-video-editor-tool-content]")
    .boundingBox();
  if (!familyTabsBounds || !subtabsBounds || !toolContentBounds) {
    throw new Error(
      "Full editor tool panel did not render its aligned desktop regions",
    );
  }
  expect(Math.abs(familyTabsBounds.x - subtabsBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(subtabsBounds.x - toolContentBounds.x)).toBeLessThanOrEqual(
    1,
  );
  expect(subtabsBounds.y - (familyTabsBounds.y + familyTabsBounds.height)).toBe(
    12,
  );
  expect(toolContentBounds.y - (subtabsBounds.y + subtabsBounds.height)).toBe(
    12,
  );
  const clipInspector = page.getByRole("complementary", {
    name: "Properties",
  });
  await expect(
    clipInspector.getByRole("button", { name: "Video", exact: true }),
  ).toBeVisible();
  await expect(
    clipInspector.getByRole("button", { name: "Audio", exact: true }),
  ).toBeVisible();
  await expect(
    clipInspector.getByRole("button", { name: "Speed", exact: true }),
  ).toBeVisible();
  await expect(
    clipInspector.getByRole("button", { name: "Adjustments", exact: true }),
  ).toBeVisible();
  await clipInspector
    .getByRole("button", { name: "Audio", exact: true })
    .click();
  await expect(
    clipInspector.getByRole("slider", { name: "Volume", exact: true }),
  ).toBeVisible();
  await expect(
    clipInspector.getByRole("slider", {
      name: "Horizontal position",
      exact: true,
    }),
  ).toBeHidden();
  await clipInspector
    .getByRole("button", { name: "Video", exact: true })
    .click();
  const previewEngine = page.locator("[data-preview-engine-ready]").first();
  await expect(previewEngine).toHaveAttribute(
    "data-preview-engine-ready",
    "true",
    { timeout: 15_000 },
  );
  expect(
    Number(await previewEngine.getAttribute("data-preview-peak-decoders")),
  ).toBeLessThanOrEqual(3);
  await page.getByRole("button", { name: "Play" }).first().click();
  await expect
    .poll(() => previewEngine.getAttribute("data-preview-quality"))
    .toBe("adaptive");
  await page.getByRole("button", { name: "Pause" }).first().click();
  await expect
    .poll(() => previewEngine.getAttribute("data-preview-quality"))
    .toBe("full");
  await page
    .getByRole("slider", { name: "Timeline", exact: true })
    .press("Home");

  const positionX = page.getByRole("slider", {
    name: "Horizontal position",
  });
  const positionBeforeClick = await positionX.getAttribute("aria-valuenow");
  const previewClip = page.getByRole("button", { name: /^Clip clip_/ });
  const previewBounds = await previewClip.boundingBox();
  if (!previewBounds) throw new Error("Preview clip has no bounds");
  await page.mouse.click(previewBounds.x + 16, previewBounds.y + 16);
  await expect(positionX).toHaveAttribute(
    "aria-valuenow",
    positionBeforeClick ?? "0.5",
  );

  const clipButton = page
    .getByRole("button", { name: "openpost-e2e.webm" })
    .first();
  const playbackClock = page.getByText(/^0:00:00 of \d+:\d{2}:\d{2}$/).first();
  const timeBeforeTrim = await playbackClock.textContent();
  await page
    .getByRole("button", { name: "Trim clip end" })
    .press("Shift+ArrowLeft");
  await expect
    .poll(async () => playbackClock.textContent())
    .not.toBe(timeBeforeTrim);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => playbackClock.textContent())
    .toBe(timeBeforeTrim);

  const playhead = page.getByRole("slider", {
    name: "Timeline",
    exact: true,
  });
  await playhead.press("Home");
  await playhead.press("ArrowRight");
  await expect(playhead).not.toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: /^Split/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Timeline" })
      .getByRole("group", { name: "openpost-e2e.webm" }),
  ).toHaveCount(2);
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: "openpost-e2e.webm" })
    .first()
    .click();
  await page.keyboard.press("Delete");
  await expect(
    page.getByRole("region", { name: "Timeline" }).getByRole("group", {
      name: "Gap",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Gap duration" }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(
    page
      .getByRole("region", { name: "Timeline" })
      .getByRole("group", { name: "openpost-e2e.webm" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Add marker" }).click();
  const markerName = page.getByRole("textbox", { name: "Rename marker" });
  await expect(markerName).toHaveValue("Marker 1");
  await markerName.fill("Beat change");
  await markerName.press("Tab");
  await expect(
    page
      .getByRole("region", { name: "Timeline" })
      .getByRole("button", { name: /Beat change/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Text" }).click();
  await page.getByRole("button", { name: "Add title" }).click();
  await expect(
    page.locator('[data-video-editor-track-kind="visual"]'),
  ).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("Launch day");
  await expect(page.getByText("Launch day").first()).toBeVisible();
  await page.getByRole("button", { name: "Position and size" }).click();
  const overlayDuration = page.getByRole("spinbutton", {
    name: "Duration (seconds)",
  });
  const overlayDurationBefore = await overlayDuration.inputValue();
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: "Adjust item end" })
    .press("Shift+ArrowLeft");
  await expect
    .poll(async () => overlayDuration.inputValue())
    .not.toBe(overlayDurationBefore);

  await page.getByRole("button", { name: "Elements" }).click();
  await page.getByRole("button", { name: "Highlight box" }).click();
  await expect(page.getByText("annotation overlay")).toBeVisible();
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  const visualTimeline = page.getByRole("region", { name: "Timeline" });
  const layeredItems = ["Launch day", "Highlight box", "Ellipse", "Arrow"].map(
    (name) => visualTimeline.getByRole("button", { name, exact: true }),
  );
  for (const item of layeredItems) await expect(item).toBeVisible();
  const layeredBounds = await Promise.all(
    layeredItems.map(async (item) => {
      const bounds = await item.boundingBox();
      if (!bounds) throw new Error("Layered timeline item has no bounds");
      return bounds;
    }),
  );
  expect(
    new Set(layeredBounds.map((bounds) => Math.round(bounds.y))).size,
  ).toBe(layeredItems.length);
  await layeredItems[0]!.click();
  await expect(
    page.getByRole("textbox", { name: "Text", exact: true }),
  ).toHaveValue("Launch day");
  await layeredItems[1]!.click();
  await page.getByRole("button", { name: "Position and size" }).click();
  await page.getByRole("slider", { name: "Rotation" }).press("ArrowRight");
  await page.getByRole("checkbox", { name: "Shared across formats" }).uncheck();
  const overlayPosition = page.getByRole("slider", {
    name: "Horizontal position",
  });
  const overlayVisibility = page.getByRole("checkbox", {
    name: "Show overlay",
  });
  await overlayPosition.press("End");
  await expect(overlayPosition).toHaveAttribute("aria-valuenow", "1");
  await overlayVisibility.uncheck();
  for (const format of [
    "Feed portrait · 4:5",
    "Square · 1:1",
    "Landscape · 16:9",
  ]) {
    await page.getByRole("button", { name: "Format", exact: true }).click();
    await page.getByRole("option", { name: format }).click();
    await expect(overlayPosition).toHaveAttribute("aria-valuenow", "0.5");
    await expect(overlayVisibility).toBeChecked();
  }
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("option", { name: "Portrait · 9:16" }).click();
  await expect(overlayPosition).toHaveAttribute("aria-valuenow", "1");
  await expect(overlayVisibility).not.toBeChecked();
  await overlayVisibility.check();

  await page.getByRole("button", { name: "Media", exact: true }).click();
  await page.getByRole("button", { name: "Stock", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search stock photos and videos" })
    .fill("desk");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("By OpenPost Test")).toBeVisible();
  await page.getByRole("button", { name: "Use this item" }).click();
  await expect(
    page.getByLabel("Stock", { exact: true }).getByText("pexels-photo-1.jpg"),
  ).toBeVisible();
  await expect(page.getByText("OpenPost Test on Pexels")).toBeVisible();
  await expect(
    page.locator('[data-video-editor-track-kind="visual"]'),
  ).toHaveCount(2);

  await page.getByRole("button", { name: "Captions" }).click();
  await page.getByRole("button", { name: "Add caption" }).click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("Corrected local caption");
  await expect(page.getByText("Corrected local caption").first()).toBeVisible();
  await page.getByRole("button", { name: "Find silent sections" }).click();
  await expect(
    page.getByRole("heading", { name: "Download a local analysis model?" }),
  ).toBeVisible();
  await expect(page.getByText("Voice activity detection")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close" })
    .first()
    .click();

  for (const format of [
    "Portrait · 9:16",
    "Feed portrait · 4:5",
    "Square · 1:1",
    "Landscape · 16:9",
  ]) {
    await page.getByRole("button", { name: "Format", exact: true }).click();
    await page.getByRole("option", { name: format }).click();
  }

  await expect(page.getByText("Saved locally")).toBeVisible({
    timeout: 10_000,
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByText("Launch day").first()).toBeVisible();
  await expect(page.getByText("Corrected local caption").first()).toBeVisible();
  await page.getByRole("button", { name: "Captions" }).click();
  const [srtDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download SRT" }).click(),
  ]);
  const [vttDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download WebVTT" }).click(),
  ]);
  expect(srtDownload.suggestedFilename()).toBe("openpost-e2e.srt");
  expect(vttDownload.suggestedFilename()).toBe("openpost-e2e.vtt");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByText("MP4 · H.264/AAC").click();
  await page.getByRole("option", { name: /WebM · VP9 or VP8\/Opus/ }).click();
  await page.getByRole("button", { name: "Start export" }).click();
  await expect(page.getByText(/Export ready/)).toBeVisible({ timeout: 60_000 });

  expect(unexpectedWrites).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("local version history restores both directions and survives reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/video-editor");
  await page.locator("#video-editor-import").setInputFiles({
    name: "version-history.webm",
    mimeType: "video/webm",
    buffer: await syntheticVideo(page),
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);

  const projectName = page.getByRole("textbox", { name: "Project name" });
  await projectName.fill("Checkpoint title");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Version history" }).click();
  await page
    .getByRole("textbox", { name: "Checkpoint name" })
    .fill("Before title rewrite");
  await page.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(
    page.getByRole("button", { name: /Before title rewrite/ }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Version history" })
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close", exact: true })
    .click();

  await projectName.fill("Current title");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Version history" }).click();
  await expect(page.getByText("Saved in this browser").first()).toBeVisible();
  await page.getByRole("button", { name: /Before title rewrite/ }).click();
  await expect(page.getByText("Title changed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore this version" }).click();
  const confirmation = page
    .getByRole("dialog")
    .filter({ hasText: "Restore this version?" });
  await expect(confirmation).toContainText(
    "save your exact current browser version as a local restore point",
  );
  await confirmation.getByRole("button", { name: "Restore version" }).click();
  await expect(projectName).toHaveValue("Checkpoint title");

  await page.getByRole("button", { name: "Version history" }).click();
  const restorePoint = page.getByRole("button", { name: /Before restore/ });
  await expect(restorePoint).toBeVisible();
  await restorePoint.click();
  await expect(page.getByText("Title changed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore this version" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Restore this version?" })
    .getByRole("button", { name: "Restore version" })
    .click();
  await expect(projectName).toHaveValue("Current title");

  await page.reload();
  await expect(projectName).toHaveValue("Current title");
});

test("reorder-only local video versions stay previewable and restore both orders", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const video = await syntheticVideo(page);
  await page.goto("/video-editor");
  await page.locator("#video-editor-import").setInputFiles([
    { name: "order-one.webm", mimeType: "video/webm", buffer: video },
    { name: "order-two.webm", mimeType: "video/webm", buffer: video },
  ]);
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const projectID = page.url().split("/").at(-1)!;

  await page.getByRole("button", { name: "Version history" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await history
    .getByRole("textbox", { name: "Checkpoint name" })
    .fill("Original timeline order");
  await history.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(
    history.getByRole("button", { name: /Original timeline order/ }),
  ).toBeVisible();
  await history
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close", exact: true })
    .click();

  const orders = await page.evaluate(async (id) => {
    return await new Promise<{ original: string[]; reordered: string[] }>(
      (resolve, reject) => {
        const open = indexedDB.open("openpost-video-editor");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          let result: { original: string[]; reordered: string[] } | undefined;
          const tx = database.transaction(
            ["projects", "project-revisions"],
            "readwrite",
          );
          const projects = tx.objectStore("projects");
          const revisions = tx.objectStore("project-revisions");
          const get = projects.get(id);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            const project = get.result;
            const original = project.document.primary_sequence.map(
              (item: { id: string }) => item.id,
            );
            project.document.primary_sequence.reverse();
            project.revision += 1;
            project.updated_at = new Date().toISOString();
            project.last_opened_at = project.updated_at;
            projects.put(project);
            revisions.put({
              id: `${id}:${project.revision}`,
              project_id: id,
              revision: project.revision,
              kind: "autosave",
              created_at: project.updated_at,
              snapshot: {
                snapshot_version: 1,
                document: structuredClone(project.document),
                cover_source_id: project.cover_source_id,
                cloud_cover_preview_media_id:
                  project.cloud_cover_preview_media_id ?? "",
              },
            });
            result = {
              original,
              reordered: project.document.primary_sequence.map(
                (item: { id: string }) => item.id,
              ),
            };
          };
          tx.oncomplete = () => {
            database.close();
            if (result) resolve(result);
            else
              reject(new Error("The reordered local project was not written."));
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };
      },
    );
  }, projectID);
  expect(orders.original).toHaveLength(2);
  expect(orders.reordered).toEqual([...orders.original].reverse());
  await page.reload();

  await page.getByRole("button", { name: "Version history" }).click();
  await page.getByRole("button", { name: /Original timeline order/ }).click();
  await expect(
    page.getByText(/Main timeline: 0 added, 0 removed, 2 changed/),
  ).toBeVisible();
  const restore = page.getByRole("button", { name: "Restore this version" });
  await expect(restore).toBeEnabled();
  await restore.click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Restore this version?" })
    .getByRole("button", { name: "Restore version" })
    .click();
  await expect(history).not.toBeVisible();
  expect(
    await page.evaluate(async (id) => {
      return await new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("openpost-video-editor");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result
            .transaction("projects")
            .objectStore("projects")
            .get(id);
          get.onerror = () => reject(get.error);
          get.onsuccess = () =>
            resolve(
              get.result.document.primary_sequence.map(
                (item: { id: string }) => item.id,
              ),
            );
        };
      });
    }, projectID),
  ).toEqual(orders.original);

  await page.getByRole("button", { name: "Version history" }).click();
  await page
    .getByRole("button", { name: /Before restore/ })
    .first()
    .click();
  await expect(
    page.getByText(/Main timeline: 0 added, 0 removed, 2 changed/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore this version" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Restore this version?" })
    .getByRole("button", { name: "Restore version" })
    .click();
  await expect(history).not.toBeVisible();
  expect(
    await page.evaluate(async (id) => {
      return await new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("openpost-video-editor");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result
            .transaction("projects")
            .objectStore("projects")
            .get(id);
          get.onerror = () => reject(get.error);
          get.onsuccess = () =>
            resolve(
              get.result.document.primary_sequence.map(
                (item: { id: string }) => item.id,
              ),
            );
        };
      });
    }, projectID),
  ).toEqual(orders.reordered);
});

test("local autosave conflict preserves stale-tab work as a copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/video-editor");
  await page.locator("#video-editor-import").setInputFiles({
    name: "version-conflict.webm",
    mimeType: "video/webm",
    buffer: await syntheticVideo(page),
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  const originalURL = page.url();
  const otherTab = await page.context().newPage();
  await otherTab.goto(originalURL);
  const otherName = otherTab.getByRole("textbox", { name: "Project name" });
  await otherName.fill("Newer tab title");
  await expect(
    otherTab.getByText("Saved locally", { exact: true }),
  ).toBeVisible({
    timeout: 15_000,
  });

  const staleName = page.getByRole("textbox", { name: "Project name" });
  await staleName.fill("Preserve this stale tab");
  await expect(
    page.getByRole("heading", {
      name: "This project changed in another tab",
    }),
  ).toBeVisible({ timeout: 15_000 });
  const conflict = page
    .getByRole("dialog")
    .filter({ hasText: "This project changed in another tab" });
  await expect(conflict).toContainText(
    "Your unsaved work remains in this tab until you choose an option.",
  );
  await expect(
    conflict.getByRole("button", { name: "Reload latest browser version" }),
  ).toBeVisible();
  await conflict
    .getByRole("button", { name: "Save local edit as a copy" })
    .click();
  await expect(page).not.toHaveURL(originalURL);
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "Preserve this stale tab",
  );
  await otherTab.close();
});

test("checkpoint partial failures preserve the committed local head and surface later local CAS races", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `video-checkpoint-partial-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Video checkpoint partial failure",
  )) as { id: string; name: string };
  await authenticatePage(page, auth.token);
  await page.addInitScript((selectedWorkspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(selectedWorkspace),
    );
  }, workspace);

  await page.goto("/video-editor");
  await page.locator("#video-editor-import").setInputFiles({
    name: "checkpoint-partial.webm",
    mimeType: "video/webm",
    buffer: await syntheticVideo(page),
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  const projectID = page.url().split("/").at(-1)!;
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.evaluate(async (id) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("openpost-video-editor");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("projects", "readwrite");
        const store = tx.objectStore("projects");
        const get = store.get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const project = get.result;
          project.cloud_project_id = "cloud-checkpoint-partial-e2e";
          project.cloud_revision = 4;
          project.cloud_source_map = Object.fromEntries(
            Object.keys(project.document.sources).map((sourceID) => [
              sourceID,
              `cloud-media-${sourceID}`,
            ]),
          );
          project.state = "cloud";
          store.put(project);
        };
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
    });
  }, projectID);

  await page.route("**/api/v1/video-editor/sync-plan", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        reused: [],
        missing_source_ids: [],
        additional_bytes: 0,
        storage: {
          used_bytes: 0,
          limit_bytes: null,
          remaining_bytes: null,
        },
        allowed: true,
        reason: null,
      }),
    });
  });
  await page.route(
    "**/api/v1/video-editor/projects/cloud-checkpoint-partial-e2e/revisions**",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ revisions: [], next_cursor: "" }),
      });
    },
  );
  await page.route(
    "**/api/v1/video-editor/projects/cloud-checkpoint-partial-e2e",
    async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          title: "Internal Server Error",
          status: 500,
          detail: "Cloud sync failed after local checkpoint.",
        }),
      });
    },
  );
  await page.reload();

  await page.getByRole("button", { name: "Version history" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await history
    .getByRole("textbox", { name: "Checkpoint name" })
    .fill("Committed before cloud failure");
  await history.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(
    page.getByText("Cloud sync failed after local checkpoint.", {
      exact: true,
    }),
  ).toBeVisible();

  const projectAfterCheckpoint = await readLocalVideoProject(page, projectID);
  const revisions = await readLocalVideoProjectRevisions(page, projectID);
  const checkpoint = revisions.find(
    (revision) =>
      revision.kind === "checkpoint" &&
      revision.name === "Committed before cloud failure",
  );
  expect(checkpoint).toBeTruthy();
  expect(projectAfterCheckpoint.revision).toBe(checkpoint?.revision);

  await history
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Project name" })
    .fill("Local edit after cloud failure");
  await expect
    .poll(async () => {
      const project = await readLocalVideoProject(page, projectID);
      return {
        revision: project.revision,
        title: (project.document as { title?: string }).title,
      };
    })
    .toEqual({
      revision: Number(projectAfterCheckpoint.revision) + 1,
      title: "Local edit after cloud failure",
    });

  await page.evaluate(async (id) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("openpost-video-editor");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("projects", "readwrite");
        const store = tx.objectStore("projects");
        const get = store.get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const project = get.result;
          project.revision += 1;
          project.updated_at = new Date().toISOString();
          store.put(project);
        };
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
    });
  }, projectID);

  await page.getByRole("button", { name: "Version history" }).click();
  await history
    .getByRole("textbox", { name: "Checkpoint name" })
    .fill("Stale local checkpoint");
  await history.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(
    page.getByRole("heading", {
      name: "This project changed in another tab",
    }),
  ).toBeVisible();
});

test("cloud covers survive sync, rename, reopen, and a cover-only restore", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const auth = await registerUser(request, `video-cover-${unique}@example.com`);
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Video Cover E2E",
  )) as { id: string; name: string };
  await authenticatePage(page, auth.token);
  await page.addInitScript((selectedWorkspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(selectedWorkspace),
    );
  }, workspace);

  await page.goto("/video-editor");
  await page.locator("#video-editor-import").setInputFiles({
    name: "cloud-cover.webm",
    mimeType: "video/webm",
    buffer: syntheticVideoWithAudio(),
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  const firstLocalProjectID = page.url().split("/").at(-1)!;
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const saveToOpenPost = page.getByRole("button", {
    name: "Save to OpenPost",
  });
  await saveToOpenPost.click();
  const cloudDialog = page.getByRole("dialog", {
    name: "Save project to OpenPost",
  });
  await cloudDialog.getByRole("button", { name: "Sync and save" }).click();
  await expect(cloudDialog).not.toBeVisible({ timeout: 30_000 });

  await expect
    .poll(
      async () =>
        String(
          (await readLocalVideoProject(page, firstLocalProjectID))
            .cloud_cover_preview_media_id ?? "",
        ),
      { timeout: 30_000 },
    )
    .not.toBe("");
  const firstLocalProject = await readLocalVideoProject(
    page,
    firstLocalProjectID,
  );
  const cloudProjectID = String(firstLocalProject.cloud_project_id);
  const canonicalCoverMediaID = String(
    firstLocalProject.cloud_cover_preview_media_id,
  );
  expect(cloudProjectID).not.toBe("");
  expect(canonicalCoverMediaID).not.toBe("");

  const projectName = page.getByRole("textbox", { name: "Project name" });
  await projectName.fill("Synced cover project");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await saveToOpenPost.click();
  await cloudDialog.getByRole("button", { name: "Sync and save" }).click();
  await expect(cloudDialog).not.toBeVisible({ timeout: 30_000 });

  await page.goto("/editors");
  const projectCard = page.locator(
    `a[href="/video-editor?cloud=${cloudProjectID}"]`,
  );
  await expect(projectCard).toContainText("Synced cover project");
  await projectCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const renameDialog = page.getByRole("dialog", {
    name: "Rename video project",
  });
  await renameDialog
    .getByRole("textbox", { name: "Project name" })
    .fill("Renamed cover project");
  await renameDialog.getByRole("button", { name: "Save" }).click();
  await expect(renameDialog).not.toBeVisible();

  const getCloudProject = async () => {
    const response = await request.get(
      `/api/v1/video-editor/projects/${cloudProjectID}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!response.ok()) {
      throw new Error(
        `cloud project request failed with ${response.status()}: ${await response.text()}`,
      );
    }
    return (await response.json()) as {
      id: string;
      revision: number;
      cover_preview_media_id?: string;
      document: Record<string, unknown>;
    };
  };
  const renamed = await getCloudProject();
  expect(renamed.document.title).toBe("Renamed cover project");
  expect(renamed.cover_preview_media_id).toBe(canonicalCoverMediaID);

  const checkpoint = await request.post(
    `/api/v1/video-editor/projects/${cloudProjectID}/checkpoints`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: "Covered cloud version",
        expected_revision: renamed.revision,
      },
    },
  );
  expect(checkpoint.ok(), await checkpoint.text()).toBe(true);
  const clearCover = await request.patch(
    `/api/v1/video-editor/projects/${cloudProjectID}`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        expected_revision: renamed.revision,
        cover_preview_media_id: "",
        document: renamed.document,
      },
    },
  );
  expect(clearCover.ok(), await clearCover.text()).toBe(true);

  await page.goto(`/video-editor?cloud=${cloudProjectID}`);
  await expect(page).toHaveURL(/\/video-editor\/local_video_/, {
    timeout: 30_000,
  });
  const reopenedLocalProjectID = page.url().split("/").at(-1)!;
  expect(
    (await readLocalVideoProject(page, reopenedLocalProjectID))
      .cloud_cover_preview_media_id,
  ).toBeUndefined();

  await page.getByRole("button", { name: "Version history" }).click();
  await page.getByRole("button", { name: /Covered cloud version/ }).click();
  await expect(
    page.getByText("Cover preview changed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Title changed", { exact: true })).toHaveCount(0);
  const restore = page.getByRole("button", { name: "Restore this version" });
  await expect(restore).toBeEnabled();
  await restore.click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Restore this version?" })
    .getByRole("button", { name: "Restore version" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Version history" }),
  ).not.toBeVisible();

  await expect
    .poll(async () => (await getCloudProject()).cover_preview_media_id)
    .toBe(canonicalCoverMediaID);
  expect(
    (await readLocalVideoProject(page, reopenedLocalProjectID))
      .cloud_cover_preview_media_id,
  ).toBe(canonicalCoverMediaID);
});

test("cloud restore recovers from local CAS races without retrying the server restore", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/video-editor");
  await page.locator("#video-editor-import").setInputFiles({
    name: "cloud-version.webm",
    mimeType: "video/webm",
    buffer: await syntheticVideo(page),
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  const projectID = page.url().split("/").at(-1)!;
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const currentDocument = await page.evaluate(async (id) => {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const open = indexedDB.open("openpost-video-editor");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("projects", "readwrite");
        const store = tx.objectStore("projects");
        const get = store.get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const project = get.result;
          project.cloud_project_id = "cloud-version-e2e";
          project.cloud_revision = 5;
          project.cloud_cover_preview_media_id = "cloud-current-cover";
          project.state = "cloud";
          store.put(project);
          resolve(structuredClone(project.document));
        };
        tx.oncomplete = () => database.close();
      };
    });
  }, projectID);
  await page.reload();

  const advanceBrowserHead = async (title: string): Promise<void> => {
    await page.evaluate(
      async ({ id, nextTitle }) => {
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("openpost-video-editor");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const tx = database.transaction("projects", "readwrite");
            const store = tx.objectStore("projects");
            const get = store.get(id);
            get.onerror = () => reject(get.error);
            get.onsuccess = () => {
              const project = get.result;
              project.revision += 1;
              project.document.title = nextTitle;
              project.updated_at = new Date().toISOString();
              store.put(project);
            };
            tx.oncomplete = () => {
              database.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          };
        });
      },
      { id: projectID, nextTitle: title },
    );
  };

  let successfulRestore = false;
  let previewRequests = 0;
  let restoreRequests = 0;
  let cloudHeadRequests = 0;
  await page.route(
    "**/api/v1/video-editor/projects/cloud-version-e2e",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.abort();
        return;
      }
      cloudHeadRequests += 1;
      if (cloudHeadRequests === 1) {
        await advanceBrowserHead("Browser head raced again");
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "cloud-version-e2e",
          workspace_id: "workspace-e2e",
          created_by_id: "user-e2e",
          revision: 6,
          can_edit: true,
          duration_ms: 1200,
          created_at: "2026-08-09T11:00:00Z",
          updated_at: "2026-08-09T12:05:00Z",
          cover_preview_media_id: "cloud-checkpoint-cover",
          document: { ...currentDocument, title: "Cloud checkpoint title" },
        }),
      });
    },
  );
  await page.route(
    "**/api/v1/video-editor/projects/cloud-version-e2e/revisions**",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (request.method() === "GET" && path.endsWith("/revisions")) {
        const cursor = url.searchParams.get("cursor") ?? "";
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            revisions: cursor
              ? [
                  {
                    id: "cloud-older-checkpoint",
                    revision: 1,
                    kind: "checkpoint",
                    name: "Oldest named cloud version",
                    created_at: "2026-08-01T12:00:00Z",
                    actor: { name: "Teammate", is_current_user: false },
                  },
                ]
              : [
                  {
                    id: "cloud-checkpoint",
                    revision: successfulRestore ? 6 : 4,
                    kind: "checkpoint",
                    name: "Cloud checkpoint",
                    created_at: "2026-08-09T12:00:00Z",
                    actor: { name: "Teammate", is_current_user: false },
                  },
                ],
            next_cursor: cursor ? "" : "older-cloud-page",
          }),
        });
        return;
      }
      if (
        request.method() === "GET" &&
        path.endsWith("/revisions/cloud-checkpoint")
      ) {
        previewRequests += 1;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            summary: {
              id: "cloud-checkpoint",
              revision: successfulRestore ? 6 : 4,
              kind: "checkpoint",
              name: "Cloud checkpoint",
              created_at: "2026-08-09T12:00:00Z",
              actor: { name: "Teammate", is_current_user: false },
            },
            cover_preview_media_id: "cloud-checkpoint-cover",
            document: {
              ...currentDocument,
              title: successfulRestore
                ? "Newer cloud title"
                : "Cloud checkpoint title",
            },
          }),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path.endsWith("/revisions/cloud-checkpoint/restore")
      ) {
        restoreRequests += 1;
        if (successfulRestore) {
          await route.fulfill({
            status: 409,
            contentType: "application/problem+json",
            body: JSON.stringify({
              detail: "The cloud project changed elsewhere.",
            }),
          });
          return;
        }
        successfulRestore = true;
        await advanceBrowserHead("Browser head after cloud restore");
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            id: "cloud-version-e2e",
            workspace_id: "workspace-e2e",
            created_by_id: "user-e2e",
            revision: 6,
            can_edit: true,
            duration_ms: 1200,
            created_at: "2026-08-09T11:00:00Z",
            updated_at: "2026-08-09T12:05:00Z",
            cover_preview_media_id: "cloud-checkpoint-cover",
            document: { ...currentDocument, title: "Cloud checkpoint title" },
          }),
        });
        return;
      }
      await route.abort();
    },
  );

  await page.getByRole("button", { name: "Version history" }).click();
  expect(previewRequests).toBe(0);
  await expect(
    page.getByText("Saved by Teammate", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Oldest named cloud version/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByRole("button", { name: /Oldest named cloud version/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Cloud checkpoint/ }).click();
  await expect.poll(() => previewRequests).toBe(1);
  await expect(page.getByText("Title changed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore this version" }).click();
  const confirmation = page
    .getByRole("dialog")
    .filter({ hasText: "Restore this version?" });
  await expect(confirmation).toContainText(
    "save the exact current cloud and browser versions as restore points",
  );
  await confirmation.getByRole("button", { name: "Restore version" }).click();

  const localRecovery = page
    .getByRole("dialog")
    .filter({ hasText: "The cloud version was restored" });
  await expect(localRecovery).toContainText("do not retry the restore");
  await expect(
    localRecovery.getByRole("button", { name: "Save local edit as a copy" }),
  ).toBeVisible();
  await localRecovery
    .getByRole("button", { name: "Load OpenPost version" })
    .click();
  await expect.poll(() => cloudHeadRequests).toBe(1);
  await expect(localRecovery).toBeVisible();
  await expect(
    localRecovery.getByRole("button", { name: "Load OpenPost version" }),
  ).toBeEnabled();
  await localRecovery
    .getByRole("button", { name: "Load OpenPost version" })
    .click();
  await expect.poll(() => cloudHeadRequests).toBe(2);
  await expect(localRecovery).not.toBeVisible();
  expect(restoreRequests).toBe(1);
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "Cloud checkpoint title",
  );

  const recoverySnapshot = await page.evaluate(async (id) => {
    return await new Promise<
      { title?: string; cloudCoverPreviewMediaID?: string } | undefined
    >((resolve, reject) => {
      const open = indexedDB.open("openpost-video-editor");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("project-revisions");
        const getAll = tx.objectStore("project-revisions").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const restorePoint = getAll.result.find(
            (revision) =>
              revision.project_id === id && revision.kind === "restore_point",
          );
          resolve(
            restorePoint
              ? {
                  title: restorePoint.snapshot?.document?.title,
                  cloudCoverPreviewMediaID:
                    restorePoint.snapshot?.cloud_cover_preview_media_id,
                }
              : undefined,
          );
        };
        tx.oncomplete = () => database.close();
      };
    });
  }, projectID);
  expect(recoverySnapshot).toEqual({
    title: "Browser head raced again",
    cloudCoverPreviewMediaID: "cloud-current-cover",
  });
  expect(
    (await readLocalVideoProject(page, projectID)).cloud_cover_preview_media_id,
  ).toBe("cloud-checkpoint-cover");

  await page.getByRole("button", { name: "Version history" }).click();
  await expect(
    page.getByRole("button", { name: /Before restore/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Cloud checkpoint/ }).click();
  await expect(page.getByText("Title changed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore this version" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Restore this version?" })
    .getByRole("button", { name: "Restore version" })
    .click();
  await expect(
    page.getByRole("heading", { name: "This project changed elsewhere" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "Cloud checkpoint title",
  );
});

test("text is visible in both the preview and the exported frame", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/video-editor");
  await page.locator("#video-editor-import").setInputFiles({
    name: "text-parity.webm",
    mimeType: "video/webm",
    buffer: syntheticBlackVideo(),
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  const preview = page.locator("[data-preview-engine-ready]").first();
  await expect(preview).toHaveAttribute("data-preview-engine-ready", "true", {
    timeout: 15_000,
  });
  const beforeText = await brightPixelCount(await preview.screenshot());

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Add title" }).click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("PREVIEW EXPORT PARITY");
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: "text-parity.webm" })
    .click();
  await expect
    .poll(async () => brightPixelCount(await preview.screenshot()))
    .toBeGreaterThan(beforeText + 200);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByText("MP4 · H.264/AAC").click();
  await page.getByRole("option", { name: /WebM · VP9 or VP8\/Opus/ }).click();
  await page.getByRole("button", { name: "Start export" }).click();
  await expect(page.getByText(/Export ready/)).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  const exportedPath = await download.path();
  if (!exportedPath)
    throw new Error("Exported video has no local download path");
  const directory = mkdtempSync(join(tmpdir(), "openpost-export-frame-e2e-"));
  const frame = join(directory, "frame.png");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0.4",
      "-i",
      exportedPath,
      "-frames:v",
      "1",
      frame,
    ]);
    expect(await brightPixelCount(readFileSync(frame))).toBeGreaterThan(200);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("exact H.264 preflight blocks MP4 and offers WebM before render", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    Object.defineProperty(VideoEncoder, "isConfigSupported", {
      configurable: true,
      value: async (config: VideoEncoderConfig) =>
        String(config.codec).startsWith("avc1")
          ? { supported: false, config }
          : original(config),
    });
  });
  await page.goto("/video-editor");
  const video = await syntheticVideo(page);
  await page.locator("#video-editor-import").setInputFiles({
    name: "h264-preflight.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await page.getByRole("button", { name: "Export" }).click();
  await expect(
    page.getByText(/This browser cannot encode H\.264/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start export" }),
  ).toBeDisabled();

  await page.getByText("MP4 · H.264/AAC").click();
  await page.getByRole("option", { name: /WebM · VP9 or VP8\/Opus/ }).click();
  await expect(
    page.getByText("This device supports the selected export settings."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start export" }),
  ).toBeEnabled();
});

test("recorded screen tracks remain durable after manifest cleanup and reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d");
        let frame = 0;
        const draw = () => {
          if (!context) return;
          context.fillStyle = frame % 2 ? "#7c3aed" : "#f97316";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "#ffffff";
          context.font = "700 36px sans-serif";
          context.fillText(`Recorded frame ${frame++}`, 120, 190);
        };
        draw();
        setInterval(draw, 100);
        return canvas.captureStream(24);
      },
    });
  });

  await page.goto("/video-editor/new?mode=record");
  await page.getByRole("checkbox", { name: "Camera" }).uncheck();
  await page.getByRole("checkbox", { name: "Microphone" }).uncheck();
  await page
    .getByRole("checkbox", { name: "System audio", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_400);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page).toHaveURL(/\/video-editor\/local_video_/, {
    timeout: 20_000,
  });
  await expect(page.getByText("screen.webm").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("screen.webm").first()).toBeVisible();
  await expect(
    page.getByText(/missing from local project storage/i),
  ).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("cancelled screen capture shows a waiting state without creating a project", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: () =>
        new Promise<MediaStream>((_resolve, reject) => {
          (
            window as typeof window & { __cancelOpenPostCapture?: () => void }
          ).__cancelOpenPostCapture = () =>
            reject(new DOMException("Capture cancelled", "NotAllowedError"));
        }),
    });
  });
  await page.goto("/video-editor/new?mode=record");
  await expect(
    page.getByText(
      "Tab or system audio appears only when your browser and operating system provide it.",
    ),
  ).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Camera" }).uncheck();
  await page.getByRole("checkbox", { name: "Microphone" }).uncheck();
  await page
    .getByRole("checkbox", { name: "System audio", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByText("Choose a screen, window, or tab in the browser picker."),
  ).toBeVisible();
  await page.evaluate(() => {
    (
      window as typeof window & { __cancelOpenPostCapture?: () => void }
    ).__cancelOpenPostCapture?.();
  });
  await expect(page.getByText("Screen capture was cancelled.")).toBeVisible();
  await page.goto("/video-editor");
  await expect(page.getByText("Screen recording", { exact: true })).toHaveCount(
    0,
  );
});

test("active recordings preserve camera and microphone device switches as segments", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const microphoneFixture = Array.from(syntheticAudio());
  await page.addInitScript((microphoneBytes) => {
    const state = window as unknown as { __mediaCalls: number };
    state.__mediaCalls = 0;
    const NativeMediaRecorder = window.MediaRecorder;
    class FixtureMediaRecorder extends EventTarget {
      static isTypeSupported(mimeType: string): boolean {
        return NativeMediaRecorder.isTypeSupported(mimeType);
      }

      readonly mimeType: string;
      readonly stream: MediaStream;
      state: RecordingState = "inactive";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: MediaRecorderErrorEvent) => void) | null = null;
      private startedAt = 0;

      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super();
        if (stream.getVideoTracks().length > 0) {
          return new NativeMediaRecorder(
            stream,
            options,
          ) as unknown as FixtureMediaRecorder;
        }
        this.stream = stream;
        this.mimeType = options?.mimeType ?? "audio/webm";
      }

      start(timeslice = 1_000): void {
        this.state = "recording";
        this.startedAt = performance.now();
        void timeslice;
      }

      stop(): void {
        if (this.state === "inactive") return;
        this.emitChunk();
        this.state = "inactive";
        queueMicrotask(() => this.dispatchEvent(new Event("stop")));
      }

      pause(): void {
        if (this.state === "recording") this.state = "paused";
      }

      resume(): void {
        if (this.state === "paused") this.state = "recording";
      }

      requestData(): void {
        if (this.state !== "inactive") this.emitChunk();
      }

      private emitChunk(): void {
        const data = new Blob([new Uint8Array(microphoneBytes)], {
          type: this.mimeType,
        });
        this.ondataavailable?.(
          new BlobEvent("dataavailable", {
            data,
            timecode: performance.now() - this.startedAt,
          }),
        );
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FixtureMediaRecorder,
    });
    const videoStream = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#f97316";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      return canvas.captureStream(24);
    };
    const audioStream = () => {
      const context = new AudioContext({ sampleRate: 48_000 });
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      gain.gain.value = 0.04;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      return destination.stream;
    };
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        {
          deviceId: "camera-1",
          groupId: "video",
          kind: "videoinput",
          label: "Camera 1",
          toJSON: () => ({}),
        },
        {
          deviceId: "camera-2",
          groupId: "video",
          kind: "videoinput",
          label: "Camera 2",
          toJSON: () => ({}),
        },
        {
          deviceId: "microphone-1",
          groupId: "audio",
          kind: "audioinput",
          label: "Microphone 1",
          toJSON: () => ({}),
        },
        {
          deviceId: "microphone-2",
          groupId: "audio",
          kind: "audioinput",
          label: "Microphone 2",
          toJSON: () => ({}),
        },
      ],
    });
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => videoStream(),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        state.__mediaCalls += 1;
        return new MediaStream([
          ...(constraints.video ? videoStream().getVideoTracks() : []),
          ...(constraints.audio ? audioStream().getAudioTracks() : []),
        ]);
      },
    });
  }, microphoneFixture);

  await page.goto("/video-editor/new?mode=record");
  await page
    .getByRole("checkbox", { name: "System audio", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_100);

  await page.getByRole("button", { name: "Switch camera" }).click();
  await page.getByRole("option", { name: "Camera 2" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __mediaCalls: number }).__mediaCalls,
      ),
    )
    .toBe(2);
  await page.waitForTimeout(1_100);

  await page.getByRole("button", { name: "Switch microphone" }).click();
  await page.getByRole("option", { name: "Microphone 2" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __mediaCalls: number }).__mediaCalls,
      ),
    )
    .toBe(3);

  await page.waitForTimeout(1_200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page).toHaveURL(/\/video-editor\/local_video_/, {
    timeout: 20_000,
  });
  const recordingTimeline = page.getByRole("region", { name: "Timeline" });
  await expect(
    recordingTimeline.getByRole("button", { name: "camera.webm", exact: true }),
  ).toHaveCount(2);
  await expect(
    recordingTimeline.getByRole("button", {
      name: "microphone.webm",
      exact: true,
    }),
  ).toHaveCount(2);
});

test("rollout flag blocks every entry route", async ({ page }) => {
  const configResponse = await page.request.get("/api/v1/video-editor/config");
  expect(configResponse.ok()).toBeTruthy();
  const body = (await configResponse.json()) as Record<string, unknown>;
  await page.route("**/api/v1/video-editor/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...body, enabled: false }),
    });
  });

  await page.goto("/video-editor");
  await expect(
    page.getByText(
      "OpenPost Video Editor is disabled on this OpenPost instance.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Record/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(
    page.getByRole("link", { name: /Browse stock/ }),
  ).toHaveAttribute("aria-disabled", "true");

  await page.goto("/video-editor/new?mode=blank");
  await expect(page).toHaveURL(/\/video-editor$/);
  await page.goto("/video-editor/local_video_not-real");
  await expect(page).toHaveURL(/\/video-editor$/);
});

test("unsupported browser redirects before creating local work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (globalThis as { VideoDecoder?: unknown }).VideoDecoder;
    delete (globalThis as { VideoEncoder?: unknown }).VideoEncoder;
  });
  await page.goto("/video-editor/new?mode=blank");
  await expect(page).toHaveURL(/\/video-editor\/unsupported$/);
  await expect(
    page.getByRole("heading", {
      name: "This browser cannot run the full OpenPost Video Editor",
    }),
  ).toBeVisible();
});

test("mobile keeps touch timeline editing, contextual tools, and export", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/video-editor");
  const video = await syntheticVideo(page);
  await page.locator("#video-editor-import").setInputFiles({
    name: "mobile-preview.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();
  const exportBounds = await page
    .getByRole("button", { name: "Export" })
    .boundingBox();
  if (!exportBounds) throw new Error("Mobile export control has no bounds");
  expect(exportBounds.width).toBeGreaterThanOrEqual(44);
  expect(exportBounds.height).toBeGreaterThanOrEqual(44);
  for (const tool of [
    "Media",
    "Text",
    "Elements",
    "Audio",
    "Captions",
    "Transitions",
    "Smart",
  ]) {
    await expect(
      page.getByRole("button", { name: tool, exact: true }),
    ).toBeInViewport();
  }
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const toolSheet = page.getByRole("complementary", { name: "Text" });
  await expect(toolSheet).toBeVisible();
  await toolSheet.getByRole("button", { name: "Close" }).click();
  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: "mobile-preview.webm" })
    .click();
  const inspectorSheet = page.getByRole("complementary", {
    name: "Properties",
  });
  await expect(inspectorSheet).toBeVisible();
  await inspectorSheet.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("the complete editor stays usable at 320px", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 700 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/video-editor");
  const video = await syntheticVideo(page);
  await page.locator("#video-editor-import").setInputFiles({
    name: "narrow-phone.webm",
    mimeType: "video/webm",
    buffer: video,
  });

  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Format" })).toBeVisible();
  await page.getByRole("button", { name: "Quick cut", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Source timeline" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Full editor", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Timeline" })
      .getByRole("slider", { name: "Timeline", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Text" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("a tablet-width editor keeps creation tools reachable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 768, height: 900 },
    hasTouch: false,
  });
  const page = await context.newPage();
  await page.goto("/video-editor");
  const video = await syntheticVideo(page);
  await page.locator("#video-editor-import").setInputFiles({
    name: "tablet-editor.webm",
    mimeType: "video/webm",
    buffer: video,
  });

  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const toolDrawer = page.getByRole("complementary", { name: "Text" });
  await expect(toolDrawer).toBeVisible();
  await toolDrawer.getByRole("button", { name: "Close" }).click();
  await expect(toolDrawer).toBeHidden();
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("a narrow fine-pointer desktop keeps the complete editor", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 922, height: 900 },
    hasTouch: false,
  });
  const page = await context.newPage();
  await page.goto("/video-editor");
  const video = await syntheticVideo(page);
  await page.locator("#video-editor-import").setInputFiles({
    name: "compact-desktop.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();
  await expect(
    page.getByText("Timeline editing needs a desktop Chromium browser"),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("a zoom-equivalent fine-pointer viewport uses drawers without losing timeline editing", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 461, height: 720 },
    hasTouch: false,
  });
  const page = await context.newPage();
  await page.goto("/video-editor");
  const video = await syntheticVideo(page);
  await page.locator("#video-editor-import").setInputFiles({
    name: "zoomed-desktop.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Timeline editing needs a desktop Chromium browser"),
  ).toBeHidden();

  await page.getByRole("button", { name: "Text" }).click();
  const toolDrawer = page.getByRole("complementary", { name: "Text" });
  await expect(toolDrawer).toBeVisible();
  await toolDrawer.getByRole("button", { name: "Close" }).click();
  await expect(toolDrawer).toBeHidden();

  await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("button", { name: "zoomed-desktop.webm" })
    .click();
  const inspectorDrawer = page.getByRole("complementary", {
    name: "Properties",
  });
  await expect(inspectorDrawer).toBeVisible();
  await inspectorDrawer.getByRole("button", { name: "Close" }).click();
  await expect(inspectorDrawer).toBeHidden();
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("real Silero VAD completes after reaching 100 percent", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/video-editor");
  const video = syntheticVideoWithAudio();
  await page.locator("#video-editor-import").setInputFiles({
    name: "vad-regression.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await page.getByRole("button", { name: "Captions" }).click();
  await page.getByRole("button", { name: "Find silent sections" }).click();
  const consent = page.getByRole("dialog", {
    name: "Download a local analysis model?",
  });
  await expect(consent).toBeVisible();
  const started = Date.now();
  await consent.getByRole("button", { name: "Download and continue" }).click();
  await expect(page.getByText(/silent section\(s\)/)).toBeVisible({
    timeout: 60_000,
  });
  expect(Date.now() - started).toBeLessThan(60_000);
  expect(browserErrors).toEqual([]);
});

test("real Whisper transcription completes without leaving analysis busy", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/video-editor");
  const video = syntheticVideoWithAudio();
  await page.locator("#video-editor-import").setInputFiles({
    name: "whisper-regression.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-editor\/local_video_/);
  await page.getByRole("button", { name: "Captions" }).click();
  await page.getByRole("button", { name: "Transcript language" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await page.getByRole("button", { name: "Generate captions locally" }).click();
  const consent = page.getByRole("dialog", {
    name: "Download a local analysis model?",
  });
  await expect(consent).toBeVisible();
  const started = Date.now();
  await consent.getByRole("button", { name: "Download and continue" }).click();
  await expect(
    page.getByText(/caption section\(s\) ready to review/),
  ).toBeVisible({
    timeout: 240_000,
  });
  expect(Date.now() - started).toBeLessThan(240_000);
  expect(browserErrors).toEqual([]);
});
