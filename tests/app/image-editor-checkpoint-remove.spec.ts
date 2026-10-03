import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("removing a named checkpoint preserves the current design and other saved versions", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `checkpoint-remove-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Checkpoint removal");
  const headers = { Authorization: `Bearer ${auth.token}` };
  await authenticatePage(page, auth.token);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/image-editor/new?workspace=${workspace.id}`);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const openHistory = async () => {
    if (await page.getByRole("dialog", { name: "Version history", exact: true }).isVisible())
      return;
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /^Version history/ }).click();
    await expect(page.getByRole("dialog", { name: "Version history", exact: true })).toBeVisible();
  };
  for (const name of ["Remove café checkpoint", "Keep other checkpoint"]) {
    await openHistory();
    await page.getByRole("button", { name: "Create checkpoint", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create checkpoint", exact: true });
    await dialog.getByRole("textbox", { name: "Checkpoint name", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Create checkpoint", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Version history", exact: true })).toBeVisible();
  }
  const head = await (await request.get(`/api/v1/image-editor/designs/${id}`, { headers })).json();
  await openHistory();
  const history = page.getByRole("dialog", { name: "Version history", exact: true });
  await history.getByRole("button", { name: /^Remove café checkpoint/ }).click();
  await history.getByRole("button", { name: "Remove checkpoint", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Remove checkpoint", exact: true });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    history.getByRole("button", { name: "Remove checkpoint", exact: true }),
  ).toBeFocused();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await history.getByRole("button", { name: "Remove checkpoint", exact: true }).press("Enter");
  const remove = confirmation.getByRole("button", { name: "Remove checkpoint", exact: true });
  await remove.focus();
  await expect(remove).toBeFocused();
  // A keyboard choice made before opening autofocus must survive its next frame.
  await page.clock.runFor(32);
  await expect(remove).toBeFocused();
  await page.clock.resume();
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().includes(`/image-editor/designs/${id}/revisions/`),
  );
  await page.keyboard.press("Enter");
  expect((await removed).ok()).toBeTruthy();
  await expect(confirmation).toHaveCount(0);
  await expect(history.getByRole("button", { name: /^Remove café checkpoint/ })).toHaveCount(0);
  await expect(history.getByRole("button", { name: /^Keep other checkpoint/ })).toBeVisible();
  const immediately = await (
    await request.get(`/api/v1/image-editor/designs/${id}`, { headers })
  ).json();
  expect(immediately.document).toEqual(head.document);
  expect(immediately.revision).toBe(head.revision);
  await page.reload();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await openHistory();
  await expect(history.getByRole("button", { name: /^Remove café checkpoint/ })).toHaveCount(0);
  await expect(history.getByRole("button", { name: /^Keep other checkpoint/ })).toBeVisible();
  const after = await (await request.get(`/api/v1/image-editor/designs/${id}`, { headers })).json();
  expect(after.document).toEqual(head.document);
});
