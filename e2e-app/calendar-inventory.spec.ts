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

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/calendar?workspace=${workspace.id}`);

  await expect(page.locator("[data-calendar-item]")).toHaveCount(3);
  await expect(
    page
      .getByTestId("desktop-sidebar-planner")
      .locator('span[aria-hidden="true"].rounded-full.bg-primary'),
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
