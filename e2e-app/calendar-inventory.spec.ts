import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

function publication(
  id: string,
  workspaceID: string,
  status: "scheduled" | "published",
  occursAt: string,
) {
  return {
    id,
    text_post_id: `post-${id}`,
    workspace_id: workspaceID,
    created_by: "calendar-inventory-user",
    title: id.replaceAll("-", " "),
    intent: "post",
    content_profile: "short_text",
    source_text: `${id} body`,
    source_url: "",
    goal: "",
    audience: "",
    status,
    revision: 1,
    scheduled_at: status === "scheduled" ? occursAt : "",
    actual_run_at: status === "published" ? occursAt : "",
    created_at: occursAt,
    updated_at: occursAt,
    metadata: {},
    renditions: [],
    segments: [
      {
        id: `segment-${id}`,
        position: 0,
        body: `${id} body`,
        title: "",
        description: "",
        url: "",
        settings: {},
        media: [],
      },
    ],
    media: [],
  };
}

test("sidebar and full calendar use the same canonical publication inventory", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `calendar-inventory-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Calendar inventory",
  )) as {
    id: string;
    name: string;
  };
  await authenticatePage(page, auth.token);
  await page.addInitScript((currentWorkspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(currentWorkspace),
    );
  }, workspace);
  await page.clock.setFixedTime(new Date("2030-06-15T12:00:00Z"));

  const publications = [
    publication(
      "published-one",
      workspace.id,
      "published",
      "2030-06-13T10:00:00Z",
    ),
    publication(
      "published-two",
      workspace.id,
      "published",
      "2030-06-14T11:00:00Z",
    ),
    publication(
      "scheduled-one",
      workspace.id,
      "scheduled",
      "2030-06-15T12:00:00Z",
    ),
  ];
  await page.route("**/api/v1/publications?**", async (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false" },
      json: status === "draft" ? [] : publications,
    });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });
  await page.route("**/api/v1/posts/schedule-overview?**", async (route) => {
    const month = new URL(route.request().url()).searchParams.get("month") ?? "";
    await route.fulfill({
      contentType: "application/json",
      json: {
        month,
        selected_workspace_id: workspace.id,
        days: month === "2030-06"
          ? [
              { date: "2030-06-13", count: 1 },
              { date: "2030-06-14", count: 1 },
              { date: "2030-06-15", count: 1 },
            ]
          : [],
        platforms: [],
        workspaces: [],
      },
    });
  });

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/calendar?workspace=${workspace.id}`);

  await expect(page.locator("[data-calendar-item]")).toHaveCount(3);
  await expect(
    page
      .getByTestId("sidebar-rolling-calendar")
      .locator('span[aria-hidden="true"].rounded-full'),
  ).toHaveCount(3);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-calendar-item]")).toHaveCount(3);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  expect(consoleErrors).toEqual([]);
});

test("desktop month view keeps dense days compact and reveals the full day", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `calendar-density-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Calendar density",
  )) as {
    id: string;
    name: string;
  };
  await authenticatePage(page, auth.token);
  await page.addInitScript((currentWorkspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(currentWorkspace),
    );
  }, workspace);
  await page.clock.setFixedTime(new Date("2030-06-15T12:00:00Z"));

  const publications = [
    publication("dense-one", workspace.id, "scheduled", "2030-06-15T13:00:00Z"),
    publication("dense-two", workspace.id, "scheduled", "2030-06-15T14:00:00Z"),
    publication(
      "dense-three",
      workspace.id,
      "scheduled",
      "2030-06-15T15:00:00Z",
    ),
    publication(
      "dense-four",
      workspace.id,
      "scheduled",
      "2030-06-15T16:00:00Z",
    ),
  ];
  await page.route("**/api/v1/publications?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false" },
      json: publications,
    });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/calendar?workspace=${workspace.id}`);

  const month = page.getByRole("region", {
    name: "Monthly publishing calendar",
  });
  await expect(month).toBeVisible();
  const inlineItems = month.locator("[data-calendar-item]");
  await expect(inlineItems).toHaveCount(2);
  await expect(month.locator("[data-calendar-item]:visible")).toHaveCount(1);

  const eventHeight = await inlineItems
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(eventHeight).toBeLessThanOrEqual(24);

  const monthBounds = await month.boundingBox();
  expect(monthBounds).not.toBeNull();
  expect(
    (monthBounds?.y ?? 0) + (monthBounds?.height ?? 0),
  ).toBeLessThanOrEqual(820);

  await page
    .getByRole("button", {
      name: "View 4 posts on Saturday, Jun 15",
      exact: true,
    })
    .click();
  const drawer = page.getByTestId("calendar-day-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("4 posts");
  for (const item of publications) {
    await expect(drawer).toContainText(item.title);
  }

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  expect(consoleErrors).toEqual([]);
});
