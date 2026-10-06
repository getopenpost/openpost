import { test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const outputDirectory = "tmp/product-demos";
const viewport = { width: 1280, height: 800 };
export type Scene = { title: string; run: () => Promise<void>; hold?: number; seconds?: number };

export async function record(page: Page, name: string, scenes: Scene[]) {
  for (const scene of scenes) {
    const total = scene.seconds ?? 6;
    const hold = (scene.hold ?? 1800) / 1000;
    if (!Number.isFinite(total) || !Number.isFinite(hold) || hold < 0 || total <= hold)
      throw new Error(`Scene "${scene.title}" needs a duration longer than its reading pause.`);
  }
  await mkdir(outputDirectory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screencast.showActions({ cursor: "pointer", fontSize: 1, duration: 450 });
  await page.screencast.start({ path: join(outputDirectory, `${name}.webm`), size: viewport });
  const frameDirectory = join(outputDirectory, `${name}-frames`);
  await mkdir(frameDirectory, { recursive: true });
  const frames: { file: string; at: number; scene: number; phase: "action" | "hold" }[] = [];
  let sceneIndex = 0;
  let phase: "action" | "hold" = "action";
  let capturing = true;
  let captureError: unknown;
  // PNGs preserve unchanged UI pixels, which GIF delta compression can reuse.
  // The simultaneous WebM remains useful as a full-frame-rate video source.
  const captureFrame = async () => {
    const file = `${name}-frames/${String(frames.length).padStart(5, "0")}.png`;
    frames.push({ file, at: performance.now(), scene: sceneIndex, phase });
    await page.screenshot({ path: join(outputDirectory, file) });
  };
  const captureFrames = (async () => {
    while (capturing) {
      await captureFrame();
      await page.waitForTimeout(100);
    }
  })().catch((error: unknown) => {
    captureError = error;
  });
  try {
    for (const [index, scene] of scenes.entries()) {
      console.log(`${name}: ${scene.title}`);
      sceneIndex = index;
      phase = "action";
      await test.step(scene.title, async () => {
        // Even an immediate action needs a frame in each phase to retain its duration.
        await captureFrame();
        await scene.run();
        phase = "hold";
        await captureFrame();
        await page.waitForTimeout(scene.hold ?? 1800);
      });
    }
    await page.screenshot({ path: join(outputDirectory, `${name}-last.png`) });
  } finally {
    capturing = false;
    await captureFrames;
    await page.screencast.stop();
  }
  if (captureError) throw captureError;
  const durations = new Map<string, number>();
  for (const [index, scene] of scenes.entries()) {
    const holdSeconds = (scene.hold ?? 1800) / 1000;
    for (const phase of ["action", "hold"] as const) {
      const group = frames.filter((frame) => frame.scene === index && frame.phase === phase);
      const intervals = group.map((frame, i) =>
        group[i + 1] ? (group[i + 1].at - frame.at) / 1000 : 0.15,
      );
      const elapsed = intervals.reduce((sum, interval) => sum + interval, 0);
      const target = phase === "hold" ? holdSeconds : (scene.seconds ?? 6) - holdSeconds;
      for (const [i, frame] of group.entries())
        durations.set(frame.file, (intervals[i] * target) / elapsed);
    }
  }
  await writeFile(
    join(outputDirectory, `${name}-scenes.json`),
    JSON.stringify(
      scenes.map((scene) => ({ title: scene.title, seconds: scene.seconds ?? 6 })),
      null,
      2,
    ),
  );
  const manifest = frames
    .map((frame) => `file '${frame.file}'\nduration ${durations.get(frame.file)}`)
    .join("\n");
  await writeFile(
    join(outputDirectory, `${name}.ffconcat`),
    `ffconcat version 1.0\n${manifest}\nfile '${frames.at(-1)!.file}'\n`,
  );
}
