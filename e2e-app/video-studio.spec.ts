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
        const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
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

  const playhead = page.getByRole("slider", {
    name: "Timeline",
    exact: true,
  });
  const bounds = await playhead.boundingBox();
  if (!bounds) throw new Error("Timeline playhead has no bounds");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole("button", { name: /^Split/ }).click();
  await expect(page.getByText("openpost-e2e.webm")).toHaveCount(3);

  await page.getByRole("button", { name: "Text" }).click();
  await page.getByRole("button", { name: "Add title" }).click();
  await expect(page.getByText("Your title").first()).toBeVisible();

  for (const format of [
    "Portrait · 9:16",
    "Feed portrait · 4:5",
    "Square · 1:1",
    "Landscape · 16:9",
  ]) {
    await page.getByRole("button", { name: "Format", exact: true }).click();
    await page.getByRole("option", { name: format }).click();
  }

  await expect(page.getByText("Saved locally")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByText("Your title").first()).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByText("MP4 · H.264/AAC").click();
  await page.getByRole("option", { name: /WebM · VP9 or VP8\/Opus/ }).click();
  await page.getByRole("button", { name: "Start export" }).click();
  await expect(page.getByText(/Export ready/)).toBeVisible({ timeout: 60_000 });

  expect(unexpectedWrites).toEqual([]);
  expect(browserErrors).toEqual([]);
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});
