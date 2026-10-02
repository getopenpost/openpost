import path from "node:path";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Quick Cut saves a source project to OpenPost and opens it again", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `quick-cut-cloud-${unique}@example.com`);
  const workspace = z
    .object({ id: z.string() })
    .parse(await createWorkspace(request, auth.token, "Quick Cut Cloud E2E"));
  await authenticatePage(page, auth.token);

  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/quick-cut");
  await expect(page.getByRole("button", { name: "Saved to OpenPost" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const chooserPromise = page.waitForEvent("filechooser");
  const cloudCreatePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/v1/video-projects"),
  );
  await page.getByRole("button", { name: "Open videos" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(
    path.join(process.cwd(), "tests/app/fixtures/product-screenshots/study-sos-demo.mp4"),
  );

  await expect((await cloudCreatePromise).ok()).toBe(true);
  await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
  await expect(page).toHaveURL(/\/quick-cut\?project=[^&]+&storage=cloud$/u);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  const projectName = page.getByRole("textbox", { name: "Project name" });
  const renameResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/mutations"),
  );
  await projectName.fill("Launch trim");
  await expect((await renameResponse).ok()).toBe(true);
  await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Launch trim");
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/video-projects?workspace_id=${workspace.id}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        return response.ok()
          ? z.array(z.unknown()).parse(await response.json()).length
          : -response.status();
      },
      { timeout: 90_000 },
    )
    .toBe(1);

  const exportButton = page
    .locator("header.editor-header")
    .getByRole("button", { name: "Export", exact: true });
  for (const width of [1280, 390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      await expect(exportButton).toBeVisible();
      await exportButton.focus();
      await expect(exportButton).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Export", exact: true })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`export-${width}-${colorScheme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/quick-cut$/u);
  await expect(page.getByRole("button", { name: "Open videos", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveCount(0);
  await page.reload();
  const savedProject = page.getByRole("listitem").filter({ hasText: "Launch trim" });
  await expect(savedProject).toBeVisible();
  await savedProject.getByRole("button", { name: /Launch trim/ }).click();
  await expect(
    page.getByRole("button", { name: "Source 1 · study-sos-demo.mp4", exact: true }),
  ).toBeVisible({
    timeout: 90_000,
  });
  const preview = page.locator(".viewer").getByRole("button", { name: "Preview", exact: true });
  await preview.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Saved to OpenPost/ })).toBeVisible();
});
