import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { record, outputDirectory } from "./product-demo-recording";
import { uploadImageFixture } from "./product-capture-fixtures";

import type {
  ImageEditorDocument,
  ImageEditorLayer,
} from "../../apps/web/src/lib/image-editor/types";

const assets = "tests/app/fixtures/product-demos";

export async function imageEditorDemo({
  page,
  request,
  workspaceID,
  token,
}: {
  page: Page;
  request: APIRequestContext;
  workspaceID: string;
  token: string;
}) {
  const headers = { Authorization: `Bearer ${token}` };
  const font = await request.post("/api/v1/media/upload", {
    headers,
    multipart: {
      workspace_id: workspaceID,
      source: "upload",
      asset_kind: "brand_font",
      file: {
        name: "Bangers-Regular.ttf",
        mimeType: "font/ttf",
        buffer: await readFile(join(assets, "Bangers-Regular.ttf")),
      },
    },
  });
  expect(font.ok(), await font.text()).toBe(true);
  const fontID = (await font.json()).id;
  const kit = await request.put("/api/v1/image-editor/brand-kit", {
    headers,
    data: {
      workspace_id: workspaceID,
      name: "RISC-V tutorial",
      colors: [],
      text_styles: [],
      backgrounds: [],
      fonts: [
        {
          media_id: fontID,
          family: "Bangers",
          weight: 400,
          style: "normal",
          license_acknowledged: true,
        },
      ],
    },
  });
  expect(kit.ok(), await kit.text()).toBe(true);
  const logoID = await uploadImageFixture(
    request,
    token,
    workspaceID,
    "risc-v-logo.png",
    await readFile(join(assets, "risc-v-logo.png")),
  );
  await page.route("**/api/v1/media?**", (route) =>
    route.fulfill({
      json: {
        total: 1,
        limit: 40,
        offset: 0,
        media: [
          {
            id: logoID,
            workspace_id: workspaceID,
            original_filename: "risc-v-logo.png",
            mime_type: "image/png",
            width: 1100,
            height: 218,
            size: 143144,
            url: `/media/${logoID}`,
            thumbnail_url: `/media/${logoID}`,
            processing_status: "ready",
            processing_progress: 100,
            created_at: "2026-08-20T13:00:00Z",
            tags: [],
          },
        ],
      },
    }),
  );
  await page.goto(`/image-editor/new?workspace=${workspaceID}`);
  await expect(page.getByRole("heading", { name: "Choose a format" })).toBeVisible();
  const properties = page.locator(".image-editor-inspector");
  const stage = page.getByTestId("image-editor-stage");
  const design = async (): Promise<ImageEditorDocument> => {
    const id = new URL(page.url()).pathname.split("/").at(-1);
    return (await (await request.get(`/api/v1/image-editor/designs/${id}`, { headers })).json())
      .document;
  };
  const layer = async (text: string) => {
    let selected: ImageEditorLayer | undefined;
    await expect
      .poll(async () => {
        selected = (await design()).pages[0].layers.find(
          (item) => item.text?.text === text || item.name === text,
        );
        return Boolean(selected);
      })
      .toBe(true);
    return selected!;
  };
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const box = (await stage.boundingBox())!;
    const scale = box.width / 1280;
    await page.mouse.move(box.x + from.x * scale, box.y + from.y * scale);
    await page.waitForTimeout(250);
    await page.mouse.down();
    for (let step = 1; step <= 18; step++) {
      await page.mouse.move(
        box.x + (from.x + ((to.x - from.x) * step) / 18) * scale,
        box.y + (from.y + ((to.y - from.y) * step) / 18) * scale,
      );
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    await page.waitForTimeout(450);
  };
  const color = async (name: string, hex: string) => {
    await properties.getByRole("button", { name, exact: true }).click();
    await page.getByRole("textbox", { name: "Hex color", exact: true }).fill(hex);
    await page.getByRole("textbox", { name: "Hex color", exact: true }).press("Enter");
    await page.keyboard.press("Escape");
  };
  const title = async (text: string, fontSize: number, x: number, y: number, hex = "#FFFFFF") => {
    await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Text\b/ }).click();
    const input = page.getByRole("textbox", { name: "Text", exact: true });
    await input.fill(text);
    await input.press("End");
    await input.press("Tab");
    await page.getByRole("button", { name: "Font family", exact: true }).click();
    await page.getByRole("button", { name: "Bangers", exact: true }).click();
    await color("Color", hex);
    const current = await layer(text);
    const t = current.transform;
    // Fabric's one-line text box includes its font ascent and descent; the
    // document's authored height can be shorter than the visible resize box.
    const height = current.text!.font_size * 1.13;
    const factor = fontSize / current.text!.font_size;
    await drag(
      { x: t.x + t.width, y: t.y + height },
      { x: t.x + t.width * factor, y: t.y + height * factor },
    );
    await expect.poll(async () => (await layer(text)).transform.width).toBeGreaterThan(t.width);
    await properties.getByRole("spinbutton", { name: "Size", exact: true }).fill(String(fontSize));
    await properties.getByRole("spinbutton", { name: "Size", exact: true }).press("Tab");
    await properties.getByRole("button", { name: "Left", exact: true }).click();
    await expect.poll(async () => (await layer(text)).text!.font_size).toBe(fontSize);
    const resized = await layer(text);
    await drag(
      {
        x: resized.transform.x + resized.text!.font_size * 0.25,
        y: resized.transform.y + resized.text!.font_size * 0.5,
      },
      { x: x + resized.text!.font_size * 0.25, y: y + resized.text!.font_size * 0.5 },
    );
    await page.keyboard.press("Escape");
  };
  await record(page, "image-editor", [
    {
      title: "Start with a blank thumbnail",
      seconds: 5,
      run: async () => {
        await page.getByRole("button", { name: /YouTube thumbnail/ }).click();
        await expect(stage).toBeVisible();
        await page
          .getByRole("textbox", { name: "Design title" })
          .fill("Programa em RISC-V em 30 minutos");
        await color("Background color", "#1F1F1F");
      },
    },
    {
      title: "Drag in your logo",
      seconds: 8,
      run: async () => {
        await page.getByRole("button", { name: "Add", exact: true }).first().click();
        const logo = page.getByRole("button", { name: /risc-v-logo\.png/ });
        await expect(logo).toBeVisible();
        const target = (await stage.boundingBox())!;
        await logo.dragTo(stage, { targetPosition: { x: target.width / 2, y: target.height / 2 } });
        await page.getByRole("button", { name: "Close", exact: true }).last().click();
        await expect.poll(async () => (await design()).pages[0].layers.length).toBe(1);
        const logoLayer = await layer("risc-v-logo.png");
        const t = logoLayer.transform;
        await drag({ x: t.x + t.width, y: t.y + t.height }, { x: t.x + 1100, y: t.y + 218 });
        await expect
          .poll(async () => (await layer("risc-v-logo.png")).transform.width)
          .toBeGreaterThan(t.width);
        const scaled = (await layer("risc-v-logo.png")).transform;
        await drag(
          { x: scaled.x + scaled.width / 2, y: scaled.y + scaled.height / 2 },
          { x: 90 + scaled.width / 2, y: 250 + scaled.height / 2 },
        );
        await page.keyboard.press("Escape");
      },
    },
    {
      title: "Size and place the heading",
      seconds: 8,
      run: () => title("PROGRAMA EM", 171, 218, 49),
    },
    { title: "Build the second line", seconds: 6, run: () => title("EM", 159, 223, 509) },
    {
      title: "Make the number stand out",
      seconds: 7,
      run: () => title("30", 209, 405, 462, "#FF8500"),
    },
    { title: "Finish the layout", seconds: 7, run: () => title("MINUTOS", 160, 640, 509) },
    {
      title: "Download your thumbnail",
      seconds: 5,
      hold: 2500,
      run: async () => {
        await page.getByRole("button", { name: "Export", exact: true }).click();
        const dialog = page.getByRole("dialog");
        const download = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Download", exact: true }).click();
        await (await download).saveAs(join(outputDirectory, "thumbnail.png"));
      },
    },
  ]);
}
