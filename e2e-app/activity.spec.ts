import { expect, test } from "@playwright/test";

test("failed delivery details stay secondary to post status", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: "user-1",
        email: "activity@example.com",
        is_admin: false,
        created_at: "2026-07-01T00:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/workspaces", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        { id: "ws-1", name: "Posts E2E", created_at: "2026-07-01T00:00:00Z" },
      ],
    });
  });
  await page.route("**/api/v1/workspaces/ws-1/settings", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { timezone: "UTC", week_start: 1 },
    });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });
  const publications = [
    {
      id: "scheduled-publication",
      text_post_id: "scheduled-parent",
      workspace_id: "ws-1",
      created_by: "user-1",
      title: "Scheduled thread parent",
      intent: "thread",
      content_profile: "thread",
      source_text: "Scheduled thread parent",
      source_url: "",
      goal: "",
      audience: "",
      status: "scheduled",
      revision: 1,
      scheduled_at: "2026-07-21T12:00:00Z",
      actual_run_at: "",
      created_at: "2026-07-20T10:00:00Z",
      updated_at: "2026-07-20T10:00:00Z",
      metadata: {},
      renditions: [],
      segments: [
        {
          id: "scheduled-parent",
          position: 0,
          body: "Scheduled thread parent",
          title: "",
          description: "",
          url: "",
          settings: {},
          media: [],
        },
        {
          id: "scheduled-child",
          position: 1,
          body: "Scheduled thread child",
          title: "",
          description: "",
          url: "",
          settings: {},
          media: [],
        },
      ],
      media: [],
    },
    {
      id: "published-publication",
      text_post_id: "published-parent",
      workspace_id: "ws-1",
      created_by: "user-1",
      title: "Published thread parent",
      intent: "thread",
      content_profile: "thread",
      source_text: "Published thread parent",
      source_url: "",
      goal: "",
      audience: "",
      status: "published",
      revision: 1,
      scheduled_at: "",
      actual_run_at: "2026-07-20T09:00:00Z",
      created_at: "2026-07-20T09:00:00Z",
      updated_at: "2026-07-20T09:00:00Z",
      metadata: {},
      renditions: [],
      segments: [
        {
          id: "published-parent",
          position: 0,
          body: "Published thread parent",
          title: "",
          description: "",
          url: "",
          settings: {},
          media: [],
        },
        {
          id: "published-child",
          position: 1,
          body: "Published thread child",
          title: "",
          description: "",
          url: "",
          settings: {},
          media: [],
        },
      ],
      media: [],
    },
  ];
  await page.route("**/api/v1/publications?**", async (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false" },
      json: status
        ? publications.filter((publication) => publication.status === status)
        : publications,
    });
  });
  await page.route("**/api/v1/jobs**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "job-1",
          type: "publish_post",
          status: "failed",
          run_at: "2026-07-01T12:00:00Z",
          attempts: 3,
          max_attempts: 3,
          last_error: "Provider rejected the post",
        },
        {
          id: "job-2",
          type: "publish_thread",
          status: "failed",
          run_at: "2026-07-01T12:05:00Z",
          attempts: 3,
          max_attempts: 3,
          last_error: "Account authorization expired",
        },
      ],
    });
  });

  await page.goto("/activity");

  await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();
  const activityTabs = page.getByRole("tablist");
  await expect(activityTabs).toBeVisible();
  await expect
    .poll(() =>
      activityTabs.evaluate(
        (element) => element.scrollHeight <= element.clientHeight,
      ),
    )
    .toBe(true);
  const scheduledTab = page.getByRole("tab", { name: /Scheduled 1/ });
  await expect(scheduledTab).toBeVisible();
  const scheduledPanel = page.getByRole("tabpanel", { name: /Scheduled 1/ });
  await expect(
    scheduledPanel.getByText("Scheduled thread parent · 2 posts", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    scheduledPanel.getByText("Scheduled thread child", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Published 1/ }).click();
  const publishedPanel = page.getByRole("tabpanel", { name: /Published 1/ });
  await expect(
    publishedPanel.getByText("Published thread parent · 2 posts", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    publishedPanel.getByText("Published thread child", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Jobs" })).toHaveCount(0);
  await page.getByRole("tab", { name: /Failed 2/ }).click();

  const details = page.getByText("Technical details for 2 failed deliveries");
  await expect(details).toBeVisible();
  await details.click();
  await expect(page.getByText("Provider rejected the post")).toBeVisible();
  await expect(page.getByText("Account authorization expired")).toBeVisible();
});
