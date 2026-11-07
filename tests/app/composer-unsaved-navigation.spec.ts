import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("scheduled edits survive cancelled navigation and require an explicit discard", async ({
  page,
  request,
}, info) => {
  test.setTimeout(90_000);
  const auth = await registerUser(request, `scheduled-navigation-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Scheduled navigation");
  const other = await createWorkspace(request, auth.token, "Other workspace");
  const original = "Original scheduled release note";
  const edited = "Edited scheduled release note to preserve";
  const publication = await createPublication(request, auth.token, workspace.id, original);
  // This read fixture has no destinations or jobs, so no provider delivery can execute.
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `UPDATE publications SET status='scheduled', scheduled_at='2099-12-15 12:00:00+00:00' WHERE id='${publication.id}';`,
  ]);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const path = `/api/v1/publications/${publication.id}`;
  const read = async () => {
    const response = await request.get(path, { headers });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const editorURL = `/publications/${publication.id}?workspace_id=${workspace.id}`;
  const input = page.getByRole("textbox", { name: "Post text", exact: true });
  const messages: string[] = [];
  let discard = false;
  page.on("dialog", async (dialog) => {
    messages.push(dialog.type());
    if (discard) await dialog.accept();
    else await dialog.dismiss();
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await authenticatePage(page, auth.token);
  await page.goto(editorURL);
  await expect(input).toHaveText(original, { useInnerText: true });
  await page.getByRole("button", { name: "Posts", exact: true }).click();
  await expect(page).toHaveURL(/\/publications$/);
  expect(messages).toEqual([]);
  await page.goto(editorURL);
  await expect(input).toHaveText(original, { useInnerText: true });

  for (const width of [1280, 320]) {
    for (const scheme of ["light"] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await input.fill(edited);
      const previousPrompts = messages.length;
      await page.getByRole("button", { name: "Posts", exact: true }).click();
      expect(messages.slice(previousPrompts)).toEqual(["confirm"]);
      await expect(page).toHaveURL(new RegExp(`/publications/${publication.id}`));
      await expect(input).toHaveText(edited, { useInnerText: true });
      expect((await read()).source_text).toBe(original);
      await page.screenshot({ path: info.outputPath(`protected-${width}-${scheme}.png`) });
    }
  }

  const beforeReload = messages.length;
  // Initiate the browser reload without waiting for a navigation that is cancelled.
  await page.evaluate(() => window.location.reload());
  await expect.poll(() => messages.slice(beforeReload)).toEqual(["beforeunload"]);
  expect(messages.slice(beforeReload)).toEqual(["beforeunload"]);
  await expect(input).toHaveText(edited, { useInnerText: true });

  await page.setViewportSize({ width: 1280, height: 1000 });
  const beforeSwitch = messages.length;
  await page
    .getByRole("button", { name: new RegExp(workspace.name) })
    .first()
    .click();
  await page.getByRole("menuitem", { name: new RegExp(other.name) }).click();
  const workspaceDialog = page.getByTestId("composer-workspace-switch-dialog");
  await expect(workspaceDialog).toBeVisible();
  expect(messages.length).toBe(beforeSwitch);
  await workspaceDialog.getByRole("button", { name: "Stay here", exact: true }).click();
  await expect(input).toHaveText(edited, { useInnerText: true });

  await input.fill(original);
  const beforeCleanExit = messages.length;
  await page.getByRole("button", { name: "Posts", exact: true }).click();
  await expect(page).toHaveURL(/\/publications$/);
  expect(messages.length).toBe(beforeCleanExit);

  await page.goto(editorURL);
  await expect(input).toHaveText(original, { useInnerText: true });
  await input.fill(edited);
  discard = true;
  const beforeDiscard = messages.length;
  await page.getByRole("button", { name: "Posts", exact: true }).click();
  await expect(page).toHaveURL(/\/publications$/);
  expect(messages.slice(beforeDiscard)).toEqual(["confirm"]);
  const stored = await read();
  expect(stored.source_text).toBe(original);
  expect(stored.revision).toBe(publication.revision);

  await page.goto(editorURL);
  await expect(input).toHaveText(original, { useInnerText: true });
  await input.fill(edited);
  const beforeWorkspaceDiscard = messages.length;
  await page
    .getByRole("button", { name: new RegExp(workspace.name) })
    .first()
    .click();
  await page.getByRole("menuitem", { name: new RegExp(other.name) }).click();
  await expect(workspaceDialog).toBeVisible();
  await workspaceDialog.getByRole("button", { name: "Discard and switch", exact: true }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:${process.env.OPENPOST_APP_E2E_PORT ?? 18180}/`);
  expect(messages.length).toBe(beforeWorkspaceDiscard);
  expect((await read()).source_text).toBe(original);
  expect(pageErrors).toEqual([]);
});

test("draft edits still autosave when navigating to Posts", async ({ page, request }) => {
  const auth = await registerUser(request, `draft-navigation-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Draft navigation");
  const publication = await createPublication(request, auth.token, workspace.id, "Original draft");
  const edited = "Draft content preserved by autosave";
  const messages: string[] = [];
  page.on("dialog", async (dialog) => {
    messages.push(dialog.type());
    await dialog.dismiss();
  });
  await authenticatePage(page, auth.token);
  const editorURL = `/publications/${publication.id}?workspace_id=${workspace.id}`;
  await page.goto(editorURL);
  const input = page.getByRole("textbox", { name: "Post text", exact: true });
  await expect(input).toHaveText("Original draft", { useInnerText: true });
  await input.fill(edited);
  await page.getByRole("button", { name: "Posts", exact: true }).click();
  await expect(page).toHaveURL(/\/publications$/);
  const response = await request.get(`/api/v1/publications/${publication.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const stored = await response.json();
  expect(stored.source_text).toBe(edited);
  expect(stored.revision).toBeGreaterThan(publication.revision);
  expect(messages).toEqual([]);
  await page.goto(editorURL);
  await expect(input).toHaveText(edited, { useInnerText: true });
});
