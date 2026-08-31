import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  clickComposerDeliveryAction,
  createWorkspace,
  registerUser,
} from "./helpers";

function socialAccount(id: string, workspaceID: string, username: string) {
  return {
    id,
    workspace_id: workspaceID,
    platform: "bluesky",
    account_id: `did:plc:${id}`,
    account_username: username,
    is_active: true,
  };
}

function resolvedBlueskyCapability(accountID: string) {
  return {
    account_id: accountID,
    provider: "bluesky",
    profile: "short_text",
    output_profile: "bluesky.post",
    label: "Bluesky post",
    text_limit: 300,
    media: {
      min_count: 0,
      max_count: 4,
      allowed_mimes: [],
      requires_public_url: false,
      requires_https_fetchable: false,
    },
    intents: ["post"],
    media_shapes: ["text"],
    settings: [],
    setting_groups: [],
    compatible: true,
    active_constraints: {},
    issues: [],
    capability_revision: "test-v1",
    dynamic_options: {},
    immediate_readiness: { state: "healthy", publishable: true },
    scheduled_readiness: { state: "healthy", publishable: true },
  };
}

test("composer ignores stale accounts and recovers the current workspace", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `composer-recovery-${unique}@example.com`);
  const first = (await createWorkspace(request, auth.token, `Slow ${unique}`)) as {
    id: string;
    name: string;
  };
  const second = (await createWorkspace(request, auth.token, `Current ${unique}`)) as {
    id: string;
    name: string;
  };
  await authenticatePage(page, auth.token);
  await page.addInitScript((workspace) => {
    localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
  }, first);

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolveGate) => (releaseFirst = resolveGate));
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolveStarted) => (markFirstStarted = resolveStarted));
  let markFirstFinished!: () => void;
  const firstFinished = new Promise<void>(
    (resolveFinished) => (markFirstFinished = resolveFinished),
  );
  let secondRequests = 0;
  await page.route("**/api/v1/accounts?**", async (route) => {
    const workspaceID = new URL(route.request().url()).searchParams.get("workspace_id");
    if (workspaceID === first.id) {
      markFirstStarted();
      await firstGate;
      await route.fulfill({
        contentType: "application/json",
        json: [socialAccount("stale-account", first.id, "stale_previous")],
      });
      markFirstFinished();
      return;
    }

    secondRequests++;
    if (secondRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { title: "Unavailable", status: 503 },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: [socialAccount("current-account", second.id, "current_workspace")],
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    const payload = route.request().postDataJSON() as { account_ids: string[] };
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: payload.account_ids.map(resolvedBlueskyCapability),
      },
    });
  });

  await page.goto("/");
  await firstStarted;

  const workspaceButton = page.getByRole("button", { name: new RegExp(first.name) }).first();
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();

  const loadError = page.locator("[data-sonner-toast]").filter({
    hasText: "Failed to load accounts",
  });
  await expect(loadError).toBeVisible();
  await expect(page.getByTestId("composer-account-control")).toHaveCount(0);

  // The previous request may finish after the current one failed. It must still be ignored.
  releaseFirst();
  await firstFinished;
  await expect(loadError).toBeVisible();
  await expect(page.getByTestId("composer-account-control")).toHaveCount(0);
  await expect(page.getByText("stale_previous", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.getByTestId("composer-account-control").click();
  await expect(
    page.getByTestId("composer-account-row").getByText("@current_workspace", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("stale_previous", { exact: true })).toHaveCount(0);
  expect(secondRequests).toBe(2);
});

test("activity clears cross-workspace data and preserves a valid view on refresh failure", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `activity-recovery-${unique}@example.com`);
  const first = (await createWorkspace(request, auth.token, `First ${unique}`)) as {
    id: string;
    name: string;
  };
  const second = (await createWorkspace(request, auth.token, `Second ${unique}`)) as {
    id: string;
    name: string;
  };
  await authenticatePage(page, auth.token);
  await page.addInitScript((workspace) => {
    localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
  }, first);

  let releaseFirstRefresh!: () => void;
  const firstRefreshGate = new Promise<void>((resolveGate) => (releaseFirstRefresh = resolveGate));
  let markFirstRefreshStarted!: () => void;
  const firstRefreshStarted = new Promise<void>(
    (resolveStarted) => (markFirstRefreshStarted = resolveStarted),
  );
  let firstRefreshFinished = false;
  let gateNextFirstRefresh = false;
  let failNextPublicationsRequest = false;
  const jobWorkspaceIDs: string[] = [];

  await page.route("**/api/v1/publications?**", async (route) => {
    const url = new URL(route.request().url());
    const workspaceID = url.searchParams.get("workspace_id");
    if (url.searchParams.has("status")) {
      await route.fulfill({
        contentType: "application/json",
        headers: { "X-Has-More": "false" },
        json: [],
      });
      return;
    }
    let isGatedFirstRefresh = false;
    if (failNextPublicationsRequest) {
      failNextPublicationsRequest = false;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { title: "Unavailable", status: 503 },
      });
      return;
    }
    if (gateNextFirstRefresh && workspaceID === first.id) {
      gateNextFirstRefresh = false;
      isGatedFirstRefresh = true;
      markFirstRefreshStarted();
      await firstRefreshGate;
    }
    const isSecond = workspaceID === second.id;
    try {
      await route.fulfill({
        contentType: "application/json",
        headers: { "X-Has-More": "false" },
        json: [
          {
            id: isSecond ? "current-publication" : "previous-publication",
            workspace_id: workspaceID,
            created_by: "activity-recovery-user",
            title: isSecond ? "Current workspace post" : "Previous workspace post",
            intent: "post",
            content_profile: "short_text",
            source_text: isSecond ? "Current workspace post" : "Previous workspace post",
            source_url: "",
            goal: "",
            audience: "",
            status: "draft",
            revision: 1,
            scheduled_at: "",
            actual_run_at: "",
            created_at: "2026-07-20T10:00:00Z",
            updated_at: "2026-07-20T10:00:00Z",
            metadata: {},
            renditions: [],
            segments: [
              {
                id: isSecond ? "current-segment" : "previous-segment",
                position: 0,
                body: isSecond ? "Current workspace post" : "Previous workspace post",
                title: "",
                description: "",
                url: "",
                settings: {},
                media: [],
              },
            ],
            media: [],
          },
        ],
      });
    } finally {
      if (isGatedFirstRefresh) firstRefreshFinished = true;
    }
  });
  await page.route("**/api/v1/jobs?**", async (route) => {
    jobWorkspaceIDs.push(new URL(route.request().url()).searchParams.get("workspace_id") ?? "");
    await route.fulfill({ contentType: "application/json", json: [] });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });

  await page.goto("/publications?tab=drafts");
  await expect(page.locator("main").getByText("Previous workspace post")).toBeVisible();
  gateNextFirstRefresh = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await firstRefreshStarted;

  const workspaceButton = page.getByRole("button", { name: new RegExp(first.name) }).first();
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();
  await expect(page.locator("main").getByText("Current workspace post")).toBeVisible();
  releaseFirstRefresh();
  await expect.poll(() => firstRefreshFinished).toBe(true);
  await expect(page.locator("main").getByText("Previous workspace post")).toHaveCount(0);
  await expect(page.locator("main").getByText("Current workspace post")).toBeVisible();
  await expect.poll(() => jobWorkspaceIDs.includes(first.id)).toBe(true);
  await expect.poll(() => jobWorkspaceIDs.includes(second.id)).toBe(true);

  failNextPublicationsRequest = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Failed to load posts")).toBeVisible();
  await expect(page.locator("main").getByText("Current workspace post")).toBeVisible();
});

