import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const viewport of [
  { width: 1440, height: 900, scheme: "light" as const },
  { width: 390, height: 844, scheme: "dark" as const },
  { width: 320, height: 720, scheme: "light" as const },
]) {
  test(`edits a repost cycle at ${viewport.width}px ${viewport.scheme}`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.emulateMedia({
      colorScheme: viewport.scheme,
      reducedMotion: "reduce",
    });
    const auth = await registerUser(
      request,
      `repost-cycle-${viewport.width}-${viewport.scheme}-${randomUUID()}@example.com`,
    );
    const workspace = (await createWorkspace(request, auth.token, "Repost cycle")) as {
      id: string;
    };
    await authenticatePage(page, auth.token);
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });

    let savedBody: unknown;
    await page.route(/\/api\/v1\/repost-automation(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "PUT") {
        savedBody = route.request().postDataJSON();
      }
      const response = settingsResponse(workspace.id);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          savedBody
            ? {
                ...response,
                policies: (savedBody as { policies: unknown[] }).policies,
              }
            : response,
        ),
      });
    });

    if (viewport.width === 1440) {
      await page.goto("/workflows");
      await page.getByRole("link", { name: "Launch cycle Automatic reposting Active" }).click();
    } else {
      await page.goto("/settings?tab=reposts");
    }
    await expect(page).toHaveURL(/\/workflows\/reposts/);
    const settings = page.getByTestId("repost-automation-settings");
    await expect(settings).toBeVisible();
    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await page.getByText("Original launch rule", { exact: true }).click();
    await expect(page.getByText("Waiting · 1/2", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open post", exact: true })).toHaveAttribute(
      "href",
      "/publications/existing-publication",
    );
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath("repost-cycle-before.png"),
      fullPage: true,
    });
    const addRepost = settings.getByRole("button", { name: "Add repost" });
    if (viewport.width === 1440) {
      await addRepost.focus();
      await expect(addRepost).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath("repost-cycle-focus.png"),
      });
      await page.keyboard.press("Enter");
    } else {
      await addRepost.click();
    }
    await expect(settings.getByText("Repost 2")).toBeVisible();
    await expect(settings.getByText("Remove the previous repost first")).toBeVisible();
    await settings.getByRole("button", { name: "Save changes" }).click();
    await expect
      .poll(() => savedBody)
      .toEqual({
        workspace_id: workspace.id,
        expected_revision: "saved-revision",
        policies: [
          expect.objectContaining({
            rule: expect.objectContaining({
              stages: [
                { delay_seconds: 0, unrepost_previous: false },
                { delay_seconds: 900, unrepost_previous: true },
              ],
            }),
          }),
        ],
      });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    if (viewport.width <= 390) {
      for (const control of [
        settings.getByRole("button", { name: "Add repost" }),
        settings.getByRole("button", { name: "Remove repost 1" }),
        settings.getByRole("button", { name: "Remove repost 2" }),
      ]) {
        const box = await control.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    }
    await settings.getByRole("group", { name: "Repost schedule" }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("repost-cycle-stage.png"),
    });
    await page.screenshot({
      path: testInfo.outputPath("repost-cycle.png"),
      fullPage: true,
    });
    expect(browserErrors).toEqual([]);
  });
}

function settingsResponse(workspaceID: string) {
  return {
    workspace_id: workspaceID,
    can_manage: true,
    revision: "saved-revision",
    executions: [
      {
        id: "existing-run",
        policy_id: `${workspaceID}-policy`,
        policy_name: "Original launch rule",
        publication_id: "existing-publication",
        target_account_id: `${workspaceID}-account`,
        status: "pending",
        current_stage: 1,
        total_stages: 2,
        created_at: "2026-09-20T12:00:00Z",
        next_check_at: "2026-09-23T12:00:00Z",
        rule: {},
        history: [],
      },
    ],
    accounts: [
      {
        id: `${workspaceID}-account`,
        workspace_id: workspaceID,
        workspace_name: "Repost cycle",
        username: "launch-account",
        platform: "x",
        cross_workspace: false,
        grant_active: false,
        grant_required: false,
        supports_repost: true,
      },
    ],
    grants: [],
    policies: [
      {
        id: `${workspaceID}-policy`,
        name: "Launch cycle",
        enabled: true,
        source_account_ids: [],
        target_account_ids: [`${workspaceID}-account`],
        rule: {
          delay_seconds: 0,
          evaluation_window_seconds: 3600,
          threshold_mode: "all",
          min_likes: 0,
          min_comments: 0,
          min_reposts: 0,
          min_views: 0,
          require_plateau: false,
          plateau_checks: 2,
        },
      },
    ],
    supported_platforms: ["x"],
  };
}
