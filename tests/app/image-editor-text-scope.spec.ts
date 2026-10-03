import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("text selection explains whole-layer font controls", async ({ page, request }, testInfo) => {
  const auth = await registerUser(request, `font-layout-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Text scope");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post("/api/v1/image-editor/designs", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Text scope",
      preset_key: "custom",
      width_px: 1080,
      height_px: 1080,
    },
  });
  expect(created.ok()).toBe(true);
  const design = await created.json();
  const text = "Hello world";
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
  const textField = page.getByRole("textbox", { name: "Text", exact: true });
  await textField.focus();
  for (let i = 0; i < 20; i++) await textField.press("ArrowLeft");
  for (let i = 0; i < 5; i++) await textField.press("Shift+ArrowRight");
  await expect(page.getByText("5 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Font family", exact: true }).click();
  await page.getByRole("button", { name: "Georgia", exact: true }).click();
  const read = async () =>
    (await (await request.get(`/api/v1/image-editor/designs/${design.id}`, { headers })).json())
      .document.pages[0].layers[0].text;
  await expect.poll(async () => (await read()).font_family).toBe("Georgia");
  expect((await read()).text).toBe(text);
  await expect(page.getByText("5 selected", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Font family and size affect the whole text layer.", { exact: true }),
  ).toBeVisible();
  const hint = "Font family and size affect the whole text layer.";
  await expect(
    page.getByRole("button", { name: "Font family", exact: true }),
  ).toHaveAccessibleDescription(hint);
  await expect(
    page.getByRole("spinbutton", { name: "Size", exact: true }),
  ).toHaveAccessibleDescription(hint);
  await page.getByRole("spinbutton", { name: "Size", exact: true }).fill("72");
  await expect.poll(async () => (await read()).font_size).toBe(72);
  expect((await read()).text).toBe(text);
  await textField.focus();
  await textField.press("ArrowLeft");
  const caret = await textField.evaluate((field) => {
    if (!(field instanceof HTMLTextAreaElement)) throw new Error("Text field unavailable");
    return { start: field.selectionStart, end: field.selectionEnd };
  });
  expect(caret.start).toBe(caret.end);
  await testInfo.attach("collapsed-caret.json", {
    body: JSON.stringify(caret),
    contentType: "application/json",
  });
  await expect(page.getByText(hint, { exact: true })).not.toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      colorScheme === "dark",
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 1024) await page.getByRole("button", { name: "Properties", exact: true }).click();
      const surface =
        width < 1024 ? page.getByRole("dialog", { name: "Properties", exact: true }) : page;
      const field = surface.getByRole("textbox", { name: "Text", exact: true });
      await field.focus();
      for (let i = 0; i < 20; i++) await field.press("ArrowLeft");
      for (let i = 0; i < 5; i++) await field.press("Shift+ArrowRight");
      await expect(surface.getByText(hint, { exact: true })).toBeVisible();
      await expect(
        surface.getByRole("button", { name: "Font family", exact: true }),
      ).toHaveAccessibleDescription(hint);
      await page.screenshot({ path: testInfo.outputPath(`scope-${width}-${colorScheme}.png`) });
      if (width < 1024) {
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("dialog", { name: "Properties", exact: true }),
        ).not.toBeVisible();
      }
    }
  }
});
