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

  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change image", exact: true })).toBeVisible();
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

test("workspace timezone and required client review survive a reload", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `workspace-review-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Canadian workspace");
  await authenticatePage(page, auth.token);
  await page.goto(`/settings?tab=general&workspace=${workspace.id}`);

  const timezone = page.getByRole("button", { name: "Timezone", exact: true });
  const review = page.getByRole("checkbox", { name: "Require client review for every post" });
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  for (const zone of [
    { id: "America/Halifax", label: /Halifax \(Atlantic Time\)/ },
    { id: "America/St_Johns", label: /St Johns \(Newfoundland Time\)/ },
  ]) {
    await timezone.click();
    await page.getByRole("option", { name: zone.label }).click();
    await review.setChecked(true);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes(`/api/v1/workspaces/${workspace.id}/settings`),
    );
    await save.click();
    expect((await saved).ok()).toBeTruthy();
    await page.reload();
    await expect(timezone).toHaveText(zone.label);
    await expect(review).toBeChecked();
    const settings = await request.get(`/api/v1/workspaces/${workspace.id}/settings`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(settings.ok()).toBeTruthy();
    expect(await settings.json()).toMatchObject({
      timezone: zone.id,
      require_client_review: true,
    });
  }

  await review.uncheck();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/api/v1/workspaces/${workspace.id}/settings`),
  );
  await save.click();
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(review).not.toBeChecked();
});
