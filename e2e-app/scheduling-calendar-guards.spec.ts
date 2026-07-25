import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

type Workspace = {
  id: string;
  name: string;
};

type ScheduledPost = {
  id: string;
  workspace_id: string;
  created_by: string;
  content: string;
  status: "scheduled";
  scheduled_at: string;
  created_at: string;
  random_delay_minutes: number;
  destinations: Array<{
    platform: string;
    social_account_id: string;
    status: string;
  }>;
  media_ids: never[];
  parent_post_id?: string;
  thread_sequence?: number;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function scheduledPost(
  id: string,
  workspaceID: string,
  content: string,
  scheduledAt: string,
  thread?: { parentID: string; sequence: number },
): ScheduledPost {
  return {
    id,
    workspace_id: workspaceID,
    created_by: "calendar-guard-user",
    content,
    status: "scheduled",
    scheduled_at: scheduledAt,
    created_at: scheduledAt,
    random_delay_minutes: 0,
    destinations: [],
    media_ids: [],
    ...(thread
      ? {
          parent_post_id: thread.parentID,
          thread_sequence: thread.sequence,
        }
      : {}),
  };
}

async function createAuthenticatedWorkspace(
  page: Page,
  request: APIRequestContext,
  seed: string,
) {
  const auth = await registerUser(
    request,
    `scheduling-calendar-guard-${seed}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    `Calendar guard ${seed}`,
  )) as Workspace;
  await authenticatePage(page, auth.token);
  await page.addInitScript((currentWorkspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(currentWorkspace),
    );
  }, workspace);
  return { auth, workspace };
}

async function mockCalendarData(page: Page, posts: ScheduledPost[]) {
  await page.route("**/api/v1/posts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false" },
      json: posts,
    });
  });
  await page.route("**/api/v1/publications?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false" },
      json: [],
    });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });
}

test("a previous workspace next-slot response cannot replace the current schedule", async ({
  page,
  request,
}, testInfo) => {
  const seed = `${Date.now().toString(36)}-${testInfo.workerIndex}`;
  const auth = await registerUser(
    request,
    `next-slot-workspace-guard-${seed}@example.com`,
  );
  const first = (await createWorkspace(
    request,
    auth.token,
    `Previous ${seed}`,
  )) as Workspace;
  const second = (await createWorkspace(
    request,
    auth.token,
    `Current ${seed}`,
  )) as Workspace;
  await authenticatePage(page, auth.token);
  await page.addInitScript((currentWorkspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(currentWorkspace),
    );
  }, first);
  await page.clock.setFixedTime(new Date("2030-06-15T12:00:00.000Z"));

  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });

  const firstStarted = deferred();
  const releaseFirst = deferred();
  const firstFinished = deferred();
  const requestedWorkspaceIDs: string[] = [];
  await page.route(
    "**/api/v1/posting-schedules/next-slot?**",
    async (route) => {
      const workspaceID = new URL(route.request().url()).searchParams.get(
        "workspace_id",
      );
      requestedWorkspaceIDs.push(workspaceID ?? "");

      if (workspaceID === first.id) {
        firstStarted.resolve();
        await releaseFirst.promise;
        try {
          await route.fulfill({
            contentType: "application/json",
            json: {
              slot_time: "2030-06-20T09:00:00.000Z",
              message: "Previous workspace slot",
            },
          });
        } finally {
          firstFinished.resolve();
        }
        return;
      }

      expect(workspaceID).toBe(second.id);
      await route.fulfill({
        contentType: "application/json",
        json: {
          slot_time: "2030-06-25T15:30:00.000Z",
          message: "Current workspace slot",
        },
      });
    },
  );

  await page.goto("/");
  const scheduleButton = page
    .getByRole("button", { name: "Schedule", exact: true })
    .first();
  await expect(scheduleButton).toBeVisible();
  await scheduleButton.click();

  const scheduleDialog = page.getByTestId("schedule-dialog-shell");
  await expect(scheduleDialog).toBeVisible();
  await scheduleDialog
    .getByRole("button", { name: "Next free slot", exact: true })
    .click();
  await firstStarted.promise;

  await scheduleDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(scheduleDialog).toBeHidden();

  const workspaceButton = page
    .getByRole("button", { name: new RegExp(first.name) })
    .first();
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(second.name) }).first(),
  ).toBeVisible();

  await scheduleButton.click();
  await expect(scheduleDialog).toBeVisible();
  await scheduleDialog
    .getByRole("button", { name: "Next free slot", exact: true })
    .click();
  await expect(scheduleDialog).toContainText("Selected Jun 25 15:30");

  releaseFirst.resolve();
  await firstFinished.promise;

  await expect(scheduleDialog).toContainText("Selected Jun 25 15:30");
  await expect(scheduleDialog).not.toContainText("Jun 20 09:00");
  expect(requestedWorkspaceIDs).toEqual([first.id, second.id]);
});

test("portrait calendar and composer reject past creation and rescheduling", async ({
  page,
  request,
}, testInfo) => {
  const seed = `past-${Date.now().toString(36)}-${testInfo.workerIndex}`;
  const { workspace } = await createAuthenticatedWorkspace(page, request, seed);
  await page.clock.setFixedTime(new Date("2030-06-15T12:00:00.000Z"));
  await page.setViewportSize({ width: 390, height: 844 });

  const pastPost = scheduledPost(
    "past-post",
    workspace.id,
    "Past scheduled post",
    "2030-06-10T10:00:00.000Z",
  );
  const futurePost = scheduledPost(
    "future-post",
    workspace.id,
    "Future scheduled post",
    "2030-06-20T10:00:00.000Z",
  );
  await mockCalendarData(page, [pastPost, futurePost]);

  let rescheduleRequests = 0;
  await page.route("**/api/v1/posts/future-post", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    rescheduleRequests++;
    await route.fulfill({
      contentType: "application/json",
      json: futurePost,
    });
  });

  await page.goto("/calendar");

  const pastCreateAction = page.getByRole("button", {
    name: "Create post 2030-06-10",
    exact: true,
  });
  const futureCreateAction = page.getByRole("button", {
    name: "Create post 2030-06-20",
    exact: true,
  });
  await expect(pastCreateAction).toBeDisabled();
  await expect(futureCreateAction).toBeEnabled();
  await expect(page.locator("[data-calendar-item]:visible")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  const futureItem = page.locator(
    '[data-calendar-item][aria-label="Open Future scheduled post"]',
  );
  const pastDay = page.locator('[role="group"]').filter({
    has: page.getByRole("button", {
      name: "Create post 2030-06-10",
      exact: true,
    }),
  });
  const futureDay = page.locator('[role="group"]').filter({
    has: page.getByRole("button", {
      name: "Create post 2030-06-20",
      exact: true,
    }),
  });
  const todayDay = page.locator('[role="group"]').filter({
    has: page.getByRole("button", {
      name: "Create post 2030-06-15",
      exact: true,
    }),
  });
  await expect(futureItem).toBeVisible();
  await expect(pastDay).toHaveCount(1);
  await expect(todayDay).toHaveCount(1);

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await futureItem.dispatchEvent("dragstart", { dataTransfer });
  await pastDay.dispatchEvent("dragover", { dataTransfer });
  await expect(pastDay).not.toHaveClass(/ring-2/);
  await pastDay.dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();

  await expect(
    page.getByText("Choose today or a future date.", { exact: true }),
  ).toBeVisible();
  await expect(
    futureDay.locator(
      '[data-calendar-item][aria-label="Open Future scheduled post"]',
    ),
  ).toBeVisible();
  expect(rescheduleRequests).toBe(0);

  const sameDayTransfer = await page.evaluateHandle(() => new DataTransfer());
  await futureItem.dispatchEvent("dragstart", {
    dataTransfer: sameDayTransfer,
  });
  await todayDay.dispatchEvent("dragover", {
    dataTransfer: sameDayTransfer,
  });
  await expect(todayDay).toHaveClass(/ring-2/);
  await todayDay.dispatchEvent("drop", { dataTransfer: sameDayTransfer });
  await sameDayTransfer.dispose();

  await expect(
    page.getByText("Choose today or a future date.", { exact: true }),
  ).toBeVisible();
  await expect(
    futureDay.locator(
      '[data-calendar-item][aria-label="Open Future scheduled post"]',
    ),
  ).toBeVisible();
  expect(rescheduleRequests).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?date=2030-06-10&workspace_id=${workspace.id}`);

  await expect(
    page.getByText("Choose a future date and time.", { exact: true }),
  ).toBeVisible();
  const mobileScheduleButton = page
    .getByTestId("composer-action-controls")
    .getByRole("button", { name: "Schedule", exact: true });
  await expect(mobileScheduleButton).toBeVisible();
  await mobileScheduleButton.click();

  const scheduleDialog = page.getByTestId("schedule-dialog-shell");
  await expect(scheduleDialog).toContainText("Select a date and time.");
  await expect(scheduleDialog.getByText(/^Selected /)).toHaveCount(0);
});

