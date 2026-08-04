import { expect, test, type Page } from "@playwright/test";

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

async function syntheticVideoWithAudio(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#18181b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "700 24px sans-serif";
    context.fillText("VAD completion fixture", 32, 96);
    const videoStream = canvas.captureStream(24);
    const audioContext = new AudioContext({ sampleRate: 48_000 });
    const destination = audioContext.createMediaStreamDestination();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 180;
    gain.gain.setValueAtTime(0, audioContext.currentTime);
    gain.gain.setValueAtTime(0.18, audioContext.currentTime + 0.2);
    gain.gain.setValueAtTime(0, audioContext.currentTime + 0.9);
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    const stream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);
    const mimeType = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) throw new Error("No audio/video WebM recorder is available");
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(100);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    oscillator.stop();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
    return Array.from(
      new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer()),
    );
  });
  return Buffer.from(bytes);
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
  await expect(page.getByText("pexels-photo-1.jpg")).toBeVisible();
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

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("MP4 · H.264/AAC").click();
  await page.getByRole("option", { name: /WebM · VP9 or VP8\/Opus/ }).click();
  await page.getByRole("button", { name: "Start export" }).click();
  await expect(page.getByText(/Export ready/)).toBeVisible({ timeout: 60_000 });

  expect(unexpectedWrites).toEqual([]);
  expect(browserErrors).toEqual([]);
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
  await page.getByRole("checkbox", { name: /Tab or system audio/ }).uncheck();
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

test("active recordings preserve camera and microphone device switches as segments", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const state = window as unknown as { __mediaCalls: number };
    state.__mediaCalls = 0;
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
  });

  await page.goto("/video-editor/new?mode=record");
  await page.getByRole("checkbox", { name: /Tab or system audio/ }).uncheck();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Switch camera" }).click();
  await page.getByRole("option", { name: "Camera 2" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __mediaCalls: number }).__mediaCalls,
      ),
    )
    .toBe(2);

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
  await expect(page.getByText("camera.webm")).toHaveCount(2);
  await expect(page.getByText("microphone.webm")).toHaveCount(2);
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
  const video = await syntheticVideoWithAudio(page);
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
  const video = await syntheticVideoWithAudio(page);
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
