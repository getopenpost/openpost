import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("communications and notifications stay usable across desktop and phone layouts", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  const unauthorizedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() === 401) unauthorizedResponses.push(response.url());
  });

  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `communications-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Communications E2E",
  )) as { id: string };
  await authenticatePage(page, auth.token);
  let engagementArchived = false;

  await page.route("**/api/v1/engagement**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      if (url.pathname.endsWith("/engagement/state")) {
        const body = route.request().postDataJSON() as {
          archived?: boolean;
        };
        if (body.archived !== undefined) {
          engagementArchived = body.archived;
        }
      }
      await route.fulfill({ status: 204 });
      return;
    }
    if (url.searchParams.get("platform")) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const showingArchived = url.searchParams.get("archived") === "true";
    await route.fulfill({
      contentType: "application/json",
      json: {
        total: showingArchived === engagementArchived ? 1 : 0,
        sync_states: [
          {
            id: "engagement-sync-youtube",
            rendition_id: "rendition-1",
            social_account_id: "account-youtube",
            platform: "youtube",
            status: "failed",
            error_code: "provider_error",
            error_message:
              "OpenPost could not collect engagement from this provider.",
          },
        ],
        items:
          showingArchived === engagementArchived
            ? [
                {
                  id: "engagement-1",
                  workspace_id: workspace.id,
                  rendition_id: "rendition-1",
                  social_account_id: "account-youtube",
                  platform: "youtube",
                  remote_id: "comment-1",
                  parent_remote_id: "",
                  conversation_remote_id: "",
                  author_remote_id: "channel-ada",
                  author_name: "Ada",
                  author_handle: "@ada",
                  author_avatar_url: "",
                  body: "Could you share the setup guide?",
                  is_ours: false,
                  can_reply: true,
                  can_hide: false,
                  can_delete: true,
                  hidden: false,
                  ...(engagementArchived
                    ? { archived_at: "2026-07-26T12:05:00Z" }
                    : {}),
                  remote_created_at: "2026-07-26T11:45:00Z",
                  last_seen_at: "2026-07-26T12:00:00Z",
                  created_at: "2026-07-26T12:00:00Z",
                  updated_at: "2026-07-26T12:00:00Z",
                  provider_post_url:
                    "https://www.youtube.com/watch?v=walkthrough-1",
                },
              ]
            : [],
      },
    });
  });

  await page.route("**/api/v1/messages**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 204 });
      return;
    }
    const base = {
      id: "conversation-1",
      workspace_id: workspace.id,
      social_account_id: "account-instagram",
      platform: "instagram",
      remote_conversation_id: "ig-conversation-1",
      counterpart_remote_id: "ig-user-ada",
      counterpart_name: "Ada",
      counterpart_handle: "@ada",
      counterpart_avatar_url: "",
      last_message_at: "2026-07-26T11:55:00Z",
      last_message_preview: "Is this available for teams?",
      last_remote_message_id: "message-1",
      unread_count: 1,
      read_at: "",
      archived_at: "",
      messaging_window_expires_at: new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      created_at: "2026-07-26T11:55:00Z",
      updated_at: "2026-07-26T11:55:00Z",
    };
    if (url.pathname.endsWith("/messages")) {
      if (url.searchParams.get("archived") === "true") {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await route.fulfill({
        contentType: "application/json",
        json: { items: [base], total: 1, sync_states: [] },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "message-1",
          workspace_id: workspace.id,
          conversation_id: base.id,
          remote_message_id: "ig-message-1",
          direction: "inbound",
          author_remote_id: "ig-user-ada",
          body: "Is this available for teams?",
          attachments_json: "[]",
          send_status: "received",
          error_message: "",
          remote_created_at: "2026-07-26T11:55:00Z",
          created_at: "2026-07-26T11:55:00Z",
          updated_at: "2026-07-26T11:55:00Z",
        },
      ],
    });
  });

  await page.route("**/api/v1/notifications**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/notifications/preferences")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          post_published: { in_app: true },
          new_engagement: { in_app: true },
          new_message: { in_app: true },
        },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        items: [
          {
            id: "notification-1",
            user_id: "user-1",
            workspace_id: workspace.id,
            type: "new_message",
            title: "New message from Ada",
            body: "Is this available for teams?",
            href: "/messages",
            payload_json: "{}",
            read_at: "",
            created_at: "2026-07-26T11:55:00Z",
          },
        ],
        unread_count: 1,
        next_cursor: "",
      },
    });
  });

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/engagement?workspace=${workspace.id}`);
  await expect(page.getByRole("heading", { name: "Engagement" })).toBeVisible();
  await expect(
    page.getByText("Could you share the setup guide?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collection issues (1)" }).click();
  await expect(
    page.getByText("Posts with collection issues", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^YouTube$/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "OpenPost could not collect new replies. It will try again automatically.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Reply" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open post on YouTube" }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=walkthrough-1");
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);
  await expect(
    page.getByText(
      "Archive removes an item from this inbox without deleting it on the social network.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "All platforms" }).click();
  await page.getByRole("option", { name: "YouTube" }).click();
  await expect(
    page.getByText("Could you share the setup guide?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Could you share the setup guide?")).toHaveCount(
    0,
  );
  await expect(page.getByText("Item archived.")).toBeVisible();
  await page.getByText("Archived", { exact: true }).click();
  await expect(
    page.getByText("Could you share the setup guide?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Could you share the setup guide?")).toHaveCount(
    0,
  );
  await expect(page.getByText("Item restored.")).toBeVisible();

  const sidebarCalendar = page.getByTestId("sidebar-rolling-calendar");
  await expect(sidebarCalendar).toBeVisible();
  await sidebarCalendar.evaluate((element) => {
    element.scrollTop = Math.min(
      40,
      element.scrollHeight - element.clientHeight,
    );
    (
      window as Window & { __openpostSidebarCalendar?: Element }
    ).__openpostSidebarCalendar = element;
  });
  const sidebarCalendarScrollTop = await sidebarCalendar.evaluate(
    (element) => element.scrollTop,
  );
  await page
    .getByTestId("communications-navigation")
    .getByRole("link", { name: "Messages" })
    .click();
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
  await expect
    .poll(() =>
      sidebarCalendar.evaluate(
        (element) =>
          (window as Window & { __openpostSidebarCalendar?: Element })
            .__openpostSidebarCalendar === element,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => sidebarCalendar.evaluate((element) => element.scrollTop))
    .toBe(sidebarCalendarScrollTop);
  await page.getByText("Archived", { exact: true }).click();
  await expect(page.getByRole("button", { name: /Ada/ })).toBeVisible();
  await page.getByText("Archived", { exact: true }).click();
  await page.getByRole("button", { name: /Ada/ }).click();
  await expect(
    page.getByText("Is this available for teams?").last(),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Write a message…")).toBeVisible();

  await page.goto(`/notifications?workspace=${workspace.id}`);
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("New message from Ada")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Notification preferences" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/engagement", "/messages", "/notifications"]) {
    await page.goto(`${path}?workspace=${workspace.id}`);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }

  expect({ consoleErrors, unauthorizedResponses }).toEqual({
    consoleErrors: [],
    unauthorizedResponses: [],
  });
});
