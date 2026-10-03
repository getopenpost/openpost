import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

async function installLocalWorkspacePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        if (!("queryPermission" in prototype)) {
          Object.defineProperty(prototype, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (!("requestPermission" in prototype)) {
          Object.defineProperty(prototype, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
}

async function createProject(
  page: Page,
  name: string,
  options: { selectLocalProjects?: boolean } = {},
): Promise<void> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  if (options.selectLocalProjects) {
    await page.getByRole("button", { name: "Local only" }).click();
  }
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Custom project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u, { timeout: 30_000 });
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  const projectName = page.getByRole("textbox", { name: "Project name" });
  if ((await projectName.inputValue()) !== name) await projectName.fill(name);
}

test.use({ hasTouch: true });
test("recording cleanup is reachable, touch usable, and persists voice treatment with its cuts", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 850 });
  await createProject(page, "Recording cleanup");
  const bytes = (
    await readFile(
      fileURLToPath(new URL("./fixtures/product-screenshots/study-sos-demo.mp4", import.meta.url)),
    )
  ).toString("base64");
  await page.evaluate(async (bytes) => {
    const root = await navigator.storage.getDirectory();
    const imports = await root.getDirectoryHandle("test-imports", { create: true });
    const handle = await imports.getFileHandle("recording.mp4", { create: true });
    const writable = await handle.createWritable();
    await writable.write(Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0)));
    await writable.close();
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [handle],
    });
  }, bytes);
  await page.getByRole("button", { name: "Import media", exact: true }).click();
  await page.getByRole("button", { name: "Place on timeline: recording.mp4", exact: true }).click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("banner").getByRole("status")).toHaveAttribute("data-state", "saved");
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  // Fixture captions enter through the portable project document, then the real editor reopens it.
  await page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle("projects");
    const directory = await projects.getDirectoryHandle(id);
    const handle = await directory.getFileHandle("project.json");
    const project = JSON.parse(await (await handle.getFile()).text());
    const clip = project.timeline.items.find((item: { type: string }) => item.type === "video");
    const fps = project.fps ?? project.metadata?.fps ?? 30;
    project.timeline.items.push({
      id: "review-captions",
      type: "subtitle",
      label: "Review captions",
      trackId: "track-video-overlay",
      from: 0,
      durationInFrames: clip.durationInFrames,
      captionSource: {
        type: "transcript",
        clipId: clip.id,
        mediaId: clip.mediaId,
        sourceStartSeconds: 0,
        sourceEndSeconds: clip.durationInFrames / fps,
      },
      cues: [
        {
          id: "review-cue",
          startFrame: 0,
          endFrame: clip.durationInFrames,
          text: "um this saves time",
          words: [
            { id: "um", text: "um", startFrame: 0, endFrame: 9 },
            { id: "this", text: "this", startFrame: 30, endFrame: 42 },
            { id: "saves", text: "saves", startFrame: 45, endFrame: 60 },
            { id: "time", text: "time", startFrame: 63, endFrame: 78 },
          ],
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(project));
    await writable.close();
  }, id);
  await page.reload();
  const entry = page
    .getByRole("banner")
    .getByRole("button", { name: "Clean up recording", exact: true });
  await expect(entry).toBeEnabled();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "Clean up recording", exact: true });
  await expect(dialog.getByRole("checkbox", { name: "Include um", exact: true })).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(
        dialog.getByRole("button", { name: "Apply changes", exact: true }),
      ).toBeVisible();
      const tabs = dialog.getByRole("tab");
      for (const tab of await tabs.all())
        expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`cleanup-${width}-${scheme}.png`) });
    }
  }
  await dialog.getByRole("checkbox", { name: "Clean voice", exact: true }).tap();
  await dialog.getByRole("button", { name: "Apply changes", exact: true }).tap();
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("banner").getByRole("status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await page.getByRole("banner").getByRole("button", { name: "More actions", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Clean up recording", exact: true }).tap();
  await expect(dialog).toBeVisible();
  const persisted = await page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle("projects");
    const directory = await projects.getDirectoryHandle(id);
    return JSON.parse(
      await (await (await directory.getFileHandle("project.json")).getFile()).text(),
    );
  }, id);
  const clips = persisted.timeline.items.filter((item: { type: string }) => item.type === "video");
  expect(clips.length).toBeGreaterThan(0);
  expect(
    clips.every(
      (item: { audioNoiseReductionEnabled?: boolean; audioEffects?: Array<{ type: string }> }) =>
        item.audioNoiseReductionEnabled &&
        item.audioEffects?.some((effect) => effect.type === "compressor"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
