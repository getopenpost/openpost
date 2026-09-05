import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Cloud Video Projects are the signed-in default with recovery on desktop and phone", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `cloud-video-projects-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Cloud Video Projects E2E")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/video-editor");
  await expect(page.getByRole("heading", { name: "Saved to OpenPost" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved to OpenPost" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Choose your editing workspace" })).toHaveCount(0);

  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Cross-device launch");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?storage=cloud$/u);
  const projectId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await authenticatePage(secondPage, auth.token);
  await secondPage.goto(`/video-editor/${projectId}?storage=cloud`);
  await expect(secondPage.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  const baseRevision = await page.evaluate(
    async ({ projectId, workspaceId }) => {
      const response = await fetch(
        `/api/v1/video-projects/${projectId}?workspace_id=${workspaceId}`,
      );
      return ((await response.json()) as { head_revision: number }).head_revision;
    },
    { projectId, workspaceId: workspace.id },
  );
  const mutate = async (
    targetPage: typeof page,
    mutationId: string,
    target: string,
    path: string,
    value: unknown,
  ) =>
    targetPage.evaluate(
      async ({ projectId, workspaceId, baseRevision, mutationId, target, path, value }) => {
        const response = await fetch(`/api/v1/video-projects/${projectId}/mutations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspaceId,
            mutation_id: mutationId,
            base_revision: baseRevision,
            device_id: mutationId.startsWith("desktop") ? "desktop-e2e" : "phone-e2e",
            operations: [{ kind: "set", target, path, value }],
          }),
        });
        return response.json() as Promise<{ outcome: string }>;
      },
      { projectId, workspaceId: workspace.id, baseRevision, mutationId, target, path, value },
    );
  await expect(
    mutate(page, "desktop-copy", "project:description", "/description", "Desktop copy"),
  ).resolves.toMatchObject({ outcome: "applied" });
  await expect(
    mutate(secondPage, "phone-name", "project:name", "/name", "Phone title"),
  ).resolves.toMatchObject({ outcome: "applied" });
  await expect(
    mutate(secondPage, "phone-copy", "project:description", "/description", "Phone copy"),
  ).resolves.toMatchObject({ outcome: "conflict" });
  await secondContext.close();

  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Version history" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(history).toBeVisible();
  await expect(history.getByText("Loading...", { exact: true })).toHaveCount(0);
  await history.getByRole("textbox", { name: "Checkpoint name" }).fill("Before captions");
  await history.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(history.getByText("Before captions", { exact: true })).toBeVisible();
  await expect(
    history.getByRole("heading", { name: "This project changed elsewhere" }),
  ).toBeVisible();
  await history.getByRole("button", { name: "Load OpenPost version" }).click();
  await expect(
    history.getByRole("heading", { name: "This project changed elsewhere" }),
  ).toHaveCount(0);
  await history
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close" })
    .click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Version history" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Version history" }).click();
  await expect(page.getByRole("dialog", { name: "Version history" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page
    .getByRole("dialog", { name: "Version history" })
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close" })
    .click();

  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Keep available offline" }).click();
  await expect(page.getByText("Available offline", { exact: true })).toBeVisible();
});

test("lists a saved Cloud Video Project after returning from the editor", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `cloud-video-return-${unique}@example.com`);
  await createWorkspace(request, auth.token, "Cloud Video Return E2E");
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Return to project");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?storage=cloud$/u);
  await page.goto("/video-editor");
  await expect(page.getByRole("heading", { name: "Return to project" })).toBeVisible();
});
