import { expect, test } from "@playwright/test";

test("guide dialog retains invalid positions and admits the selected page axis range", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "How-to carousel", exact: true }).click();
  const open = async () => {
    await page.getByRole("menubar").getByRole("menuitem", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: /Add guide/ }).click();
    await expect(
      page.getByRole("dialog").getByRole("radio", { name: "Vertical", exact: true }),
    ).toBeFocused();
  };
  await open();
  const dialog = page.getByRole("dialog");
  const position = dialog.getByRole("spinbutton", { name: "Position in pixels", exact: true });
  const add = dialog.getByRole("button", { name: "Add guide", exact: true });
  const guides = page.getByRole("button", { name: /(?:Vertical|Horizontal) guide at/ });
  await position.fill("-20");
  await position.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(position).toHaveValue("-20");
  await expect(guides).toHaveCount(0);
  await expect(add).toBeDisabled();
  await expect(position).toHaveAttribute("aria-invalid", "true");
  await expect(position).toHaveAccessibleDescription("Enter a position from 0 to 1080 pixels.");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value === "dark"),
      scheme,
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`guide-${width}-${scheme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await position.fill("1200");
  await expect(add).toBeDisabled();
  await dialog.getByRole("radio", { name: "Horizontal", exact: true }).click();
  await expect(position).toHaveAccessibleDescription("Enter a position from 0 to 1350 pixels.");
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("button", { name: /Horizontal guide at 1200 pixels/ })).toBeVisible();
  await open();
  await position.fill("");
  await expect(add).toBeDisabled();
  await position.press("Enter");
  await expect(dialog).toBeVisible();
  await position.fill("540.5");
  await expect(add).toBeEnabled();
  await position.press("Enter");
  await expect(dialog).toHaveCount(0);
  const vertical = page.getByRole("button", { name: /Vertical guide at/ });
  // Guide labels round pixels for speech; the authored position remains fractional after reload.
  await expect(vertical).toHaveAccessibleName(/Vertical guide at 541 pixels/);
  const stage = page.getByTestId("image-editor-stage");
  const bounds = (await stage.boundingBox())!;
  const guideBounds = (await vertical.boundingBox())!;
  expect(((guideBounds.x + guideBounds.width / 2 - bounds.x) / bounds.width) * 1080).toBeCloseTo(
    540.5,
    0,
  );
  const saveStatus = page.getByRole("banner").locator('[role="status"][data-state]');
  await expect(saveStatus).toHaveAttribute("data-state", "saved");
  await expect(saveStatus).toContainText("Saved on this device");
  await page.reload();
  await expect(vertical).toHaveAccessibleName(/Vertical guide at 541 pixels/);
  const cold = (await stage.boundingBox())!;
  const coldGuide = (await vertical.boundingBox())!;
  expect(((coldGuide.x + coldGuide.width / 2 - cold.x) / cold.width) * 1080).toBeCloseTo(540.5, 1);
});
