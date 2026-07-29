import { expect, test, type Page } from "@playwright/test";

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

test("guest imports, edits, autosaves, restores, and exports a local video", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  const unexpectedWrites: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.url().includes("/api/v1/video-studio/projects")
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

  await page.goto("/video-studio");
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
  await page.locator("#video-studio-import").setInputFiles({
    name: "openpost-e2e.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-studio\/local_video_/);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByText("openpost-e2e.webm").first()).toBeVisible();

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

  await page.getByRole("button", { name: "Text" }).click();
  await page.getByRole("button", { name: "Add title" }).click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("Launch day");
  await expect(page.getByText("Launch day").first()).toBeVisible();

  await page.getByRole("button", { name: "Elements" }).click();
  await page.getByRole("button", { name: "Highlight box" }).click();
  await expect(page.getByText("annotation overlay")).toBeVisible();
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

  await page.getByRole("button", { name: "Stock" }).click();
  await page
    .getByRole("textbox", { name: "Search stock photos and videos" })
    .fill("desk");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("By OpenPost Test")).toBeVisible();
  await page.getByRole("button", { name: "Use this item" }).click();
  await expect(page.getByText("pexels-photo-1.jpg")).toBeVisible();
  await expect(page.getByText("OpenPost Test on Pexels")).toBeVisible();

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

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("MP4 · H.264/AAC").click();
  await page.getByRole("option", { name: /WebM · VP9 or VP8\/Opus/ }).click();
  await page.getByRole("button", { name: "Start export" }).click();
  await expect(page.getByText(/Export ready/)).toBeVisible({ timeout: 60_000 });

  expect(unexpectedWrites).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("rollout flag blocks every entry route", async ({ page }) => {
  await page.route("**/api/v1/video-studio/config", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      contentType: "application/json",
      body: JSON.stringify({ ...body, enabled: false }),
    });
  });

  await page.goto("/video-studio");
  await expect(
    page.getByText("Video Studio is disabled on this OpenPost instance."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Record/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(
    page.getByRole("link", { name: /Browse stock/ }),
  ).toHaveAttribute("aria-disabled", "true");

  await page.goto("/video-studio/new?mode=blank");
  await expect(page).toHaveURL(/\/video-studio$/);
  await page.goto("/video-studio/local_video_not-real");
  await expect(page).toHaveURL(/\/video-studio$/);
});

test("unsupported browser redirects before creating local work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (globalThis as { VideoDecoder?: unknown }).VideoDecoder;
    delete (globalThis as { VideoEncoder?: unknown }).VideoEncoder;
  });
  await page.goto("/video-studio/new?mode=blank");
  await expect(page).toHaveURL(/\/video-studio\/unsupported$/);
  await expect(
    page.getByRole("heading", {
      name: "This browser cannot run the full Video Studio",
    }),
  ).toBeVisible();
});

test("mobile shows preview and handoff guidance without a compressed timeline", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/video-studio");
  await expect(
    page.getByText(/complete timeline and render engine need desktop Chromium/),
  ).toBeVisible();
  const video = await syntheticVideo(page);
  await page.locator("#video-studio-import").setInputFiles({
    name: "mobile-preview.webm",
    mimeType: "video/webm",
    buffer: video,
  });
  await expect(page).toHaveURL(/\/video-studio\/local_video_/);
  await expect(
    page.getByRole("heading", {
      name: "Timeline editing needs a desktop Chromium browser",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: /desktop Chromium/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});
