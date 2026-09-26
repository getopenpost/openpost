import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { authenticatePage, registerUser, createWorkspace } from "./helpers";

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
  await page.setViewportSize({ width: 1369, height: 850 });
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
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
  await page.getByRole("combobox", { name: "Choose an effect preset" }).click();
  await page.getByRole("option", { name: "Launch shadow", exact: true }).click();
  await page.getByLabel("Preset name", { exact: true }).fill("Launch outline");
  await page.getByRole("button", { name: "Update preset", exact: true }).click();
  await expect(page.getByText("Preset saved.", { exact: true })).toBeVisible();
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
    if (!(await page.getByLabel("Preset name", { exact: true }).isVisible())) {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^Effects/ })
        .click();
    }
    await page.getByRole("combobox", { name: "Choose an effect preset" }).click();
    await page.getByRole("option", { name: "Launch outline", exact: true }).click();
    await page.getByLabel("Preset name", { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByLabel("Preset name", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath(`presets-${width}-${colorScheme}.png`) });
  }
  await page.getByRole("button", { name: "Delete preset", exact: true }).click();
  await expect(
    page.getByText("Preset deleted. Applied layers keep their effects.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove drop shadow", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