test("a scheduled thread renders only its parent as a calendar item", async ({
  page,
  request,
}, testInfo) => {
  const seed = `thread-${Date.now().toString(36)}-${testInfo.workerIndex}`;
  const { workspace } = await createAuthenticatedWorkspace(page, request, seed);
  await page.clock.setFixedTime(new Date("2030-06-15T12:00:00.000Z"));
  await page.setViewportSize({ width: 390, height: 844 });

  const parent = scheduledPost(
    "thread-parent",
    workspace.id,
    "Thread opener",
    "2030-06-20T10:00:00.000Z",
  );
  const child = scheduledPost(
    "thread-child",
    workspace.id,
    "Thread reply",
    "2030-06-20T10:05:00.000Z",
    { parentID: parent.id, sequence: 1 },
  );
  await mockCalendarData(page, [parent, child]);

  await page.goto("/calendar");

  await expect(page.getByRole("button", { name: /Thread opener/ })).toHaveCount(
    1,
  );
  await expect(page.getByText("Thread reply", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("[data-calendar-item]")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Open Thread opener", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Thread reply", exact: true }),
  ).toHaveCount(0);
});

test("the day drawer keeps scheduled posts compact and icon-led", async ({
  page,
  request,
}, testInfo) => {
  const seed = `drawer-${Date.now().toString(36)}-${testInfo.workerIndex}`;
  const { workspace } = await createAuthenticatedWorkspace(page, request, seed);
  await page.clock.setFixedTime(new Date("2030-06-15T12:00:00.000Z"));
  await page.setViewportSize({ width: 1280, height: 800 });

  const post = scheduledPost(
    "drawer-post",
    workspace.id,
    "A deliberately long scheduled post preview that should stay compact in the day drawer instead of taking over the entire panel with several lines of copy.",
    "2030-06-20T10:00:00.000Z",
  );
  post.destinations = [
    {
      platform: "bluesky",
      social_account_id: "drawer-bluesky",
      status: "scheduled",
    },
    {
      platform: "linkedin",
      social_account_id: "drawer-linkedin",
      status: "scheduled",
    },
    {
      platform: "threads",
      social_account_id: "drawer-threads",
      status: "scheduled",
    },
  ];

  await mockCalendarData(page, [post]);
  await page.route("**/api/v1/posts/schedule-overview?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        year: 2030,
        month: 6,
        selected_workspace_id: workspace.id,
        selected_platform: "",
        days: [
          {
            date: "2030-06-20",
            count: 1,
            platforms: [
              { platform: "bluesky", count: 1 },
              { platform: "linkedin", count: 1 },
              { platform: "threads", count: 1 },
            ],
            workspaces: [{ workspace_id: workspace.id, count: 1 }],
          },
        ],
        platforms: ["bluesky", "linkedin", "threads"],
        workspaces: [],
      },
    });
  });

  await page.goto("/");
  const planner = page.getByTestId("desktop-sidebar-planner");
  await expect(planner).toBeVisible();
  await planner.getByRole("button", { name: /June 20, 2030/ }).click();

  const drawer = page.getByTestId("day-posts-drawer");
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("heading", { name: "Thu, Jun 20" }),
  ).toBeVisible();
  await expect(drawer.getByText("Scheduled: 1", { exact: true })).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "New post", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByText(/A deliberately long scheduled post preview/),
  ).toBeVisible();

  const destinations = drawer.getByTestId("day-post-destinations");
  await expect(destinations).toHaveAttribute("aria-label", "Destinations: 3");
  await expect(destinations.locator("svg")).toHaveCount(3);
  await expect(drawer.getByText("Bluesky", { exact: true })).not.toBeVisible();
  await expect(drawer.getByText("LinkedIn", { exact: true })).not.toBeVisible();
  await expect(drawer.getByText("Threads", { exact: true })).not.toBeVisible();

  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.width).toBeGreaterThanOrEqual(500);

  await page.setViewportSize({ width: 390, height: 844 });
  const portraitDrawerBox = await drawer.boundingBox();
  expect(portraitDrawerBox).not.toBeNull();
  expect(portraitDrawerBox!.width).toBeCloseTo(390, 3);
});
