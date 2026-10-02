import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

test("conversion thumbnail labels fit inside their artwork at every directory width", async ({
  page,
}, testInfo) => {
  await page.goto("/tools");
  await dismissTelemetryConsent(page);
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await selectTheme(page, theme);
      const visuals = page
        .getByRole("main")
        .locator(
          'a[href="/tools/jpg-to-webp"] .tool-visual, a[href="/tools/mp4-to-mkv"] .tool-visual, a[href="/tools/flac-to-mp3"] .tool-visual',
        );
      expect(await visuals.count()).toBe(3);
      const overflow = await visuals.evaluateAll((visuals) =>
        visuals.flatMap((visual) => {
          const bounds = visual.getBoundingClientRect();
          const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
          const clipped: string[] = [];
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            const text = range.getBoundingClientRect();
            if (
              text.left < bounds.left - 1 ||
              text.right > bounds.right + 1 ||
              text.top < bounds.top - 1 ||
              text.bottom > bounds.bottom + 1
            )
              clipped.push(walker.currentNode.textContent);
          }
          return clipped;
        }),
      );
      expect(overflow, `clipped labels at ${width}px in ${theme}`).toEqual([]);
      for (const [index, family] of ["video", "audio", "image"].entries()) {
        const visual = visuals.nth(index);
        await visual.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            visual
              .locator("img")
              .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
          )
          .toBe(true);
        await visual.locator("img").evaluate((image: HTMLImageElement) => image.decode());
        await page.screenshot({
          path: testInfo.outputPath(`thumbnails-${family}-${width}-${theme}.png`),
        });
      }
    }
  }
});

async function selectTheme(page: Page, theme: "light" | "dark") {
  const toggle = page.getByRole("button", { name: `Use ${theme} theme`, exact: true });
  const mobileMenu = page.getByRole("button", { name: "Open navigation", exact: true });
  const phone = await mobileMenu.isVisible();
  if (phone) await mobileMenu.click();
  if (await toggle.isVisible()) await toggle.click();
  if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/(?:^| )dark(?: |$)/);
  else await expect(page.locator("html")).not.toHaveClass(/(?:^| )dark(?: |$)/);
}

let fixtures: string;
test.beforeAll(async () => {
  fixtures = await mkdtemp(join(tmpdir(), "openpost-media-tools-"));
  const common = ["-hide_banner", "-loglevel", "error", "-y"];
  execFileSync("ffmpeg", [
    ...common,
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=12:duration=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    join(fixtures, "sample.mp4"),
  ]);
  execFileSync("ffmpeg", [
    ...common,
    "-i",
    join(fixtures, "sample.mp4"),
    "-c",
    "copy",
    join(fixtures, "sample.mkv"),
  ]);
  execFileSync("ffmpeg", [
    ...common,
    "-i",
    join(fixtures, "sample.mp4"),
    "-c:v",
    "libvpx-vp9",
    "-c:a",
    "libopus",
    join(fixtures, "sample.webm"),
  ]);
  execFileSync("ffmpeg", [
    ...common,
    "-i",
    join(fixtures, "sample.mp4"),
    "-an",
    "-c:v",
    "copy",
    join(fixtures, "silent.mp4"),
  ]);
  execFileSync("ffmpeg", [
    ...common,
    "-i",
    join(fixtures, "sample.mp4"),
    "-c:v",
    "copy",
    "-c:a",
    "adpcm_ima_qt",
    join(fixtures, "unsupported-audio.mov"),
  ]);
  execFileSync("ffmpeg", [
    ...common,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1",
    "-c:a",
    "pcm_s16le",
    join(fixtures, "tone.wav"),
  ]);
  execFileSync("ffmpeg", [
    ...common,
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30:duration=2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-b:v",
    "8M",
    join(fixtures, "large.mp4"),
  ]);
  execFileSync("ffmpeg", [
    ...common,
    "-i",
    join(fixtures, "tone.wav"),
    "-c:a",
    "libmp3lame",
    join(fixtures, "tone.mp3"),
  ]);
  for (const [name, codec] of [
    ["tone.flac", "flac"],
    ["tone.ogg", "libopus"],
    ["tone.m4a", "aac"],
  ]) {
    execFileSync("ffmpeg", [
      ...common,
      "-i",
      join(fixtures, "tone.wav"),
      "-c:a",
      codec,
      join(fixtures, name),
    ]);
  }
  execFileSync("ffmpeg", [
    ...common,
    "-i",
    join(fixtures, "sample.mp4"),
    "-c",
    "copy",
    join(fixtures, "sample.mov"),
  ]);
});
test.afterAll(async () => {
  if (fixtures) await rm(fixtures, { recursive: true, force: true });
});

