import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

async function fixture(page: Page, request: APIRequestContext, referenced = false) {
  const auth = await registerUser(request, `media-trash-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Recoverable media");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const name = `recoverable-${randomUUID()}.png`;
  const upload = await request.post("/api/v1/media/upload", {
    headers,
    multipart: {
      workspace_id: workspace.id,
      file: {
        name,
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const media = await upload.json();
  if (referenced)
    await createPublication(request, auth.token, workspace.id, "Owned media reference", {
      contentProfile: "image_post",
      mediaIDs: [media.id],
    });
  await authenticatePage(page, auth.token);
  await page.goto("/media");
  const details = page.getByRole("button", { name: `Open details for ${name}`, exact: true });
  await details.click();
  const inspector = page.getByRole("dialog", { name, exact: true });
  await expect(
    inspector.getByText(`Referenced by ${referenced ? 1 : 0} ${referenced ? "item" : "items"}`, {
      exact: true,
    }),
  ).toBeVisible();
  const confirm = page.locator('[role="dialog"]').filter({ hasText: "Delete media?" });
  const read = async () => {
    const response = await request.get(`/api/v1/media?workspace_id=${workspace.id}&lifecycle=all`, {
      headers,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json();
    return body.media.find((item: { id: string }) => item.id === media.id);
  };
  return { name, media, details, inspector, confirm, read };
}

test("Media trash confirmation explains recovery", async ({ page, request }) => {
  const { inspector, confirm } = await fixture(page, request);
  await inspector.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toContainText(
    "This media item will move to Trash. You can restore it before permanent deletion.",
  );
});

test("Media inspector allows pointer cancellation, recoverable deletion and restore", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { inspector, confirm, details, name, read } = await fixture(page, request);
  const original = await read();
  const deleteButton = inspector.getByRole("button", { name: "Delete", exact: true });
  await deleteButton.click();
  await confirm
    .getByRole("button", { name: "Cancel", exact: true, includeHidden: true })
    .click({ timeout: 5000 });
  await expect(confirm).toBeHidden();
  await expect(inspector).toBeVisible();
  await expect(deleteButton).toBeFocused();
  expect(await read()).toEqual(original);
  await deleteButton.click();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(inspector).toBeVisible();
  await expect(deleteButton).toBeFocused();
  expect(await read()).toEqual(original);
  await deleteButton.click();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value === "dark"),
      scheme,
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
      await expect(confirm.getByRole("button", { name: "Delete", exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`confirm-${width}-${scheme}.png`) });
    }
  }
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(inspector).toBeHidden();
  await expect(details).toBeHidden();
  await expect(page.locator("main h1")).toBeFocused();
  const trashed = await read();
  expect(trashed.trashed_at).toBeTruthy();
  expect(trashed.purge_after).toBeTruthy();
  const tabs = page.getByTestId("media-lifecycle-tabs");
  await tabs.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await tabs.getByRole("button", { name: "Library", exact: true }).click();
  await expect(details).toBeVisible();
  await page.reload();
  await details.click();
  await expect(inspector).toBeVisible();
  const restored = await read();
  expect(restored.id).toBe(original.id);
  expect(restored.original_filename).toBe(original.original_filename);
  expect(restored.trashed_at ?? "").toBe("");
  expect(restored.purge_after ?? "").toBe("");
  expect(errors).toEqual([]);
});

test("Referenced media keeps the usage blocker without a delete request", async ({
  page,
  request,
}) => {
  let deletions = 0;
  page.on("request", (event) => {
    if (event.method() === "POST" && event.url().includes("/media/batch-delete")) deletions++;
  });
  const { inspector, confirm, read } = await fixture(page, request, true);
  const original = await read();
  await inspector.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(
    inspector
      .getByText(
        "Delete is blocked while this asset is used. Remove the usages listed below first.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  expect(await read()).toEqual(original);
  expect(deletions).toBe(0);
});
