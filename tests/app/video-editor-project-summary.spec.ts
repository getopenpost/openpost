import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("project summary labels stay grammatical through clip creation, Undo and saved reload", async ({
  page,
  request,
}, info) => {
  test.setTimeout(90_000);
  const auth = await registerUser(request, `project-summary-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Project summary");
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[\da-f-]+\?storage=cloud/);
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  const summary = page.locator("[data-project-summary]");
  const clips = page.locator("[data-timeline-item-id]");
  await expect(clips).toHaveCount(0);
  await expect(summary).toHaveText("1920×1080 · 30 fps · 0:00 · Clips: 0 · Media: 0 · Issues: 0");
  for (const count of [1, 2]) {
    await page
      .getByRole("complementary", { name: "Assets", exact: true })
      .getByRole("button", { name: "Add layer", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await expect(clips).toHaveCount(count);
    await expect(summary).toContainText(`Clips: ${count} · Media: 0 · Issues: 0`);
  }
  await page.getByRole("application", { name: "Program", exact: true }).focus();
  const modifier = await page.evaluate(() =>
    /Mac|iPhone|iPad/i.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+z`);
  await expect(clips).toHaveCount(1);
  await expect(summary).toHaveText("1920×1080 · 30 fps · 0:03 · Clips: 1 · Media: 0 · Issues: 0");
  await expect(page.locator('[role="status"][data-state="saved"]')).toBeVisible();
  const projectURL = page.url();
  await page.reload();
  await expect(page).toHaveURL(projectURL);
  await expect(clips).toHaveCount(1);
  await expect(summary).toHaveText("1920×1080 · 30 fps · 0:03 · Clips: 1 · Media: 0 · Issues: 0");
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.reload();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(summary).toHaveAttribute(
        "title",
        "1920×1080 · 30 fps · 0:03 · Clips: 1 · Media: 0 · Issues: 0",
      );
      await expect(summary).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      await page.screenshot({ path: info.outputPath(`summary-${scheme}-${width}.png`) });
    }
  }
});
