import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { authenticatePage, registerUser, createWorkspace } from "./helpers";

test.use({ hasTouch: true, actionTimeout: 15_000 });

test("mixed page sizes persist and Resize design also resets pages to the default size", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const auth = await registerUser(request, `mixed-pages-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Mixed pages");
  const headers = { Authorization: `Bearer ${auth.token}` };
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1369, height: 850 });
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const strip = page.getByTestId("image-editor-page-strip");
  await strip.getByRole("button", { name: "Expand pages", exact: true }).click();
  await strip.getByRole("button", { name: "Duplicate page", exact: true }).click();
  await strip.getByRole("button", { name: "Resize page", exact: true }).click();
  const resizePage = page.getByRole("dialog", { name: "Resize page", exact: true });
  await resizePage.getByRole("spinbutton", { name: "Width", exact: true }).fill("720");
  await resizePage.getByRole("spinbutton", { name: "Height", exact: true }).fill("1280");
  await resizePage.getByRole("button", { name: "Resize", exact: true }).click();
  const sizes = async () => {
    const data = await (
      await request.get(`/api/v1/image-editor/designs/${id}`, { headers })
    ).json();
    return data.document.pages.map((item: { width_px?: number; height_px?: number }) => [
      item.width_px ?? data.document.width_px,
      item.height_px ?? data.document.height_px,
    ]);
  };
  await expect.poll(sizes).toEqual([
    [1080, 1080],
    [720, 1280],
  ]);
  for (const [width, colorScheme] of [
    [390, "light"],
    [320, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const expand = strip.getByRole("button", { name: "Expand pages", exact: true });
    if (await expand.isVisible()) await expand.click();
    const resize = strip.getByRole("button", { name: "Resize page", exact: true });
    await resize.scrollIntoViewIfNeeded();
    await expect(resize).toBeInViewport();
    const box = await resize.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath(`mixed-pages-${width}-${colorScheme}.png`) });
  }
  await page.setViewportSize({ width: 1369, height: 850 });
  await page.reload();
  await expect(strip.getByRole("button", { name: /720 × 1280 px/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mixed-pages-desktop.png") });
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Resize design", exact: true }).click();
  const resizeDesign = page.getByRole("dialog", { name: "Resize design", exact: true });
  await expect(resizeDesign.getByRole("spinbutton", { name: "Width", exact: true })).toHaveValue(
    "1080",
  );
  await resizeDesign.getByRole("button", { name: "Resize", exact: true }).click();
  await expect.poll(sizes).toEqual([
    [1080, 1080],
    [1080, 1080],
  ]);
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect.poll(sizes).toEqual([
    [1080, 1080],
    [720, 1280],
  ]);
  await strip.getByRole("button", { name: /1080 × 1080 px/ }).click();
  await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Shape\b/ }).click();
  await page.getByRole("menubar").getByRole("menuitem", { name: "Select", exact: true }).click();
  await page.getByRole("menuitem", { name: "Select layer alpha", exact: true }).click();
  const selection = page.getByTestId("image-editor-pixel-selection");
  await expect(selection).toHaveAttribute("data-active", "true");
  const transfer = await page.evaluateHandle(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2255cc";
    context.fillRect(0, 0, 64, 64);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
    const data = new DataTransfer();
    data.items.add(new File([blob], "page-drop.png", { type: "image/png" }));
    return data;
  });
  const target = strip.getByRole("button", { name: /720 × 1280 px/ });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  await expect(target).toHaveAttribute("aria-current", "page");
  await expect(selection).toHaveAttribute("data-active", "false");
  await expect
    .poll(async () => {
      const data = await (
        await request.get(`/api/v1/image-editor/designs/${id}`, { headers })
      ).json();
      return data.document.pages[1].layers.map((layer: { type: string }) => layer.type);
    })
    .toEqual(["image"]);
});

test("text range weight survives cloud save and reload without changing the whole layer", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `text-ranges-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Text ranges");
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1369, height: 850 });
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Text\b/ }).click();
  const text = page.getByRole("textbox", { name: "Text", exact: true });
  await text.fill("Launch faster today");
  await text.press("ControlOrMeta+A");
  await text.press("ArrowLeft");
  for (let index = 0; index < 6; index++) await text.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "Weight", exact: true }).click();
  await page.getByRole("option", { name: "400 · Regular", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`/api/v1/image-editor/designs/${id}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const data = await response.json();
      return data.document.pages[0].layers[0]?.text;
    })
    .toMatchObject({
      text: "Launch faster today",
      font_weight: 700,
      runs: [{ start: 0, end: 6, font_weight: 400 }],
    });
  await page.reload();
  await page
    .getByRole("tree", { name: "Layers", exact: true })
    .getByRole("treeitem")
    .first()
    .click();
  await expect(text).toHaveValue("Launch faster today");
  await text.press("ControlOrMeta+A");
  await text.press("ArrowLeft");
  for (let index = 0; index < 6; index++) await text.press("Shift+ArrowRight");
  await expect(page.getByRole("button", { name: "Weight", exact: true })).toContainText(
    "400 · Regular",
  );
  await page.screenshot({ path: testInfo.outputPath("text-range-desktop.png") });
  for (const [width, colorScheme] of [
    [390, "light"],
    [320, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    if (!(await page.getByRole("dialog").isVisible())) {
      await page
        .getByRole("navigation", { name: "OpenPost Image Editor tools", exact: true })
        .getByRole("button", { name: "Properties", exact: true })
        .click();
    }
    await expect(
      page.getByRole("dialog").getByRole("textbox", { name: "Text", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath(`text-range-${width}-${colorScheme}.png`) });
  }
  expect(errors).toEqual([]);
});