function probe(path: string) {
  execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", path, "-f", "null", "-"]);
  // SAFETY: ffprobe's successful -show_streams/-show_format JSON output supplies these fields.
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], {
      encoding: "utf8",
    }),
  ) as {
    format: { format_name: string; duration: string };
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      sample_rate?: string;
      channels?: number;
      bit_rate?: string;
    }[];
  };
}
async function convertAndDownload(
  page: Page,
  route: string,
  input: string,
  action = "Convert file",
) {
  await page.goto(`/tools/${route}`);
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose a media file").setInputFiles(join(fixtures, input));
  await page.getByRole("button", { name: action, exact: true }).click();
  const downloadButton = page.getByRole("button", { name: /^Download / });
  await expect(downloadButton).toBeVisible({ timeout: 30000 });
  const pending = page.waitForEvent("download");
  await downloadButton.click();
  const download = await pending;
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { download, media: probe(path) };
}

for (const [route, input, container, video, audio] of [
  ["mp4-to-mkv", "sample.mp4", "matroska,webm", "h264", "aac"],
  ["mkv-to-mp4", "sample.mkv", "mov,mp4,m4a,3gp,3g2,mj2", "h264", "aac"],
  ["webm-to-mp4", "sample.webm", "mov,mp4,m4a,3gp,3g2,mj2", "vp9", "opus"],
  ["mp4-to-webm", "sample.mp4", "matroska,webm", "vp9", "opus"],
  ["wav-to-mp3", "tone.wav", "mp3", "", "mp3"],
  ["mp3-to-wav", "tone.mp3", "wav", "", "pcm_s16le"],
  ["mov-to-mp4", "sample.mov", "mov,mp4,m4a,3gp,3g2,mj2", "h264", "aac"],
  ["flac-to-mp3", "tone.flac", "mp3", "", "mp3"],
  ["flac-to-wav", "tone.flac", "wav", "", "pcm_s16le"],
  ["ogg-to-mp3", "tone.ogg", "mp3", "", "mp3"],
  ["mp3-to-m4a", "tone.mp3", "mov,mp4,m4a,3gp,3g2,mj2", "", "aac"],
  ["m4a-to-mp3", "tone.m4a", "mp3", "", "mp3"],
]) {
  test(`${route} downloads valid media with its selected tracks`, async ({ page }) => {
    const { download, media } = await convertAndDownload(page, route, input);
    expect(download.suggestedFilename()).toBe(`${input.split(".")[0]}.${route.split("-to-")[1]}`);
    expect(media.format.format_name).toBe(container);
    expect(Number(media.format.duration)).toBeGreaterThanOrEqual(0.9);
    expect(Number(media.format.duration)).toBeLessThan(1.2);
    expect(media.streams.map((stream) => stream.codec_type)).toEqual(
      video ? ["video", "audio"] : ["audio"],
    );
    expect(media.streams.find((stream) => stream.codec_type === "audio")?.codec_name).toBe(audio);
    if (route === "wav-to-mp3") {
      expect(Number(media.streams[0].bit_rate)).toBeGreaterThan(180000);
      expect(Number(media.streams[0].bit_rate)).toBeLessThan(205000);
    }
    if (video)
      expect(media.streams[0]).toMatchObject({ codec_name: video, width: 160, height: 90 });
  });
}

test("audio extraction and muting keep only the requested media", async ({ page }) => {
  const extracted = await convertAndDownload(page, "extract-audio-from-video", "sample.mp4");
  expect(extracted.media.streams).toHaveLength(1);
  expect(extracted.media.streams[0]).toMatchObject({ codec_type: "audio", codec_name: "mp3" });
  const muted = await convertAndDownload(
    page,
    "remove-audio-from-video",
    "sample.mp4",
    "Remove audio",
  );
  expect(muted.media.streams).toHaveLength(1);
  expect(muted.media.streams[0]).toMatchObject({
    codec_type: "video",
    codec_name: "h264",
    width: 160,
    height: 90,
  });
});

