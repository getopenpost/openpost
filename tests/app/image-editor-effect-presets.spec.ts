import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { authenticatePage, registerUser, createWorkspace } from "./helpers";

test.use({ hasTouch: true, actionTimeout: 15_000 });

test("workspace effect presets persist and apply with undo", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `effect-presets-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Effect presets");
  await authenticatePage(page, auth.token);
  let releaseBrandKit!: () => void;
  const brandKitReady = new Promise<void>((resolve) => {
    releaseBrandKit = resolve;
  });
  await page.route("**/image-editor/brand-kit?*", async (route) => {
    await brandKitReady;
    await route.continue();
  });
  await page.setViewportSize({ width: 1369, height: 850 });
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  releaseBrandKit();
  await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Shape\b/ }).click();
  await page.getByRole("button", { name: /^Effects/ }).click();
  await page.screenshot({ path: testInfo.outputPath("presets-before.png") });
  await page.getByRole("button", { name: "Add drop shadow", exact: true }).click();
  await page.getByLabel("Preset name", { exact: true }).fill("Launch shadow");
  await page.getByRole("button", { name: "Save new", exact: true }).click();
  await expect(page.getByText("Preset saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove drop shadow", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove drop shadow", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.getByRole("button", { name: "Add drop shadow", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
    "data-state",
    "saved",
  );
  await page.reload();
  await page
    .getByRole("tree", { name: "Layers", exact: true })
    .getByRole("treeitem")
    .first()
    .click();
  await page.getByRole("button", { name: /^Effects/ }).click();
  await page.getByRole("button", { name: "Choose an effect preset" }).click();
  await page.getByRole("option", { name: "Launch shadow", exact: true }).click();
  await page.getByRole("button", { name: "Remove drop shadow", exact: true }).click();
  await page.getByLabel("Preset name", { exact: true }).fill("Launch outline");
  await page.getByRole("button", { name: "Rename preset", exact: true }).click();
  await expect(page.getByText("Preset saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove drop shadow", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove drop shadow", exact: true }).click();
  await page.getByRole("button", { name: "Replace effects", exact: true }).click();
  await expect(page.getByText("Preset saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add drop shadow", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add drop shadow", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("presets-desktop.png") });
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
    const panel = page.getByRole("dialog");
    if (!(await panel.getByLabel("Preset name", { exact: true }).isVisible())) {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^Effects/ })
        .click();
    }
    await panel.getByRole("button", { name: "Choose an effect preset" }).click();
    await page.getByRole("option", { name: "Launch outline", exact: true }).click();
    await panel.getByLabel("Preset name", { exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.getByLabel("Preset name", { exact: true })).toBeVisible();
    const fieldBox = await panel.getByLabel("Preset name", { exact: true }).boundingBox();
    expect(fieldBox?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath(`presets-${width}-${colorScheme}.png`) });
  }
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "Delete preset", exact: true }).click();
  await expect(
    panel.getByText("Preset deleted. Applied layers keep their effects.", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Remove drop shadow", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
