import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

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
  ["webm-to-mp4", "sample.webm", "mov,mp4,m4a,3gp,3g2,mj2", "vp9", "opus"],
  ["mp4-to-webm", "sample.mp4", "matroska,webm", "vp9", "opus"],
  ["wav-to-mp3", "tone.wav", "mp3", "", "mp3"],
  ["mp3-to-m4a", "tone.mp3", "mov,mp4,m4a,3gp,3g2,mj2", "", "aac"],
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
