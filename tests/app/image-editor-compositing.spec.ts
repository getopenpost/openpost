import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { authenticatePage, registerUser, createWorkspace } from "./helpers";

for (const storage of ["guest", "cloud"] as const) {
  test(`${storage} layers can be merged, restored, and flattened without losing the saved project`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1369, height: 800 });
    if (storage === "cloud") {
      const auth = await registerUser(request, `compositing-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Compositing");
      await authenticatePage(page, auth.token);
      await page.goto(`/image-editor/new?workspace=${workspace.id}`);
    } else await page.goto("/image-editor");
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
    const layers = page.getByRole("tree", { name: "Layers", exact: true }).getByRole("treeitem");
    for (let index = 0; index < 2; index++) {
      await page.getByRole("menuitem", { name: "Tools", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Shape\b/ }).click();
    }
    await expect(layers).toHaveCount(2);
    await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
    await expect(page.getByText("Bakes pixels inside the page.", { exact: false })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${storage}-layer-commands.png`) });
    await page.getByRole("menuitem", { name: "Merge down", exact: true }).click();
    await expect(layers).toHaveCount(1);
    await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(layers).toHaveCount(2);
    await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
    await page.getByRole("menuitem", { name: "Flatten page", exact: true }).click();
    await expect(layers).toHaveCount(1);
    await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
    await expect(layers).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    const bakeHelp = page.getByText("Bakes pixels inside the page.", { exact: false });
    await bakeHelp.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(bakeHelp).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: testInfo.outputPath(`${storage}-compositing-390.png`) });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Rasterize to image", exact: true }),
    ).toBeVisible();
    await bakeHelp.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(bakeHelp).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.screenshot({ path: testInfo.outputPath(`${storage}-compositing-320.png`) });
    expect(errors).toEqual([]);
  });
}
