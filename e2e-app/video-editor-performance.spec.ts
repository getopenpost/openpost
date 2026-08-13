import { expect, test } from "@playwright/test";
import { stat } from "node:fs/promises";

const sourcePath = process.env.OPENPOST_VIDEO_EDITOR_BENCHMARK_SOURCE;

test("one-hour 1080p60 source stays bounded and responsive", async ({
  page,
}, testInfo) => {
  test.skip(
    !sourcePath,
    "Set OPENPOST_VIDEO_EDITOR_BENCHMARK_SOURCE to the long fixture.",
  );
  test.setTimeout(180_000);
  const source = sourcePath!;
  const sourceStat = await stat(source);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/video-editor");
  const importStartedAt = performance.now();
  await page.locator("#video-editor-import").setInputFiles(source);
  await expect(page).toHaveURL(/\/video-editor\/local_video_/, {
    timeout: 90_000,
  });
  await expect(page.getByText("1080p60-1h.mp4").first()).toBeVisible();
  await expect(page.getByText(/1920×1080/).first()).toBeVisible();
  const preview = page.locator("[data-preview-engine-ready]").first();
  await expect(preview).toHaveAttribute("data-preview-engine-ready", "true", {
    timeout: 60_000,
  });
  const importReadyMS = performance.now() - importStartedAt;

  const timeline = page.getByRole("slider", { name: "Timeline", exact: true });
  // The ARIA slider is the thumb. Click its root track so the pointer ratio maps
  // across the complete project duration instead of across the 14 px thumb.
  const bounds = await timeline.locator("..").boundingBox();
  if (!bounds) throw new Error("Timeline slider has no bounds.");
  const seekLatenciesMS: number[] = [];
  for (const ratio of [0.03, 0.17, 0.34, 0.51, 0.68, 0.84, 0.97]) {
    const expectedUS = Math.round(3_600_000_000 * ratio);
    const startedAt = performance.now();
    await page.mouse.click(
      bounds.x + bounds.width * ratio,
      bounds.y + bounds.height / 2,
    );
    await expect
      .poll(
        async () =>
          Number(
            await preview.getAttribute("data-preview-rendered-timestamp-us"),
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(expectedUS - 5_000_000);
    seekLatenciesMS.push(performance.now() - startedAt);
  }

  const droppedBefore = Number(
    await preview.getAttribute("data-preview-dropped-requests"),
  );
  await page.getByRole("button", { name: "Play" }).first().click();
  await expect(preview).toHaveAttribute("data-preview-render-mode", "native");
  const playbackVideo = page.locator("[data-video-editor-primary]").first();
  await expect(playbackVideo).toBeVisible();
  const playbackStartSeconds = await playbackVideo.evaluate(
    (element: HTMLVideoElement) => element.currentTime,
  );
  await expect
    .poll(
      async () =>
        playbackVideo.evaluate(
          (element: HTMLVideoElement) => element.currentTime,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(playbackStartSeconds + 0.1);
  const playback = await playbackVideo.evaluate(
    async (element: HTMLVideoElement) => {
      const initialQuality = element.getVideoPlaybackQuality?.();
      const initialTime = element.currentTime;
      const startedAt = performance.now();
      const frameIntervalsMS: number[] = [];
      let previousFrameAt = startedAt;
      let presentedFrames = 0;
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(() => resolve(), 5_000);
        const frame = (now: number) => {
          if (presentedFrames > 0) frameIntervalsMS.push(now - previousFrameAt);
          previousFrameAt = now;
          presentedFrames += 1;
          if (presentedFrames >= 300) {
            window.clearTimeout(timeout);
            resolve();
            return;
          }
          element.requestVideoFrameCallback(frame);
        };
        element.requestVideoFrameCallback(frame);
      });
      const finalQuality = element.getVideoPlaybackQuality?.();
      return {
        frame_intervals_ms: frameIntervalsMS,
        presented_frames: presentedFrames,
        media_advance_seconds: element.currentTime - initialTime,
        wall_seconds: (performance.now() - startedAt) / 1_000,
        decoded_frames:
          (finalQuality?.totalVideoFrames ?? 0) -
          (initialQuality?.totalVideoFrames ?? 0),
        dropped_frames:
          (finalQuality?.droppedVideoFrames ?? 0) -
          (initialQuality?.droppedVideoFrames ?? 0),
      };
    },
  );
  await page.getByRole("button", { name: "Pause" }).first().click();
  const droppedAfter = Number(
    await preview.getAttribute("data-preview-dropped-requests"),
  );
  const sortedFrameIntervals = [...playback.frame_intervals_ms].sort(
    (left, right) => left - right,
  );
  const sortedSeeks = [...seekLatenciesMS].sort((left, right) => left - right);
  const report = {
    source_bytes: sourceStat.size,
    import_ready_ms: Math.round(importReadyMS),
    seek_ms: seekLatenciesMS.map(Math.round),
    seek_p95_ms: Math.round(
      sortedSeeks[Math.floor(sortedSeeks.length * 0.95)] ?? 0,
    ),
    playback_frame_interval_p95_ms:
      sortedFrameIntervals[Math.floor(sortedFrameIntervals.length * 0.95)] ?? 0,
    playback_presented_frames: playback.presented_frames,
    playback_media_advance_seconds: playback.media_advance_seconds,
    playback_wall_seconds: playback.wall_seconds,
    playback_decoded_frames: playback.decoded_frames,
    playback_dropped_frames: playback.dropped_frames,
    playback_decoded_fps: playback.decoded_frames / playback.wall_seconds,
    dropped_render_requests: droppedAfter - droppedBefore,
    peak_video_decoders: Number(
      await preview.getAttribute("data-preview-peak-decoders"),
    ),
    proxy_sources: Number(
      await preview.getAttribute("data-preview-proxy-sources"),
    ),
  };
  await testInfo.attach("video-editor-performance.json", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });
  console.info(`[video-editor-benchmark] ${JSON.stringify(report)}`);

  expect(report.import_ready_ms).toBeLessThan(60_000);
  expect(report.seek_p95_ms).toBeLessThan(2_000);
  expect(report.playback_media_advance_seconds).toBeGreaterThan(1.5);
  expect(report.playback_decoded_fps).toBeGreaterThan(50);
  expect(report.playback_dropped_frames).toBeLessThan(
    Math.max(6, report.playback_decoded_frames * 0.1),
  );
  expect(report.dropped_render_requests).toBeLessThan(300);
  expect(report.peak_video_decoders).toBeLessThanOrEqual(3);
  await expect(preview).toHaveAttribute("data-preview-error", "");
  expect(browserErrors).toEqual([]);
});
