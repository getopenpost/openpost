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
}) => {
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
  await seek(page, 2);
  await page.getByRole("button", { name: /^Mark in/ }).click();
  await seek(page, 3);
  await page.getByRole("button", { name: /^Mark out/ }).click();
  await page.getByRole("button", { name: "Remove selection", exact: true }).click();
  await expect(page.getByRole("button", { name: "Segment 2", exact: true })).toBeVisible();
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
  await authenticatePage(page, auth.token);
  const start = `/video-editor/new?source=media:${media.id}`;
  await page.goto(start);
  await page.getByRole("link", { name: "Open Quick Cut", exact: true }).click();
  await expect(page.locator("video")).toBeVisible({ timeout: 90_000 });
  await page.goto(start);
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[^/?]+\?storage=cloud$/, { timeout: 90_000 });
  await expect(
    page.getByRole("button", { name: new RegExp(`media-${media.id}`) }).first(),
  ).toBeVisible({ timeout: 90_000 });
});
