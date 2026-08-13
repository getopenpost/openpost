import { expect, test, type Page, type Route } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

interface WorkspaceSummary {
  id: string;
  name: string;
}

function designSummary(id: string, title: string) {
  return {
    id,
    title,
    preset_key: "square",
    width_px: 1080,
    height_px: 1080,
    page_count: 1,
    revision: 1,
    cover_preview_media_id: "",
    is_favorite: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function videoSummary(id: string, title: string) {
  return {
    id,
    title,
    revision: 1,
    duration_ms: 10_000,
    source_count: 2,
    cover_preview_media_id: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

async function fulfillCatalogPage(
  route: Route,
  items: Array<Record<string, unknown>>,
  itemKey: "designs" | "projects",
  canEdit = true,
) {
  const url = new URL(route.request().url());
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const filtered = search
    ? items.filter((item) => String(item.title).toLowerCase().includes(search))
    : items;
  await route.fulfill({
    contentType: "application/json",
    json: {
      [itemKey]: filtered.slice(offset, offset + limit),
      total: filtered.length,
      can_edit: canEdit,
    },
  });
}

async function registerWorkspace(
  page: Page,
  request: Parameters<typeof registerUser>[0],
  name: string,
) {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const auth = await registerUser(request, `editors-${unique}@example.com`);
  const workspace = (await createWorkspace(
    request,
    auth.token,
    name,
  )) as WorkspaceSummary;
  await authenticatePage(page, auth.token);
  await page.addInitScript((selectedWorkspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(selectedWorkspace),
    );
  }, workspace);
  return { auth, workspace };
}

test("editor catalog paginates past both former caps and searches the full workspace", async ({
  page,
  request,
}) => {
  await registerWorkspace(page, request, "Large Editor Catalog");
  const designs = Array.from({ length: 125 }, (_, index) =>
    designSummary(
      `design-${index}`,
      `Design ${String(index).padStart(3, "0")}`,
    ),
  );
  const videos = Array.from({ length: 75 }, (_, index) =>
    videoSummary(`video-${index}`, `Video ${String(index).padStart(3, "0")}`),
  );
  await page.route("**/api/v1/image-editor/designs?**", (route) =>
    fulfillCatalogPage(route, designs, "designs"),
  );
  await page.route("**/api/v1/video-editor/projects?**", (route) =>
    fulfillCatalogPage(route, videos, "projects"),
  );

  await page.goto("/editors");
  const designSection = page.getByRole("region", { name: "Image designs" });
  const videoSection = page.getByRole("region", { name: "Video projects" });
  await expect(designSection.locator('a[href^="/image-editor/"]')).toHaveCount(
    50,
  );
  await designSection
    .getByRole("button", { name: "Load more designs" })
    .click();
  await expect(designSection.locator('a[href^="/image-editor/"]')).toHaveCount(
    100,
  );
  await designSection
    .getByRole("button", { name: "Load more designs" })
    .click();
  await expect(designSection.locator('a[href^="/image-editor/"]')).toHaveCount(
    125,
  );

  await expect(
    videoSection.locator('a[href^="/video-editor?cloud="]'),
  ).toHaveCount(50);
  await videoSection
    .getByRole("button", { name: "Load more video projects" })
    .click();
  await expect(
    videoSection.locator('a[href^="/video-editor?cloud="]'),
  ).toHaveCount(75);

  await page
    .getByRole("textbox", { name: "Search projects" })
    .fill("Design 124");
  await expect(page.getByText("Design 124", { exact: true })).toBeVisible();
  await expect(designSection.locator('a[href^="/image-editor/"]')).toHaveCount(
    1,
  );
  await expect(
    videoSection.locator('a[href^="/video-editor?cloud="]'),
  ).toHaveCount(0);
});

test("workspace changes clear old results and reject a late prior-workspace search", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `editors-race-${unique}@example.com`,
  );
  const first = (await createWorkspace(
    request,
    auth.token,
    `First ${unique}`,
  )) as WorkspaceSummary;
  const second = (await createWorkspace(
    request,
    auth.token,
    `Second ${unique}`,
  )) as WorkspaceSummary;
  await authenticatePage(page, auth.token);
  await page.addInitScript((workspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(workspace),
    );
  }, first);

  let releaseStale = () => {};
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  let releaseCurrent = () => {};
  const currentGate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  let staleStarted = false;
  let currentStarted = false;
  await page.route("**/api/v1/image-editor/designs?**", async (route) => {
    const url = new URL(route.request().url());
    const workspaceID = url.searchParams.get("workspace_id");
    const search = url.searchParams.get("search") ?? "";
    if (workspaceID === first.id && search === "") {
      await fulfillCatalogPage(
        route,
        [designSummary("first-loaded", "First loaded")],
        "designs",
      );
      return;
    }
    if (workspaceID === first.id) {
      staleStarted = true;
      await staleGate;
      try {
        await fulfillCatalogPage(
          route,
          [designSummary("stale-result", "Stale slow result")],
          "designs",
        );
      } catch {
        // The expected AbortController cancellation can close the intercepted request.
      }
      return;
    }
    currentStarted = true;
    await currentGate;
    await fulfillCatalogPage(
      route,
      [designSummary("current-result", "Current slow result")],
      "designs",
    );
  });
  await page.route("**/api/v1/video-editor/projects?**", (route) =>
    fulfillCatalogPage(route, [], "projects"),
  );

  await page.goto("/editors");
  await expect(page.getByText("First loaded", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search projects" }).fill("slow");
  await expect.poll(() => staleStarted).toBe(true);

  const workspaceButton = page
    .getByRole("button", { name: new RegExp(first.name) })
    .first();
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();
  await expect(page.getByText("First loaded", { exact: true })).toHaveCount(0);
  await expect.poll(() => currentStarted).toBe(true);

  releaseStale();
  await expect(
    page.getByText("Stale slow result", { exact: true }),
  ).toHaveCount(0);
  releaseCurrent();
  await expect(
    page.getByText("Current slow result", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Stale slow result", { exact: true }),
  ).toHaveCount(0);
});

test("cloud delete confirms policy, rolls failures back, and refreshes the workspace on success", async ({
  page,
  request,
}) => {
  await registerWorkspace(page, request, "Cloud Delete");
  let deleted = false;
  let deleteAttempts = 0;
  let releaseFailure = () => {};
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  await page.route("**/api/v1/image-editor/designs?**", (route) =>
    fulfillCatalogPage(route, [], "designs"),
  );
  await page.route("**/api/v1/video-editor/projects?**", (route) =>
    fulfillCatalogPage(
      route,
      deleted ? [] : [videoSummary("cloud-video", "Cloud launch")],
      "projects",
    ),
  );
  await page.route(
    "**/api/v1/video-editor/projects/cloud-video",
    async (route) => {
      deleteAttempts += 1;
      if (deleteAttempts === 1) {
        await failureGate;
        await route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          json: { detail: "Cloud storage is temporarily unavailable." },
        });
        return;
      }
      deleted = true;
      await route.fulfill({
        contentType: "application/json",
        json: { deleted: true },
      });
    },
  );

  await page.goto("/editors");
  const projectCard = page.locator('a[href="/video-editor?cloud=cloud-video"]');
  await expect(projectCard).toBeVisible();
  await projectCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete cloud project?" });
  await expect(dialog).toContainText(
    "Its source media and published posts will not be deleted. Media used by other active work remains protected",
  );
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(projectCard).toHaveCount(0);
  releaseFailure();
  await expect(projectCard).toBeVisible();
  await expect(
    page.getByText("Cloud storage is temporarily unavailable."),
  ).toBeVisible();

  await projectCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete cloud project?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(projectCard).toHaveCount(0);
  await expect(
    page.getByText("Cloud video project moved to trash."),
  ).toBeVisible();
});

test("read-only catalog users never receive a cloud-video delete action", async ({
  page,
  request,
}) => {
  await registerWorkspace(page, request, "Read-only Catalog");
  let deleteCalls = 0;
  await page.route("**/api/v1/image-editor/designs?**", (route) =>
    fulfillCatalogPage(route, [], "designs", false),
  );
  await page.route("**/api/v1/video-editor/projects?**", (route) =>
    fulfillCatalogPage(
      route,
      [videoSummary("viewer-video", "Viewer video")],
      "projects",
      false,
    ),
  );
  await page.route(
    "**/api/v1/video-editor/projects/viewer-video",
    async (route) => {
      deleteCalls += 1;
      await route.fulfill({
        status: 403,
        json: { detail: "workspace is read-only for this user" },
      });
    },
  );

  await page.goto("/editors");
  const projectCard = page.locator(
    'a[href="/video-editor?cloud=viewer-video"]',
  );
  await expect(projectCard).toBeVisible();
  await projectCard.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  expect(deleteCalls).toBe(0);
});
