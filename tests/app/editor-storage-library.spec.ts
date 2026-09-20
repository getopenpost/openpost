import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Image Editor keeps local and cloud designs visible when changing creation storage", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const auth = await registerUser(request, `image-library-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Image library");
  await authenticatePage(page, auth.token);
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "Local only", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page).toHaveURL(/image-editor\/local_design_/);
  await page.goto("/image-editor");
  await expect(page.getByRole("img", { name: "Local only" })).toBeVisible();
  await page.getByRole("button", { name: "Saved to OpenPost", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page).toHaveURL(/image-editor\/(?!local_design_)[^/]+$/);
  await page.goto("/image-editor");
  await expect(page.getByRole("img", { name: "Saved to OpenPost · Online" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Local only" })).toBeVisible();
  await page.getByRole("button", { name: "Local only", exact: true }).click();
  await expect(page.getByRole("img", { name: "Saved to OpenPost · Online" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your designs", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("image-project-storage.png"), fullPage: true });
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      if (name === "openpost-studio") throw new Error("Local library unavailable");
      return open(name, version);
    };
  });
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Local library unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "Saved to OpenPost · Online" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});
