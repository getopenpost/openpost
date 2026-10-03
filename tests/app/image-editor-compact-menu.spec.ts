import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

test("compact Image menu groups commands with keyboard and touch return paths", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1024, height: 740 });
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "How-to carousel", exact: true }).click();
  const layers = page.getByRole("tree", { name: "Layers", exact: true }).getByRole("treeitem");
  await expect(layers).toHaveCount(6);
  await page.setViewportSize({ width: 320, height: 740 });
  const more = page.getByRole("banner").getByRole("button", { name: "More actions", exact: true });
  await more.tap();
  const menu = page.getByRole("menu");
  await page.screenshot({ path: testInfo.outputPath("compact-initial.png") });
  await expect(menu.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible();
  expect(await menu.getByRole("menuitem").count()).toBeLessThanOrEqual(12);
  expect(await menu.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  expect(
    (await menu.getByRole("menuitem", { name: "Tools", exact: true }).boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  const edit = menu.getByRole("menuitem", { name: "Edit", exact: true });
  await edit.focus();
  await page.keyboard.press("Enter");
  const back = menu.getByRole("menuitem", { name: "Back", exact: true });
  await expect(back).toBeFocused();
  await back.press("Enter");
  await expect(edit).toBeFocused();
  await edit.tap();
  await menu.getByRole("menuitem", { name: /^Duplicate/ }).click();
  await page.setViewportSize({ width: 1024, height: 740 });
  await expect(layers).toHaveCount(7);
  await page.setViewportSize({ width: 320, height: 740 });
  await more.tap();
  await edit.tap();
  await menu.getByRole("menuitem", { name: /^Undo/ }).click();
  await expect(menu).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 740 });
  await expect(layers).toHaveCount(6);
  await page.setViewportSize({ width: 320, height: 740 });
  await more.tap();
  await menu.getByRole("menuitem", { name: "Tools", exact: true }).tap();
  await back.tap();
  await expect(menu.getByRole("menuitem", { name: "Tools", exact: true })).toBeFocused();
  await menu.getByRole("menuitem", { name: "Tools", exact: true }).tap();
  await page.screenshot({ path: testInfo.outputPath("compact-tools-320.png") });
  await menu.getByRole("menuitem", { name: /^Hand/ }).tap();
  await expect(menu).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 740 });
  await expect(page.getByRole("button", { name: "Hand", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value === "dark"),
      scheme,
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 740 });
      await more.tap();
      await expect(edit).toBeVisible();
      const bounds = (await menu.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`compact-${width}-${scheme}.png`) });
      await menu.getByRole("menuitem", { name: "View", exact: true }).tap();
      await expect(back).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(more).toBeFocused();
    }
  }
  await page.setViewportSize({ width: 1280, height: 740 });
  await layers.first().click();
  const desktopEdit = page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "Edit", exact: true });
  await desktopEdit.click();
  await menu.getByRole("menuitem", { name: /^Duplicate/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(layers).toHaveCount(7);
  await desktopEdit.click();
  await menu.getByRole("menuitem", { name: /^Undo/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(layers).toHaveCount(6);
  expect(errors).toEqual([]);
});
