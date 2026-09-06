import { expect, test } from "@playwright/test";

test("starter previews fit the complete canvas on narrow phones", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/image-editor");
  const gallery = page.getByRole("region", { name: "Starter templates" });
  await expect(gallery.locator("canvas").first()).toBeVisible();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect
        .poll(() =>
          gallery.locator("canvas").evaluateAll((canvases) =>
            canvases.every((canvas) => {
              const frame = canvas.parentElement!.getBoundingClientRect();
              const bitmap = canvas.getBoundingClientRect();
              return bitmap.width <= frame.width + 1 && bitmap.height <= frame.height + 1;
            }),
          ),
        )
        .toBe(true);
      await gallery.screenshot({
        path: testInfo.outputPath(`templates-${width}-${colorScheme}.png`),
      });
    }
  }
  const starter = gallery.getByRole("button", { name: "Quick announcement" });
  await starter.focus();
  await expect(starter).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
});

// A public visitor can create a design, keep working across a reload, and
// export it without an account and without any server write. If local
// persistence breaks, edits silently vanish; if the public boundary leaks,
// anonymous work hits the API.
test("public image editor creates, restores, and exports a local design", async ({ page }) => {
  test.setTimeout(60_000);
  const browserErrors: string[] = [];
  const workspaceWrites: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/v1/image-editor/designs")) {
      workspaceWrites.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto("/image-editor");
  await expect(page.getByRole("heading", { name: "Free social media image editor" })).toBeVisible();
  await page.getByRole("button", { name: /Instagram square/ }).click();

  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await page.waitForTimeout(500);
  expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
    timeout: 20_000,
  });

  const title = page.getByRole("textbox", { name: "Design title" });
  await title.fill("Local launch design");
  const saveIndicator = page.getByTestId("image-editor-save-indicator");
  await expect(saveIndicator).toBeVisible();
  await expect(saveIndicator).toHaveAttribute("data-state", "saved");
  await expect(saveIndicator).toContainText("Saved on this device");

  await page.reload();
  await expect(title).toHaveValue("Local launch design");

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("heading", { name: "Export design" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  await download;
  await expect(
    page.getByLabel("Notifications alt+T").getByText("Export downloaded."),
  ).toBeVisible();

  expect(workspaceWrites).toEqual([]);
  expect(browserErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
});
