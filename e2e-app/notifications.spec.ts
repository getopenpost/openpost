import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

interface TestWorkspace {
  id: string;
  name: string;
}

interface NotificationFixture {
  id: string;
  user_id: string;
  workspace_id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  payload_json: string;
  read_at: string;
  created_at: string;
}

interface NotificationMutation {
  workspace_id: string;
  ids?: string[];
  all?: boolean;
}

async function switchWorkspace(
  page: Page,
  from: TestWorkspace,
  to: TestWorkspace,
) {
  const workspaceButton = page
    .getByRole("button", { name: new RegExp(`${from.name}|${to.name}`) })
    .first();
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(to.name) }).click();
  await expect(workspaceButton).toContainText(to.name);
}

test("notification bulk actions stay in the selected workspace and preserve state on failure", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `notification-scope-${unique}@example.com`,
  );
  const first = (await createWorkspace(
    request,
    auth.token,
    `Editorial ${unique}`,
  )) as TestWorkspace;
  const second = (await createWorkspace(
    request,
    auth.token,
    `Campaign ${unique}`,
  )) as TestWorkspace;
  await authenticatePage(page, auth.token);
  await page.addInitScript((workspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(workspace),
    );
  }, first);

  let notifications: NotificationFixture[] = [
    {
      id: "first-workspace-notification",
      user_id: "user-1",
      workspace_id: first.id,
      type: "post_published",
      title: "Editorial publication finished",
      body: "The editorial post is live.",
      href: "/activity",
      payload_json: "{}",
      read_at: "",
      created_at: "2026-08-09T12:00:00Z",
    },
    {
      id: "second-workspace-notification",
      user_id: "user-1",
      workspace_id: second.id,
      type: "publish_failed",
      title: "Campaign publication failed",
      body: "The campaign post needs attention.",
      href: "/activity",
      payload_json: "{}",
      read_at: "",
      created_at: "2026-08-09T11:00:00Z",
    },
    {
      id: "account-wide-notification",
      user_id: "user-1",
      workspace_id: "",
      type: "workspace_invite",
      title: "Account-wide invitation",
      body: "You have a workspace invitation.",
      href: "/settings",
      payload_json: "{}",
      read_at: "",
      created_at: "2026-08-09T10:00:00Z",
    },
  ];
  const readRequests: NotificationMutation[] = [];
  const deleteRequests: NotificationMutation[] = [];
  let readFailuresRemaining = 1;
  let deleteFailuresRemaining = 1;

  await page.route("**/api/v1/notifications**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() === "GET" && path.endsWith("/notifications")) {
      const workspaceId = url.searchParams.get("workspace_id") ?? "";
      const visible = notifications.filter(
        (notification) =>
          notification.workspace_id === workspaceId ||
          notification.workspace_id === "",
      );
      await route.fulfill({
        contentType: "application/json",
        json: {
          items: visible,
          unread_count: visible.filter((notification) => !notification.read_at)
            .length,
          next_cursor: "",
        },
      });
      return;
    }

    const body = route.request().postDataJSON() as NotificationMutation;
    const collection = path.endsWith("/notifications/read")
      ? readRequests
      : deleteRequests;
    collection.push(body);
    const shouldFail = path.endsWith("/notifications/read")
      ? readFailuresRemaining-- > 0
      : deleteFailuresRemaining-- > 0;
    if (shouldFail) {
      await route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        json: {
          status: 500,
          title: "Internal Server Error",
          detail: "Forced notification mutation failure",
        },
      });
      return;
    }

    const inScope = (notification: NotificationFixture) =>
      notification.workspace_id === body.workspace_id ||
      notification.workspace_id === "";
    const selected = (notification: NotificationFixture) =>
      body.all || body.ids?.includes(notification.id);
    if (path.endsWith("/notifications/read")) {
      notifications = notifications.map((notification) =>
        inScope(notification) && selected(notification)
          ? { ...notification, read_at: "2026-08-09T12:30:00Z" }
          : notification,
      );
    } else {
      notifications = notifications.filter(
        (notification) => !(inScope(notification) && selected(notification)),
      );
    }
    await route.fulfill({ status: 204 });
  });

  await page.goto("/notifications");
  const inbox = page.locator("#main-content");
  await expect(
    page.getByText(
      `Updates for ${first.name}, including account-wide notices.`,
    ),
  ).toBeVisible();
  await expect(page.getByText("Editorial publication finished")).toBeVisible();
  await expect(page.getByText("Account-wide invitation")).toBeVisible();
  await expect(page.getByText("Campaign publication failed")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Notifications, 2 unread" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `Bulk actions affect ${first.name} and account-wide notices, not other workspaces.`,
    ),
  ).toBeVisible();

  const markInboxRead = page.getByRole("button", {
    name: "Mark this inbox read",
  });
  await markInboxRead.click();
  await expect(
    page.getByText("OpenPost could not mark this inbox as read."),
  ).toBeVisible();
  await expect(inbox.getByText("2 unread notifications")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 2 unread" }),
  ).toBeVisible();
  expect(
    notifications.filter((notification) => notification.read_at),
  ).toHaveLength(0);

  await markInboxRead.click();
  await expect(inbox.getByText("0 unread notifications")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 0 unread" }),
  ).toBeVisible();
  expect(
    notifications.find(
      (notification) => notification.id === "first-workspace-notification",
    )?.read_at,
  ).toBeTruthy();
  expect(
    notifications.find(
      (notification) => notification.id === "account-wide-notification",
    )?.read_at,
  ).toBeTruthy();
  expect(
    notifications.find(
      (notification) => notification.id === "second-workspace-notification",
    )?.read_at,
  ).toBe("");
  expect(readRequests).toEqual([
    { workspace_id: first.id, all: true },
    { workspace_id: first.id, all: true },
  ]);

  await switchWorkspace(page, first, second);
  await expect(page.getByText("Campaign publication failed")).toBeVisible();
  await expect(inbox.getByText("1 unread notifications")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 1 unread" }),
  ).toBeVisible();

  await inbox
    .getByRole("button", { name: "Delete this inbox history" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(
      `This permanently deletes notifications for ${second.name} and account-wide notices. Notifications for other workspaces stay in your history.`,
    ),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Delete this inbox history" })
    .click();
  await expect(
    page.getByText("OpenPost could not delete this inbox history."),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Campaign publication failed")).toBeVisible();
  await expect(inbox.getByText("1 unread notifications")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 1 unread" }),
  ).toBeVisible();

  await inbox
    .getByRole("button", { name: "Delete this inbox history" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete this inbox history" })
    .click();
  await expect(page.getByText("You're all caught up")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 0 unread" }),
  ).toBeVisible();
  expect(deleteRequests).toEqual([
    { workspace_id: second.id, all: true },
    { workspace_id: second.id, all: true },
  ]);

  await switchWorkspace(page, second, first);
  await expect(page.getByText("Editorial publication finished")).toBeVisible();
  await expect(page.getByText("Account-wide invitation")).toHaveCount(0);
  await expect(page.getByText("Campaign publication failed")).toHaveCount(0);
  await expect(inbox.getByText("0 unread notifications")).toBeVisible();
});

test("notification feed shares live state, retries failed cursors, and exposes accessible semantics", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `notification-feed-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    `Publishing ${unique}`,
  )) as TestWorkspace;
  await authenticatePage(page, auth.token);
  await page.addInitScript((selectedWorkspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(selectedWorkspace),
    );
  }, workspace);

  const now = new Date();
  const localMidday = (daysAgo: number) =>
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysAgo,
      12,
      0,
      0,
    ).toISOString();
  let notifications: NotificationFixture[] = Array.from(
    { length: 125 },
    (_, index) => ({
      id: `notification-${index.toString().padStart(3, "0")}`,
      user_id: "user-1",
      workspace_id: workspace.id,
      type: index % 2 === 0 ? "post_published" : "publish_failed",
      title: `Notification ${index.toString().padStart(3, "0")}`,
      body: `Complete notification body ${index}`,
      href: index === 0 ? "/activity" : "/notifications",
      payload_json: "{}",
      read_at: "",
      created_at: localMidday(index === 0 ? 0 : index === 1 ? 1 : index + 2),
    }),
  );
  let initialFailuresRemaining = 1;
  let cursorFailuresRemaining = 1;
  let openFailuresRemaining = 1;
  const readRequests: NotificationMutation[] = [];

  await page.route("**/api/v1/notifications**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() === "GET" && path.endsWith("/notifications")) {
      if (initialFailuresRemaining-- > 0) {
        await route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          json: {
            status: 500,
            title: "Internal Server Error",
            detail: "Forced initial notification failure",
          },
        });
        return;
      }
      const cursor = url.searchParams.get("cursor") ?? "0";
      if (cursor === "30" && cursorFailuresRemaining-- > 0) {
        await route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          json: {
            status: 500,
            title: "Internal Server Error",
            detail: "Forced cursor failure",
          },
        });
        return;
      }
      const offset = Number(cursor);
      const items = notifications.slice(offset, offset + 30);
      const nextOffset = offset + items.length;
      await route.fulfill({
        contentType: "application/json",
        json: {
          items,
          unread_count: notifications.filter(
            (notification) => !notification.read_at,
          ).length,
          next_cursor:
            nextOffset < notifications.length ? String(nextOffset) : "",
        },
      });
      return;
    }

    if (
      route.request().method() === "POST" &&
      path.endsWith("/notifications/read")
    ) {
      const body = route.request().postDataJSON() as NotificationMutation;
      readRequests.push(body);
      if (!body.all && openFailuresRemaining-- > 0) {
        await route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          json: {
            status: 500,
            title: "Internal Server Error",
            detail: "Forced notification open failure",
          },
        });
        return;
      }
      notifications = notifications.map((notification) =>
        body.all || body.ids?.includes(notification.id)
          ? { ...notification, read_at: new Date().toISOString() }
          : notification,
      );
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fallback();
  });

  await page.goto("/notifications");
  const inbox = page.locator("#main-content");
  await expect(
    page.getByText("Forced initial notification failure"),
  ).toBeVisible();
  await expect(page.getByText("You're all caught up")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();

  await expect(inbox.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(inbox.getByRole("heading", { name: "Yesterday" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 125 unread" }),
  ).toBeVisible();
  const firstArticle = inbox.locator(
    '[data-notification-id="notification-000"]',
  );
  await expect(firstArticle).toHaveAttribute(
    "aria-label",
    /Post published\. Unread\. Notification 000\..+/,
  );
  await expect(firstArticle.getByText("Post published")).toBeVisible();
  await expect(firstArticle.getByText("Unread", { exact: true })).toBeVisible();
  await expect(
    firstArticle.getByRole("button", { name: "Mark as read" }),
  ).toBeVisible();
  await expect(
    firstArticle.getByRole("button", { name: "Open notification" }),
  ).toBeVisible();

  await firstArticle.getByRole("button", { name: "Open notification" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(
    page.getByRole("link", { name: "Notifications, 125 unread" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Notifications, 125 unread" }).click();
  await expect(firstArticle).toHaveAttribute("data-unread", "true");
  await expect(inbox.getByText("125 unread notifications")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 125 unread" }),
  ).toBeVisible();

  await firstArticle.getByRole("button", { name: "Open notification" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(
    page.getByRole("link", { name: "Notifications, 124 unread" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Notifications, 124 unread" }).click();
  await expect(inbox.getByText("124 unread notifications")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 124 unread" }),
  ).toBeVisible();
  expect(readRequests.slice(0, 2)).toEqual([
    { workspace_id: workspace.id, ids: ["notification-000"] },
    { workspace_id: workspace.id, ids: ["notification-000"] },
  ]);
  await firstArticle.getByRole("button", { name: "Open notification" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await page.getByRole("link", { name: "Notifications, 124 unread" }).click();
  expect(readRequests).toHaveLength(2);
  await expect(inbox.getByText("124 unread notifications")).toBeVisible();

  await inbox.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.getByText("Notification 000")).toBeVisible();
  await inbox.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page.getByText("Notification 000")).toHaveCount(0);
  await inbox.getByRole("button", { name: "Read", exact: true }).click();
  await inbox.getByRole("button", { name: "Mark this inbox read" }).click();
  await expect(
    page.getByText("This inbox is now marked as read."),
  ).toBeAttached();
  await expect(inbox.getByText("0 unread notifications")).toBeVisible();
  await expect(
    inbox.getByRole("button", { name: "Mark this inbox read" }),
  ).toBeDisabled();

  await inbox.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "No notifications match this filter",
    }),
  ).toBeVisible();
  await expect(page.getByText("You're all caught up")).toHaveCount(0);
  await page.getByRole("button", { name: "Show all notifications" }).click();

  await inbox.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Forced cursor failure")).toBeVisible();
  await expect(inbox.locator("[data-notification-id]")).toHaveCount(30);
  await inbox.getByRole("button", { name: "Try again" }).click();
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    await inbox.getByRole("button", { name: "Load more" }).click();
  }
  await expect(inbox.locator("[data-notification-id]")).toHaveCount(125);
  const loadedIDs = await inbox
    .locator("[data-notification-id]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-notification-id")),
    );
  expect(loadedIDs).toHaveLength(125);
  expect(new Set(loadedIDs).size).toBe(125);

  notifications = [
    {
      id: "server-arrival",
      user_id: "user-1",
      workspace_id: workspace.id,
      type: "new_message",
      title: "A new message arrived",
      body: "This notification arrived after the page was mounted.",
      href: "/notifications",
      payload_json: "{}",
      read_at: "",
      created_at: localMidday(0),
    },
    ...notifications,
  ];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("A new message arrived")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Notifications, 1 unread" }),
  ).toBeVisible();
  await expect(inbox.locator("[data-notification-id]")).toHaveCount(126);
});
