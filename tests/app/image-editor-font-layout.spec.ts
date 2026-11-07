import { expect, test } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("live font changes preserve saved multiline canvas layout", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `font-layout-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Font layout");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post("/api/v1/image-editor/designs", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Font layout",
      preset_key: "custom",
      width_px: 1080,
      height_px: 1080,
    },
  });
  expect(created.ok()).toBe(true);
  const design = await created.json();
  const text = "Font audit café é 👋\nمرحبا بالعالم";
  design.document.pages[0].layers = [
    {
      id: randomUUID(),
      name: "Multiline text",
      type: "text",
      visible: true,
      locked: false,
      opacity: 1,
      transform: {
        x: 80,
        y: 80,
        width: 600,
        height: 130,
        rotation: 0,
        flip_x: false,
        flip_y: false,
      },
      text: {
        text,
        font_family: "Arial",
        font_weight: 400,
        font_style: "normal",
        font_size: 90,
        color: "#000000",
        align: "left",
        line_height: 1.1,
        letter_spacing: 0,
        stroke_width: 0,
        shadow: { color: "#00000000", blur: 0, offset_x: 0, offset_y: 0 },
        wrap: "word",
        curve: { type: "none", strength: 0.65, offset: 0, reverse: false },
      },
    },
  ];
  expect(
    (
      await request.patch(`/api/v1/image-editor/designs/${design.id}`, {
        headers,
        data: { expected_revision: design.revision, document: design.document },
      })
    ).ok(),
  ).toBe(true);
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/image-editor/${design.id}`);
  await page
    .getByRole("treeitem", { name: /Multiline text/ })
    .click({ position: { x: 65, y: 12 } });
  await page.getByRole("button", { name: "Font family", exact: true }).click();
  await page.getByRole("button", { name: "Georgia", exact: true }).click();
  const read = async () =>
    (await (await request.get(`/api/v1/image-editor/designs/${design.id}`, { headers })).json())
      .document.pages[0].layers[0].text;
  await expect.poll(async () => (await read()).font_family).toBe("Georgia");
  expect((await read()).text).toBe(text);
  const canvas = page.locator("canvas.lower-canvas");
  const pixels = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    // Read the full artwork without CSS scaling or the floating view toolbar.
    const png = await canvas.evaluate((element: HTMLCanvasElement) =>
      element.toDataURL("image/png"),
    );
    const rendered = await sharp(Buffer.from(png.split(",")[1], "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      width: rendered.info.width,
      height: rendered.info.height,
      hash: createHash("sha256").update(rendered.data).digest("hex"),
    };
  };
  // Selection controls are painted into Fabric's lower canvas too. Compare
  // artwork in the same unselected state as a freshly opened design.
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.getByRole("treeitem", { name: /Multiline text/ })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  const live = await pixels();
  await canvas.screenshot({ path: testInfo.outputPath("font-live.png") });
  await page.reload();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const cold = await pixels();
  await canvas.screenshot({ path: testInfo.outputPath("font-cold.png") });
  await testInfo.attach("font-pixels.json", {
    body: JSON.stringify({ live, cold }),
    contentType: "application/json",
  });
  expect(live).toEqual(cold);
  expect((await read()).text).toBe(text);
  for (const colorScheme of ["light"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      colorScheme === "dark",
    );
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
      await pixels();
      await page.screenshot({ path: testInfo.outputPath(`font-${width}-${colorScheme}.png`) });
    }
  }
});