test("composer sends workspace-local wall time as the exact scheduled instant", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `composer-timezone-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, `Timezone ${unique}`)) as {
    id: string;
  };
  const settingsResponse = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { timezone: "America/New_York" },
  });
  expect(settingsResponse.ok()).toBeTruthy();

  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [socialAccount("timezone-account", workspace.id, "timezone_target")],
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: [resolvedBlueskyCapability("timezone-account")],
      },
    });
  });

  let scheduledAt = "";
  await page.route("**/api/v1/publications", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as {
        scheduled_at?: string;
        workspace_id?: string;
        source_text?: string;
        content_profile?: string;
      };
      if (payload.scheduled_at) scheduledAt = payload.scheduled_at;
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "scheduled-timezone-publication",
          workspace_id: payload.workspace_id,
          revision: 1,
          title: "",
          content_profile: payload.content_profile ?? "short_text",
          source_text: payload.source_text ?? "",
          status: "draft",
          scheduled_at: payload.scheduled_at ?? "",
          renditions: [],
        },
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/posts/*/variants", async (route) => {
    await route.fulfill({ contentType: "application/json", json: {} });
  });
  await page.route("**/api/v1/publications/scheduled-timezone-publication", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as {
        scheduled_at?: string;
      };
      if (payload.scheduled_at) scheduledAt = payload.scheduled_at;
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "scheduled-timezone-publication",
          revision: 1,
          status: "draft",
          scheduled_at: payload.scheduled_at ?? "",
        },
      });
      return;
    }
    await route.continue();
  });
  await page.route(
    "**/api/v1/publications/scheduled-timezone-publication/renditions",
    async (route) => {
      await route.fulfill({ contentType: "application/json", json: {} });
    },
  );
  await page.route("**/api/v1/publications/*/validate", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { valid: true, issues: [] },
    });
  });
  await page.route("**/api/v1/publications/*/schedule", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        message: "Scheduled!",
        publication_id: "scheduled-timezone-publication",
        renditions: [],
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("composer-account-control")).toBeVisible();
  await page.getByLabel("Post text").fill("Schedule in the workspace timezone.");
  await clickComposerDeliveryAction(page, "Schedule");
  const dialog = page.getByTestId("schedule-dialog-shell");
  await expect(dialog).toContainText("America/New_York");
  await dialog.getByLabel("Schedule time").fill("2099-07-21T09:00");
  await dialog.getByRole("button", { name: "Schedule", exact: true }).click();

  await expect(page.getByText("Scheduled!", { exact: true })).toBeVisible();
  await expect.poll(() => scheduledAt).toBe("2099-07-21T13:00:00.000Z");
});

test("an in-flight autosave cannot attach an old-workspace draft after switching", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `composer-autosave-race-${unique}@example.com`);
  const first = (await createWorkspace(request, auth.token, `Autosave A ${unique}`)) as {
    id: string;
    name: string;
  };
  const second = (await createWorkspace(request, auth.token, `Autosave B ${unique}`)) as {
    id: string;
    name: string;
  };

  await authenticatePage(page, auth.token);
  await page.addInitScript((workspace) => {
    localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
  }, first);
  await page.route("**/api/v1/accounts?**", async (route) => {
    const workspaceID = new URL(route.request().url()).searchParams.get("workspace_id");
    await route.fulfill({
      contentType: "application/json",
      json: [
        socialAccount(
          workspaceID === first.id ? "account-a" : "account-b",
          workspaceID ?? "",
          workspaceID === first.id ? "workspace_a" : "workspace_b",
        ),
      ],
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    const payload = route.request().postDataJSON() as {
      account_ids: string[];
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: payload.account_ids.map(resolvedBlueskyCapability),
      },
    });
  });

  let releaseFirstSave!: () => void;
  const firstSaveGate = new Promise<void>((resolveGate) => (releaseFirstSave = resolveGate));
  let markFirstSaveStarted!: () => void;
  const firstSaveStarted = new Promise<void>(
    (resolveStarted) => (markFirstSaveStarted = resolveStarted),
  );
  let markFirstSaveFinished!: () => void;
  const firstSaveFinished = new Promise<void>(
    (resolveFinished) => (markFirstSaveFinished = resolveFinished),
  );
  const savedWorkspaceIDs: string[] = [];
  await page.route("**/api/v1/publications", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { workspace_id: string };
    savedWorkspaceIDs.push(payload.workspace_id);
    if (payload.workspace_id === first.id) {
      markFirstSaveStarted();
      await firstSaveGate;
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "draft-workspace-a",
          workspace_id: first.id,
          revision: 1,
          title: "",
          content_profile: "short_text",
          source_text: "Move this unsaved content safely.",
          status: "draft",
          renditions: [],
        },
      });
      markFirstSaveFinished();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: "draft-workspace-b",
        workspace_id: second.id,
        revision: 1,
        title: "",
        content_profile: "short_text",
        source_text: "Move this unsaved content safely.",
        status: "draft",
        renditions: [],
      },
    });
  });
  await page.route("**/api/v1/posts/*/variants", async (route) => {
    await route.fulfill({ contentType: "application/json", json: {} });
  });
  await page.route("**/api/v1/publications/**", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        contentType: "application/json",
        json: { id: "draft-workspace-a", revision: 2, status: "draft" },
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Post text").fill("Move this unsaved content safely.");
  await firstSaveStarted;

  const workspaceButton = page.getByRole("button", { name: new RegExp(first.name) }).first();
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();
  await page
    .getByTestId("composer-workspace-switch-dialog")
    .getByRole("button", { name: "Discard and switch", exact: true })
    .click();
  await expect(page.getByText(/Workspace changed/)).toBeVisible();

  releaseFirstSave();
  await firstSaveFinished;
  await expect(page).not.toHaveURL(/draft-workspace-a/);

  await page.getByLabel("Post text").fill("Move this unsaved content safely to workspace B.");
  await expect(page).toHaveURL(/\/publications\/draft-workspace-b$/, {
    timeout: 10_000,
  });
  expect(savedWorkspaceIDs).toEqual([first.id, second.id]);
});
