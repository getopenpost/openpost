import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Image Editor starts a blank project from the primary action", async ({ page }) => {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page).toHaveURL(/\/image-editor\/local_design_/);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
});

test("signed-in Image Editor defaults new projects to workspace storage", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `editor-start-label-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Editor start label");
  await authenticatePage(page, auth.token);

  await page.goto("/image-editor");

  const storage = page.getByRole("button", {
    name: "Save new projects to",
    exact: true,
  });
  await expect(storage).toContainText("OpenPost cloud");
  await storage.click();
  await page.getByRole("option", { name: "This device", exact: true }).click();
  await expect(storage).toContainText("This device");
});

test("Video Editor creates after folder choice and recovers from cancellation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        if (++attempts === 1) throw new DOMException("Canceled", "AbortError");
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        for (const method of ["queryPermission", "requestPermission"]) {
          Object.defineProperty(prototype, method, {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
  await page.goto("/video-editor");
  const create = page.getByRole("button", {
    name: "Open Video Editor",
    exact: true,
  });
  await create.click();
  await expect(create).toBeEnabled();
  await expect(page).toHaveURL(/\/video-editor$/);
  await page.getByRole("button", { name: /Shorts, TikTok and Reels/ }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await page.locator("[data-project-details]").click();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Untitled project");
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
});
