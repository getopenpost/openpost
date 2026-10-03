import { expect, test } from "@playwright/test";

test("Select allows ruler guide dragging, one undo and persisted keyboard recovery", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("menubar").getByRole("menuitem", { name: "View", exact: true }).click();
  const rulers = page.getByRole("menuitemcheckbox", { name: "Rulers", exact: true });
  if ((await rulers.getAttribute("aria-checked")) !== "true") await rulers.click();
  await rulers.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  const stage = page.getByTestId("image-editor-stage");
  const vertical = page.getByRole("button", { name: "Drag to add a vertical guide", exact: true });
  const bounds = (await stage.boundingBox())!;
  const ruler = (await vertical.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.3, ruler.y + ruler.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + 90, { steps: 8 });
  await page.mouse.up();
  const guide = page.getByRole("button", { name: /Vertical guide at/ });
  await expect(guide).toHaveCount(1);
  await expect(guide).toHaveAccessibleName(/Vertical guide at 324 pixels/);
  await page.getByRole("banner").getByRole("button", { name: /^Undo/ }).click();
  await expect(guide).toHaveCount(0);
  await page.getByRole("banner").getByRole("button", { name: /^Redo/ }).click();
  await expect(guide).toHaveCount(1);
  await guide.focus();
  await guide.press("ArrowRight");
  await expect(guide).toHaveAccessibleName(/Vertical guide at 325 pixels/);
  await page.screenshot({ path: testInfo.outputPath("guide-select.png") });
  const saveStatus = page.getByRole("banner").locator('[role="status"][data-state]');
  await expect(saveStatus).toHaveAttribute("data-state", "saved");
  await expect(saveStatus).toContainText("Saved on this device");
  await page.reload();
  await expect(guide).toHaveAccessibleName(/Vertical guide at 325 pixels/);
  const horizontal = page.getByRole("button", {
    name: "Drag to add a horizontal guide",
    exact: true,
  });
  const side = (await horizontal.boundingBox())!;
  const reloaded = (await stage.boundingBox())!;
  await page.mouse.move(side.x + side.width / 2, reloaded.y + reloaded.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(reloaded.x + 90, reloaded.y + reloaded.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /Horizontal guide at 432 pixels/ })).toHaveCount(1);
});

test("Zoom tool click changes view around pointer and Alt reverses without authoring history", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const stage = page.getByTestId("image-editor-stage");
  await expect(stage).toBeVisible();
  const zoom = page.getByRole("button", { name: /^Zoom \d+%$/ });
  const percent = async () => Number.parseInt((await zoom.textContent()) ?? "", 10);
  const before = await percent();
  await page.keyboard.press("z");
  await expect(page.getByRole("button", { name: "Zoom", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const bounds = (await stage.boundingBox())!;
  const x = bounds.x + bounds.width * 0.35;
  const y = bounds.y + bounds.height * 0.4;
  await page.mouse.click(x, y);
  await expect.poll(percent).toBe(before + 10);
  const enlarged = (await stage.boundingBox())!;
  expect(enlarged.x + enlarged.width * 0.35).toBeCloseTo(x, 0);
  expect(enlarged.y + enlarged.height * 0.4).toBeCloseTo(y, 0);
  await page.keyboard.down("Alt");
  await page.mouse.click(x, y);
  await page.keyboard.up("Alt");
  await expect.poll(percent).toBe(before);
  await expect(page.getByRole("banner").getByRole("button", { name: /^Undo/ })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("zoom-tool.png") });
  await page.keyboard.press("ControlOrMeta+0");
  await expect.poll(percent).toBe(before);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value === "dark"),
      scheme,
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await zoom.click();
      const fitted = await percent();
      const rect = (await stage.boundingBox())!;
      await page.mouse.click(rect.x + rect.width * 0.35, rect.y + rect.height * 0.4);
      await expect.poll(percent).toBe(fitted + 10);
      await page.screenshot({ path: testInfo.outputPath(`zoom-${width}-${scheme}.png`) });
      await zoom.click();
      await expect.poll(percent).toBe(fitted);
    }
  }
});
