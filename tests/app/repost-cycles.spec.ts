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
      `repost-cycle-${viewport.width}-${viewport.scheme}-${Date.now()}@example.com`,
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

    await page.goto("/settings?tab=reposts");
    const settings = page.getByTestId("repost-automation-settings");
    await expect(settings).toBeVisible();
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
