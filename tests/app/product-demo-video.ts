import { expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createVideoEditorProject,
  fixtureDirectory,
  installLocalVideoWorkspace,
} from "./product-capture-fixtures";
import { record } from "./product-demo-recording";

export async function videoEditorDemo(page: Page) {
  const files = await Promise.all(
    [
      {
        name: "study-sos-demo.mp4",
        path: join(fixtureDirectory, "study-sos-demo.mp4"),
        type: "video/mp4",
      },
      {
        name: "tutorial-music.wav",
        path: "tests/app/fixtures/product-demos/tutorial-music.wav",
        type: "audio/wav",
      },
    ].map(async (file) => ({ ...file, bytes: (await readFile(file.path)).toString("base64") })),
  );
  await installLocalVideoWorkspace(page, files[0].bytes);
  await page.addInitScript((files) => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () =>
        files.map((source) => ({
          kind: "file",
          name: source.name,
          getFile: async () =>
            new File([Uint8Array.from(atob(source.bytes), (c) => c.charCodeAt(0))], source.name, {
              type: source.type,
            }),
        })),
    });
  }, files);
  await createVideoEditorProject(page, "Study SOS · YouTube");
  const clips = page.locator("[data-timeline-item-id]");
  const clip = (name: string) =>
    clips.filter({ has: page.getByRole("button", { name: new RegExp(`^${name}\\. Drag`) }) });
  const seek = async (frame: number) => {
    const ruler = page.getByRole("slider", { name: "Timeline playhead", exact: true });
    await ruler.focus();
    await ruler.press("Home");
    for (let n = 0; n < Math.floor(frame / 10); n++) await ruler.press("Shift+ArrowRight");
    for (let n = 0; n < frame % 10; n++) await ruler.press("ArrowRight");
  };
  let footage: Locator;
  const assets = page.getByRole("navigation", { name: "Assets", exact: true });
  const trimEnd = async (name: string, frame: number) => {
    await clip(name)
      .getByRole("button", { name: /Drag to move/ })
      .click();
    await seek(frame);
    const selected = clip(name);
    const box = (await selected.boundingBox())!;
    const ruler = page.getByRole("slider", { name: "Timeline playhead", exact: true });
    const start = (await ruler.boundingBox())!.x + 180;
    const end = selected.getByRole("button", { name: "Trim clip end", exact: true });
    const handle = (await end.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 + start + frame * 4 - box.x - box.width,
      handle.y + handle.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect.poll(async () => (await selected.boundingBox())!.width).toBeLessThan(box.width);
  };
  await record(page, "video-editor", [
    {
      title: "Start with an opening",
      seconds: 4,
      hold: 1200,
      run: async () => {
        await assets.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name: "Backgrounds", exact: true }).click();
        await page.getByRole("searchbox", { name: "Search backgrounds" }).fill("Sunset mesh");
        await page.getByRole("button", { name: "Sunset mesh", exact: true }).click();
        await trimEnd("Sunset mesh", 60);
        await seek(0);
      },
    },
    {
      title: "Give it a title",
      seconds: 4,
      hold: 1200,
      run: async () => {
        await page.getByRole("button", { name: "Add layer", exact: true }).click();
        await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
        const inspector = page.locator("#video-editor-tools-panel");
        await inspector.locator("textarea").fill("STUDY SOS");
        await inspector.locator("textarea").press("Tab");
        await inspector.getByRole("button", { name: "Browse styles", exact: true }).click();
        await page.getByRole("button", { name: "Apply Poster", exact: true }).click();
        await trimEnd("STUDY SOS", 60);
        await seek(0);
      },
    },
    {
      title: "Animate the title in and out",
      seconds: 5,
      hold: 1200,
      run: async () => {
        await clip("STUDY SOS")
          .getByRole("button", { name: /Drag to move/ })
          .click();
        const inspector = page.locator("#video-editor-tools-panel");
        await inspector.getByRole("tab", { name: "Animation", exact: true }).click();
        const search = inspector.getByRole("searchbox", { name: "Search animation", exact: true });
        await search.fill("Pop in");
        await inspector.getByRole("button", { name: "Replace Pop in", exact: true }).click();
        await inspector.getByRole("button", { name: "Add", exact: true }).click();
        await search.fill("Fade out");
        await inspector.getByRole("button", { name: "Add Fade out", exact: true }).click();
        await seek(30);
      },
    },
    {
      title: "Bring in footage and music",
      seconds: 5,
      hold: 1200,
      run: async () => {
        await seek(60);
        await assets.getByRole("tab", { name: "Media pool", exact: true }).click();
        await page.getByRole("button", { name: "Import media", exact: true }).click();
        await page.getByRole("button", { name: /Place on timeline: study-sos-demo\.mp4/ }).click();
        await expect(page.locator("[data-media-placement-status]")).toBeVisible();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(clip("study-sos-demo.mp4")).toHaveCount(1);
        await page.keyboard.press("Escape");
        footage = page.locator(
          `[data-timeline-item-id="${await clip("study-sos-demo.mp4").getAttribute("data-timeline-item-id")}"]`,
        );
        await seek(0);
        await page.getByRole("button", { name: /Place on timeline: tutorial-music\.wav/ }).click();
        await page.keyboard.press("Enter");
        await expect(clip("tutorial-music.wav")).toHaveCount(1);
        await page.keyboard.press("Escape");
        await page.mouse.move(800, 300);
        await expect(
          page.getByText("Choose a track and click to place this clip. Escape cancels.", {
            exact: true,
          }),
        ).toHaveCount(0, { timeout: 10_000 });
      },
    },
    {
      title: "Cut and blend the footage",
      seconds: 6,
      hold: 1200,
      run: async () => {
        await seek(180);
        await footage.getByRole("button", { name: /Drag to move/ }).click({ button: "right" });
        await page.getByRole("menuitem", { name: /Split at playhead/ }).click();
        await expect(clip("study-sos-demo.mp4")).toHaveCount(2);
        const second = clip("study-sos-demo.mp4").last();
        await footage.getByRole("button", { name: /Drag to move/ }).click();
        await seek(165);
        await page.getByRole("button", { name: "Trim end to playhead", exact: true }).click();
        await second.getByRole("button", { name: /Drag to move/ }).click();
        await seek(195);
        await page.getByRole("button", { name: "Trim start to playhead", exact: true }).click();
        const left = (await footage.boundingBox())!;
        const right = (await second.boundingBox())!;
        await page.mouse.move(right.x + 48, right.y + right.height / 2);
        await page.mouse.down();
        await page.mouse.move(left.x + left.width + 48, right.y + right.height / 2, { steps: 10 });
        await page.mouse.up();
        await expect
          .poll(async () => {
            const a = (await footage.boundingBox())!;
            const b = (await second.boundingBox())!;
            return Math.abs(a.x + a.width - b.x);
          })
          .toBeLessThanOrEqual(4);
        await page.getByRole("tab", { name: "Transition", exact: true }).click();
        await page.getByRole("button", { name: "Cross dissolve", exact: true }).click();
        await expect(page.locator("[data-transition-id]")).toHaveCount(1);
        await seek(165);
      },
    },
    {
      title: "Add a little texture",
      seconds: 5,
      hold: 1200,
      run: async () => {
        await footage.getByRole("button", { name: /Drag to move/ }).click();
        await page
          .getByRole("tablist", { name: "Assets", exact: true })
          .getByRole("tab", { name: "Effects", exact: true })
          .click();
        const search = page.getByRole("searchbox", { name: "Search effects", exact: true });
        await search.fill("Vignette");
        await page.locator('[data-effect-catalog-id="gpu-vignette"]').click();
        await page.waitForTimeout(300);
        await search.fill("Glow");
        await page.locator('[data-effect-catalog-id="gpu-glow"]').click();
        await seek(115);
      },
    },
    {
      title: "Warm up the color",
      seconds: 5,
      hold: 1200,
      run: async () => {
        await page.getByRole("tab", { name: "Color", exact: true }).click();
        const wheel = page.getByRole("slider", { name: "Gain color wheel", exact: true });
        await expect(wheel).toBeVisible();
        const box = (await wheel.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.46, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        await page.getByRole("tab", { name: "Curves", exact: true }).click();
        const curve = page.getByRole("group", { name: "Master curve editor", exact: true });
        await expect(curve).toBeVisible();
        const graph = (await curve.boundingBox())!;
        await page.mouse.click(graph.x + graph.width * 0.6, graph.y + graph.height * 0.35);
      },
    },
    {
      title: "Preview the finished edit",
      seconds: 6,
      hold: 500,
      run: async () => {
        await page.getByRole("tab", { name: "Edit", exact: true }).click();
        await seek(0);
        await page.getByRole("button", { name: "Play", exact: true }).click();
        await page.waitForTimeout(5500);
        await page.getByRole("button", { name: "Pause", exact: true }).click();
      },
    },
    {
      title: "Ready for YouTube",
      seconds: 3,
      hold: 1800,
      run: async () => {
        await page.getByRole("banner").getByRole("button", { name: "Export", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Export video" })).toBeVisible();
      },
    },
  ]);
}
