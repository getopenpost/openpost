import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createPublication,
  createWorkspace,
  registerUser,
  expectPostText,
} from "./helpers";

test.describe("calendar date selection", () => {
  test("Calendar keeps the chosen date across Month and Week and opens the composer on that date", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const auth = await registerUser(request, `agenda-labels-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Agenda labels");
    expect(
      (
        await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          data: { timezone: "UTC", week_start: 0 },
        })
      ).ok(),
    ).toBe(true);
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "Audit cross-month week",
    );
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='published',actual_run_at='2026-09-28 12:00:00+00:00' WHERE id='${publication.id}';`,
    ]);
    await authenticatePage(page, auth.token);
    await page.goto("/calendar");
    const width = 1168;
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/calendar");
    const picker = page.getByTestId("calendar-date-picker");
    const chosenDate = picker.getByRole("button", { name: "Monday, Sep 28", exact: true });
    await chosenDate.click();
    await expect(chosenDate).toHaveAccessibleDescription("1 post");
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page.locator("main p[aria-live='polite']")).toHaveText(/Sep 27.*Oct 3, 2026/);
    await expect(chosenDate).toHaveAttribute("aria-pressed", "true");
    await chosenDate.focus();
    await page.keyboard.press("ArrowUp");
    const previousWeekDate = picker.getByRole("button", {
      name: "Monday, Sep 21",
      exact: true,
    });
    await expect(previousWeekDate).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(chosenDate).toBeFocused();
    await expect(page.getByRole("button", { name: /Audit cross-month week/ })).toBeVisible();
    const selectionColor = await chosenDate.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const nextMonthDate = picker.getByRole("button", { name: "Thursday, Oct 1", exact: true });
    await nextMonthDate.click();
    await expect(nextMonthDate).toHaveAttribute("aria-pressed", "true");
    await expect(chosenDate).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() => nextMonthDate.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(selectionColor);
    await expect(page.getByRole("heading", { name: "Thursday, Oct 1", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Audit cross-month week/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(
      picker.getByRole("button", { name: "Thursday, Oct 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Create post", exact: true }).click();
    await expect(page).toHaveURL(/date=2026-10-01/);
    expect(errors).toEqual([]);
  });
});

test.describe("post list and details", () => {
  test("publications keeps the main workflow clear across list, search, and calendar", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `publications-ux-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Publication workspace");
    const created = await createPublication(
      request,
      auth.token,
      workspace.id,
      "A clear launch note for the publication workspace",
    );
    await authenticatePage(page, auth.token);

    await page.goto("/publications?tab=drafts");
    await expect(page.getByRole("heading", { name: "Posts", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search posts" })).toBeVisible();
    const selectedTab = page.getByRole("tab", { name: "Drafts", exact: true });
    await expect(selectedTab).toHaveCSS("border-radius", "0px");
    await expect(selectedTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.getByTestId("publication-list")).toContainText("A clear launch note");

    await page.getByRole("searchbox", { name: "Search posts" }).fill("does not exist");
    await expect(page.getByTestId("publication-list")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search posts" }).fill("launch note");
    await expect(page.getByTestId("publication-list")).toContainText("A clear launch note");

    await page
      .getByRole("link", { name: "A clear launch note for the publication workspace", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/publications/${created.id}$`));

    await page.goto("/publications?tab=drafts");
    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole("heading", { name: "Posts", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "List" }).click();
    await expect(page).toHaveURL(/\/publications(?:\?.*)?$/);
    await expect(page.getByRole("tab", { name: "Drafts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Published", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("tab", { name: "Published", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("tab", { name: "Drafts", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Drafts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("publication delivery details keep distinct targets for the same account", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `publication-targets-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Multiple targets");
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "One account, two destinations",
    );
    await authenticatePage(page, auth.token);
    await page.route("**/api/v1/publications?**", async (route) => {
      const response = await route.fetch();
      const publications = await response.json();
      await route.fulfill({
        response,
        json: publications.map((item: { id: string }) =>
          item.id === publication.id
            ? {
                ...item,
                renditions: ["first-channel", "second-channel"].map((target, index) => ({
                  id: `rendition-${index}`,
                  social_account_id: "same-account",
                  platform: "telegram",
                  target_key: target,
                  status: "draft",
                  segments: [],
                  metadata: {},
                })),
              }
            : item,
        ),
      });
    });
    await page.goto("/publications?tab=drafts");
    const list = page.getByTestId("publication-list");
    await expect(list).toContainText("One account, two destinations");
    await list.locator("summary").click();
    await expect(list.getByText("Target first-channel", { exact: true })).toBeVisible();
    await expect(list.getByText("Target second-channel", { exact: true })).toBeVisible();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='scheduled',scheduled_at='2099-01-01 12:00:00+00:00' WHERE id='${publication.id}';`,
    ]);
    await page.goto("/publications?tab=scheduled&view=grid");
    const grid = page.getByTestId("publication-grid");
    await expect(grid).toContainText("One account, two destinations");
    await grid.locator("summary").click();
    await expect(grid.getByText("Target first-channel", { exact: true })).toBeVisible();
    await expect(grid.getByText("Target second-channel", { exact: true })).toBeVisible();
  });

  test("published records show a confirmed local removal action", async ({ page, request }) => {
    const auth = await registerUser(request, `published-delete-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Published cleanup");
    const created = await createPublication(
      request,
      auth.token,
      workspace.id,
      "A removed test post",
    );
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='published', actual_run_at=CURRENT_TIMESTAMP WHERE id='${created.id}';`,
    ]);
    const stored = await request.get(`/api/v1/publications/${created.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect((await stored.json()).status).toBe("published");
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${created.id}`);
    await page.getByRole("button", { name: "Remove from OpenPost", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Posts on social networks will not be deleted");
    await dialog.getByRole("button", { name: "Remove from OpenPost", exact: true }).click();
    await expect(page).toHaveURL(/\/publications(?:\?.*)?$/);
    const result = await request.get(`/api/v1/publications/${created.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(result.status()).toBe(404);
  });
});

test.describe("schedule clock", () => {
  const clocks = [
    {
      workspaceZone: "Europe/Lisbon",
      browserZone: "Asia/Tokyo",
      scheduledTime: "04:00 PM",
      publishedTime: "04:11 PM",
      dstTime: "01:57 AM",
      boundarySchedule: "2026-10-02T23:02:00Z",
      boundaryDispatch: "2026-10-02T22:57:00Z",
      dayFrom: "2026-10-02T23:00:00Z",
      dayBefore: "2026-10-03T23:00:00Z",
    },
    {
      workspaceZone: "UTC",
      browserZone: "America/Los_Angeles",
      scheduledTime: "03:00 PM",
      publishedTime: "03:11 PM",
      dstTime: "12:57 AM",
      boundarySchedule: "2026-10-03T00:02:00Z",
      boundaryDispatch: "2026-10-02T23:57:00Z",
      dayFrom: "2026-10-03T00:00:00Z",
      dayBefore: "2026-10-04T00:00:00Z",
    },
  ] as const;

  for (const clock of clocks) {
    test.describe(`${clock.workspaceZone} workspace and ${clock.browserZone} browser`, () => {
      test.use({ timezoneId: clock.browserZone });
      test("planned List and Calendar share the authored clock while published outcomes use actual time", async ({
        page,
        request,
      }) => {
        test.setTimeout(90_000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        const auth = await registerUser(request, `schedule-clock-${randomUUID()}@example.com`);
        const workspace = await createWorkspace(request, auth.token, "Schedule clock");
        const headers = { Authorization: `Bearer ${auth.token}` };
        const settings = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
          headers,
          data: { timezone: clock.workspaceZone },
        });
        expect(settings.ok()).toBe(true);
        const fixtures = [
          {
            text: "Audit schedule with dispatch jitter",
            status: "scheduled",
            scheduledAt: "2026-10-02T15:00:00Z",
            actualAt: "2026-10-02T15:11:00Z",
            day: "Oct 2",
            time: clock.scheduledTime,
          },
          {
            text: "Audit authored midnight boundary",
            status: "scheduled",
            scheduledAt: clock.boundarySchedule,
            actualAt: clock.boundaryDispatch,
            day: "Oct 3",
            time: "12:02 AM",
          },
          {
            text: "Audit publishing through autumn clock change",
            status: "publishing",
            scheduledAt: "2026-10-25T00:57:00Z",
            actualAt: "2026-10-25T01:02:00Z",
            day: "Oct 25",
            time: clock.dstTime,
          },
          {
            text: "Audit published recorded outcome",
            status: "published",
            scheduledAt: "2026-10-02T15:00:00Z",
            actualAt: "2026-10-02T15:11:00Z",
            day: "Oct 2",
            time: clock.publishedTime,
          },
        ];
        const records: Array<{ id: string; scheduledAt: string; actualAt: string }> = [];
        for (const fixture of fixtures) {
          const publication = await createPublication(
            request,
            auth.token,
            workspace.id,
            fixture.text,
          );
          // Read fixtures have no jobs or provider destinations, so no delivery can execute.
          execFileSync("sqlite3", [
            "-cmd",
            ".timeout 5000",
            `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
            `UPDATE publications SET status='${fixture.status}', scheduled_at='${fixture.scheduledAt.replace("T", " ").replace("Z", "+00:00")}', actual_run_at='${fixture.actualAt.replace("T", " ").replace("Z", "+00:00")}', random_delay_minutes=15 WHERE id='${publication.id}';`,
          ]);
          records.push({
            id: publication.id,
            scheduledAt: fixture.scheduledAt,
            actualAt: fixture.actualAt,
          });
        }
        const boundaryRange = await request.get("/api/v1/publications", {
          headers,
          params: {
            workspace_id: workspace.id,
            calendar_from: clock.dayFrom,
            calendar_before: clock.dayBefore,
          },
        });
        expect(boundaryRange.ok()).toBe(true);
        expect((await boundaryRange.json()).map((item: { id: string }) => item.id)).toEqual([
          records[1].id,
        ]);
        await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z"));
        await page.setViewportSize({ width: 390, height: 900 });
        await authenticatePage(page, auth.token);
        await page.goto("/calendar");
        for (const fixture of fixtures) {
          await page
            .getByTestId("calendar-date-picker")
            .getByRole("button", { name: new RegExp(`${fixture.day}$`) })
            .click();
          const item = page.getByRole("button").filter({ hasText: fixture.text });
          await expect(item).toContainText(fixture.time);
          await expect(
            item.locator("xpath=ancestor::section[1]").getByRole("heading"),
          ).toContainText(fixture.day);
        }
        await page.getByRole("link", { name: "List", exact: true }).click();
        await page.getByRole("tab", { name: "Scheduled", exact: true }).click();
        for (const fixture of fixtures.filter((item) => item.status !== "published")) {
          await expect(page.locator("article").filter({ hasText: fixture.text })).toContainText(
            `${fixture.day}, ${fixture.time}`,
          );
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.reload();
        await expect(page.getByRole("tab", { name: "Scheduled", exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        const scheduled = page.locator("article").filter({ hasText: fixtures[0].text });
        await expect(scheduled).toContainText(`Oct 2, ${clock.scheduledTime}`);
        const calendar = page.getByRole("link", { name: "Calendar", exact: true });
        await calendar.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("heading", { name: "Posts", exact: true })).toBeVisible();
        await expect(page.getByRole("button").filter({ hasText: fixtures[0].text })).toContainText(
          clock.scheduledTime,
        );
        const list = page.getByRole("link", { name: "List", exact: true });
        await list.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("tab", { name: "Scheduled", exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(scheduled).toContainText(`Oct 2, ${clock.scheduledTime}`);
        await page.getByRole("tab", { name: "Published", exact: true }).click();
        await expect(page.locator("article").filter({ hasText: fixtures[3].text })).toContainText(
          `${fixtures[3].day}, ${fixtures[3].time}`,
        );
        for (const record of records) {
          const response = await request.get(`/api/v1/publications/${record.id}`, { headers });
          expect(response.ok()).toBe(true);
          const persisted = await response.json();
          expect(persisted.scheduled_at).toBe(record.scheduledAt);
          expect(persisted.actual_run_at).toBe(record.actualAt);
        }
        expect(errors).toEqual([]);
      });
    });
  }
});

test.describe("repost cycles", () => {
  test("edits a repost cycle", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const auth = await registerUser(request, `repost-cycle-${randomUUID()}@example.com`);
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

    await page.goto("/workflows");
    await page.getByRole("link", { name: "Launch cycle Automatic reposting Active" }).click();
    await expect(page).toHaveURL(/\/workflows\/reposts/);
    const settings = page.getByTestId("repost-automation-settings");
    await expect(settings).toBeVisible();
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    await page.getByText("Original launch rule", { exact: true }).click();
    await expect(page.getByText("Waiting · 1/2", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open post", exact: true })).toHaveAttribute(
      "href",
      "/publications/existing-publication",
    );
    await page.getByRole("tab", { name: "Configure", exact: true }).click();
    const addRepost = settings.getByRole("button", { name: "Add repost" });
    await addRepost.focus();
    await expect(addRepost).toBeFocused();
    await page.keyboard.press("Enter");
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
    await settings.getByRole("group", { name: "Repost schedule" }).scrollIntoViewIfNeeded();
    expect(browserErrors).toEqual([]);
  });

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
});

test.describe("thread reorder", () => {
  test("thread authoring reorder supports keyboard preview, drop, cancel, and undo", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const unique = `authoring-order-${randomUUID()}@example.com`;
    const auth = await registerUser(request, unique);
    const workspace = await createWorkspace(request, auth.token, "Authoring order");
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "First draft post",
    );
    await authenticatePage(page, auth.token);

    const saves: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/v1/publications")) {
        saves.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto(`/publications/${publication.id}`);
    const composer = page.getByTestId("text-thread-composer-content");
    await expect(composer).toBeVisible({ timeout: 30000 });

    await page.locator("#post-textarea-0").fill("First edited post");
    await composer.getByRole("button", { name: "Add post", exact: true }).click();
    await expect(page.locator("#post-textarea-1")).toBeVisible();
    await page.locator("#post-textarea-1").fill("Second edited post");

    // Wait for the edits to autosave, then prove keyboard preview does not save again.
    await expect.poll(() => saves.length, { timeout: 10_000 }).toBeGreaterThan(0);
    saves.length = 0;
    const handles = composer.locator("[data-reorder-key]");
    await expect(handles).toHaveCount(2);
    await handles.nth(0).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await expectPostText(page.locator("#post-textarea-0"), "Second edited post");
    await expectPostText(page.locator("#post-textarea-1"), "First edited post");
    // Autosave debounces for about two seconds; no save may appear within that window.
    await expect(async () => expect(saves).not.toHaveLength(0)).not.toPass({ timeout: 2_500 });

    await page.keyboard.press("Escape");
    await expectPostText(page.locator("#post-textarea-0"), "First edited post");
    await expectPostText(page.locator("#post-textarea-1"), "Second edited post");

    await handles.nth(0).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expectPostText(page.locator("#post-textarea-0"), "Second edited post");
    await expectPostText(page.locator("#post-textarea-1"), "First edited post");

    const undo = composer.getByRole("button", { name: "Undo reorder", exact: true });
    await expect(undo).toBeVisible();
    await page.locator("#post-textarea-0").fill("Second edited after reorder");
    await undo.click();
    await expectPostText(page.locator("#post-textarea-0"), "First edited post");
    await expectPostText(page.locator("#post-textarea-1"), "Second edited after reorder");
    const text = page.locator("#post-textarea-1");
    const textBounds = await text.boundingBox();
    const removeBounds = await composer
      .getByRole("button", { name: "Remove post", exact: true })
      .nth(1)
      .boundingBox();
    const padding = await text.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingRight),
    );
    expect(textBounds).not.toBeNull();
    expect(removeBounds).not.toBeNull();
    expect(textBounds!.x + textBounds!.width - padding).toBeLessThanOrEqual(removeBounds!.x);
    expect(errors).toEqual([]);
  });
});
