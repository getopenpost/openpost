import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const onePixelPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
  "base64",
);

test("workspace image settings upload a device image and save it", async ({ page, request }) => {
  const auth = await registerUser(request, `workspace-image-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Workspace image settings");
  await authenticatePage(page, auth.token);
  await page.goto(`/settings?tab=general&workspace=${workspace.id}`);

  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Change image", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Workspace image" });
  await expect(dialog.getByRole("tab", { name: "Device", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "workspace.png",
    mimeType: "image/png",
    buffer: onePixelPNG,
  });
  await dialog.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await expect(save).toBeEnabled();
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/api/v1/workspaces/${workspace.id}/settings`),
  );
  await save.click();
  expect((await saveResponse).ok()).toBeTruthy();

  const settingsResponse = await request.get(`/api/v1/workspaces/${workspace.id}/settings`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(settingsResponse.ok()).toBeTruthy();
  const settings = (await settingsResponse.json()) as { avatar_url?: string };
  expect(settings.avatar_url).toMatch(/^\/media\/[a-zA-Z0-9_-]+$/);
});
