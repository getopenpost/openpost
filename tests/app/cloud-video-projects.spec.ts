import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Cross-device launch");
  await page.getByRole("textbox", { name: "Project name" }).press("Tab");
  await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
    "data-state",
    "saved",
  );
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

  await page.locator("header").getByRole("button", { name: "More actions" }).click();
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
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Return to project");
  await page.getByRole("textbox", { name: "Project name" }).press("Tab");
  await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
    "data-state",
    "saved",
  );
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?storage=cloud$/u);
  await page.goto("/video-editor");
  await expect(page.getByRole("heading", { name: "Return to project" })).toBeVisible();
});

test("saving a conflicting local edit as a copy retains its media and opens without re-saving the conflict", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const auth = await registerUser(
    request,
    `cloud-conflict-copy-${Date.now().toString(36)}@example.com`,
  );
  const workspace = (await createWorkspace(request, auth.token, "Conflict copy E2E")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+\?storage=cloud$/u);
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
  const bytes = (
    await readFile(
      fileURLToPath(new URL("./fixtures/product-screenshots/lisbon-tram.png", import.meta.url)),
    )
  ).toString("base64");
  await page.evaluate(async (bytes) => {
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("conflict-copy-fixture", { create: true });
    const handle = await directory.getFileHandle("lisbon-tram.png", { create: true });
    const writable = await handle.createWritable();
    await writable.write(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)));
    await writable.close();
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [handle],
    });
  }, bytes);
  await page.getByRole("button", { name: "Import media", exact: true }).click();
  await page
    .getByRole("button", { name: "Place on timeline: lisbon-tram.png", exact: true })
    .click();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
    "data-state",
    "saved",
  );
  const headers = { Authorization: `Bearer ${auth.token}` };
  const projectURL = `/api/v1/video-projects/${projectId}?workspace_id=${workspace.id}`;
  const assetsURL = `/api/v1/video-projects/${projectId}/assets?workspace_id=${workspace.id}`;
  await expect
    .poll(async () => {
      const assets = (await (await request.get(assetsURL, { headers })).json()) as {
        status: string;
      }[];
      return assets.length === 1 && assets.every((asset) => asset.status === "ready");
    })
    .toBe(true);
  const originalAssets = (await (await request.get(assetsURL, { headers })).json()) as {
    id: string;
    media_id: string;
    stable_media_id: string;
  }[];
  const original = (await (await request.get(projectURL, { headers })).json()) as {
    head_revision: number;
  };
  const remote = await request.post(`/api/v1/video-projects/${projectId}/mutations`, {
    headers,
    data: {
      workspace_id: workspace.id,
      mutation_id: "remote-name",
      base_revision: original.head_revision,
      device_id: "remote-editor",
      operations: [{ kind: "set", target: "project:name", path: "/name", value: "Remote version" }],
    },
  });
  expect(remote.ok()).toBe(true);
  expect(await remote.json()).toMatchObject({ outcome: "applied" });
  await page.getByRole("textbox", { name: "Project name" }).fill("Local version");
  await page.getByRole("textbox", { name: "Project name" }).press("Tab");
  await page.getByRole("button", { name: "This project changed elsewhere", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await page.route("**/api/v1/video-projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        title: "Conflict",
        status: 409,
        detail: "Source uploads are incomplete",
      }),
    });
  });
  await history.getByRole("button", { name: "Save local edit as a copy", exact: true }).click();
  await expect(
    history.getByText(
      "Finish uploading this project's media, then try saving a copy again. Your local edit has been kept.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/video-editor/${projectId}\\?`));
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Local version");
  await page.unroute("**/api/v1/video-projects");
  await history.getByRole("button", { name: "Save local edit as a copy", exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(`/video-editor/${projectId}\\?`));
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "Local version copy",
  );
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
  const copyId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(copyId).not.toBe(projectId);
  const copiedAssets = (await (
    await request.get(`/api/v1/video-projects/${copyId}/assets?workspace_id=${workspace.id}`, {
      headers,
    })
  ).json()) as { id: string; media_id: string; stable_media_id: string }[];
  expect(copiedAssets).toHaveLength(1);
  expect(copiedAssets[0].id).not.toBe(originalAssets[0].id);
  expect(copiedAssets[0]).toMatchObject({
    media_id: originalAssets[0].media_id,
    stable_media_id: originalAssets[0].stable_media_id,
    status: "ready",
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "Local version copy",
  );
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Place on timeline: lisbon-tram.png", exact: true }),
  ).toBeVisible();
  expect(await (await request.get(projectURL, { headers })).json()).toMatchObject({
    name: "Remote version",
  });
  await page.screenshot({ path: test.info().outputPath("conflict-copy-after.png") });
});
