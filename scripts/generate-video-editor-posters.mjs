import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Run against the frontend development server so Vite resolves the renderer's imports.
const baseURL = process.env.OPENPOST_PREVIEW_URL ?? "http://localhost:5173";
const output = fileURLToPath(new URL("../apps/web/static/video-editor-previews/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});
try {
  const page = await browser.newPage();
  await page.route("**/__poster_capture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto(`${baseURL}/__poster_capture`);
  const entries = await page.evaluate(async () => {
    const { BACKGROUND_PRESETS } = await import("/src/lib/video-editor/backgrounds/presets.ts");
    const { EFFECT_POSTERS } =
      await import("/src/lib/video-editor/effects/preview/catalog-posters.ts");
    return [
      ...BACKGROUND_PRESETS.map((preset) => ({
        id: `background-${preset.id}`,
        background: preset.background,
      })),
      ...EFFECT_POSTERS,
    ];
  });
  for (const entry of entries) {
    const data = await page.evaluate(async (entry) => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      if (entry.background) {
        if (entry.background.kind === "shader") {
          const { ShaderBackgroundRenderer } =
            await import("/src/lib/video-editor/backgrounds/shader-renderer.ts");
          const renderer = new ShaderBackgroundRenderer();
          try {
            context.drawImage(renderer.render(entry.background, 320, 180, 0), 0, 0);
          } finally {
            renderer.dispose();
          }
        } else {
          const { renderBackgroundCpu } =
            await import("/src/lib/video-editor/backgrounds/render.ts");
          renderBackgroundCpu(context, entry.background, 320, 180);
        }
      } else {
        const { getEffectPreviewPoster } =
          await import("/src/lib/video-editor/effects/preview/effect-preview-engine.ts");
        const frame = await getEffectPreviewPoster(entry.effects);
        if (!frame || frame.mode === "fallback") throw new Error(`Cannot render ${entry.id}`);
        context.drawImage(frame.canvas, 0, 0, 320, 180);
      }
      return canvas.toDataURL("image/webp", 0.88).split(",")[1];
    }, entry);
    await writeFile(`${output}${entry.id}.webp`, Buffer.from(data, "base64"));
  }
  console.info(`Rendered ${entries.length} Video Editor posters into ${output}`);
} finally {
  await browser.close();
}