test("codec changes re-encode to the requested H.264 profile", async ({ page }) => {
  await page.goto("/tools/video-codec-converter");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose a media file").setInputFiles(join(fixtures, "sample.webm"));
  await page.getByRole("button", { name: "Video codec", exact: true }).click();
  await page.getByRole("option", { name: "H.264 / AVC", exact: true }).click();
  await page.getByRole("button", { name: "Convert file", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download MP4", exact: true }).click();
  const media = probe((await (await pending).path())!);
  expect(media.streams[0]).toMatchObject({ codec_name: "h264", width: 160, height: 90 });
});

test("blocked and corrupt sources do not produce partial downloads", async ({ page }) => {
  await page.goto("/tools/extract-audio-from-video");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose a media file").setInputFiles(join(fixtures, "silent.mp4"));
  await page.getByRole("button", { name: "Convert file", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("no audio track");
  await expect(page.getByRole("button", { name: /^Download / })).toHaveCount(0);
  await page.goto("/tools/video-converter");
  await page
    .getByLabel("Choose a media file")
    .setInputFiles(join(fixtures, "unsupported-audio.mov"));
  await page.getByRole("button", { name: "Convert file", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("cannot convert");
  await expect(page.getByRole("button", { name: /^Download / })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose another file" }).click();
  await page.getByLabel("Choose a media file").setInputFiles({
    name: "broken.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("broken media"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
});

test("media inspector reports file content and has no conversion action", async ({ page }) => {
  await page.goto("/tools/media-info");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose a media file").setInputFiles(join(fixtures, "sample.mp4"));
  const info = page.getByRole("definition");
  await expect(info.first()).toContainText("H.264 / AVC");
  await expect(info.first()).toContainText("160 × 90");
  await expect(info.nth(1)).toContainText("AAC");
  await expect(info.nth(1)).toContainText("48000 Hz");
  await expect(page.getByRole("button", { name: "Convert file" })).toHaveCount(0);
});

test("compression applies the chosen resolution and bitrate", async ({ page }) => {
  await page.goto("/tools/video-compressor");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose a media file").setInputFiles(join(fixtures, "large.mp4"));
  await page.getByLabel("Video bitrate, Mbps").fill("0.2");
  await page.getByRole("button", { name: "Maximum height" }).click();
  await page.getByRole("option", { name: "480p", exact: true }).click();
  await page.getByRole("button", { name: "Compress video", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download MP4", exact: true }).click();
  const media = probe((await (await pending).path())!);
  expect(media.streams[0]).toMatchObject({ codec_name: "h264", height: 480 });
  expect(Number(media.streams[0].bit_rate)).toBeLessThan(500000);
  expect(Number(media.format.duration)).toBeGreaterThanOrEqual(1.9);
});

test("hidden bitrate settings do not block copying and settings clear stale downloads", async ({
  page,
}) => {
  await page.goto("/tools/audio-converter");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose a media file").setInputFiles(join(fixtures, "tone.mp3"));
  await page.getByLabel("Audio bitrate, kbps").fill("0");
  await page.getByRole("button", { name: "Audio codec" }).click();
  await page.getByRole("option", { name: "Keep source codec", exact: true }).click();
  await page.getByRole("button", { name: "Convert file", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download MP3", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Output format" }).click();
  await page.getByRole("option", { name: "WAV", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Download / })).toHaveCount(0);
  await page.getByRole("button", { name: "Audio codec", exact: true }).click();
  await page.getByRole("option", { name: "PCM, 16-bit", exact: true }).click();
  await expect(page.getByLabel("Audio bitrate, kbps")).toHaveCount(0);
  await page.getByRole("button", { name: "Convert file", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download WAV", exact: true }).click();
  expect(probe((await (await pending).path())!).streams[0].codec_name).toBe("pcm_s16le");
});

test("cancelling a conversion leaves the source ready for another attempt", async ({ page }) => {
  await page.goto("/tools/video-compressor");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose a media file").setInputFiles(join(fixtures, "large.mp4"));
  await page.getByRole("button", { name: "Compress video", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Conversion cancelled" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compress video", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Download / })).toHaveCount(0);
});

test("media tool guides and previews are discoverable without JavaScript", async ({
  browser,
  baseURL,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const [slug, heading, guide] of [
    ["mp4-to-mkv", "MP4 to MKV", "When to convert MP4 to MKV"],
    ["wav-to-mp3", "WAV to MP3", "When to convert WAV to MP3"],
    ["video-compressor", "Video compressor", "Make a smaller delivery copy"],
    ["extract-audio-from-video", "Extract audio from video", "Save the primary soundtrack"],
    ["media-info", "Video and audio file info", "What is inside your media file?"],
  ]) {
    await page.goto(`${baseURL}/tools/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByRole("heading", { name: guide, exact: true })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://openpo.st/tools/${slug}`,
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `https://openpo.st/og/tool-${slug}.png`,
    );
    expect(sitemap).toContain(`<loc>https://openpo.st/tools/${slug}</loc>`);
    const preview = await request.get(`/og/tool-${slug}.png`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toContain("image/png");
  }
  await context.close();
});

test("converter controls work with keyboard and fit desktop and phone themes", async ({
  page,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://app.openpo.st/api/v1/github-stars", (route) =>
    route.fulfill({ json: { count: 512 } }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tools/video-codec-converter");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Choose a media file").setInputFiles(join(fixtures, "sample.webm"));
  const codec = page.getByRole("button", { name: "Video codec", exact: true });
  await expect(codec).toBeEnabled();
  await codec.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(codec).toContainText("H.264 / AVC");
  await codec.press("Tab");
  await expect(page.getByLabel("Video bitrate, Mbps")).toBeFocused();
  await page.getByRole("button", { name: "Convert file", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download MP4", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".result video").evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByLabel("Converted video preview").press("Space");
  await expect
    .poll(() =>
      page.locator(".result video").evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await selectTheme(page, theme);
      const tool = page.locator(".media-tool");
      await tool.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      if (isMobile)
        for (const label of ["Output format", "Video codec", "Audio codec"]) {
          expect(
            (await page.getByRole("button", { name: label, exact: true }).boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44);
        }
      await page.screenshot({ path: testInfo.outputPath(`converter-${width}-${theme}.png`) });
    }
  }
  expect(errors).toEqual([]);
});
