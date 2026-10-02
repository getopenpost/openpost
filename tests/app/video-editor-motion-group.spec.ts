import { expect, test, type Page } from "@playwright/test";

async function installLocalWorkspacePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        if (!("queryPermission" in prototype)) {
          Object.defineProperty(prototype, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (!("requestPermission" in prototype)) {
          Object.defineProperty(prototype, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
}

async function createProject(page: Page, name: string): Promise<void> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Custom project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
}

test("Motion repeated Group keeps one saved group and one undoable edit", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await createProject(page, "Audit Motion repeated Group");
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await page.getByRole("button", { name: "New composition", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const timeline = page.getByRole("region", { name: "Composition timeline", exact: true });
  for (let index = 0; index < 3; index++) {
    await timeline.getByRole("button", { name: "Text", exact: true }).first().click();
  }
  const layers = timeline.locator('[role="button"][data-testid^="composition-layer-"]');
  await expect(layers).toHaveCount(3);
  await layers.nth(0).focus();
  await page.keyboard.press("Enter");
  await layers.nth(1).focus();
  await page.keyboard.press("Control+Enter");
  await expect(layers.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(layers.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("composition-group").click();
  const groups = timeline.locator('[data-testid^="group-row-"]');
  await expect(groups).toHaveCount(1);
  const originalId = await groups.first().getAttribute("data-testid");
  await layers.nth(0).focus();
  await page.keyboard.press("Control+g");
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toHaveAttribute("data-testid", originalId!);
  await expect(page.getByTestId("composition-group")).toBeDisabled();
  for (const command of ["Undo", "Redo"]) {
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: command, exact: true }).click();
    await expect(groups).toHaveCount(command === "Undo" ? 0 : 1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  }
  await expect(groups.first()).toHaveAttribute("data-testid", originalId!);
  await page.getByRole("banner").getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save", exact: true }).click();
  await expect(page.getByRole("banner").getByRole("status")).toHaveAttribute("data-state", "saved");
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.reload();
      await page.getByRole("tab", { name: "Motion", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await expect(groups).toHaveCount(1);
      await expect(groups.first()).toHaveAttribute("data-testid", originalId!);
      await expect(layers).toHaveCount(3);
      await layers.nth(0).focus();
      await page.keyboard.press("Enter");
      await layers.nth(1).focus();
      await page.keyboard.press("Control+Enter");
      await expect(page.getByTestId("composition-group")).toBeDisabled();
      await page.keyboard.press("Control+g");
      await expect(groups).toHaveCount(1);
      await groups.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`motion-group-${width}-${scheme}.png`) });
    }
  }
  expect(errors).toEqual([]);
});
