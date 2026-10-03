import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("notification status, count and filters agree after reading and reload", async ({
  page,
  request,
}, testInfo) => {
  const email = `notification-state-${randomUUID()}@example.com`;
  const { token } = await registerUser(request, email);
  const workspace = await createWorkspace(request, token, "Audit notification state");
  const notificationID = randomUUID();
  const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  // Seed a stored event, without triggering a provider or external delivery.
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    database,
    `INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, created_at)
     SELECT '${notificationID}', id, '${workspace.id}', 'post_published', 'Audit read state', 'Synthetic stored notification.', datetime('now')
     FROM users WHERE email = '${email}';`,
  ]);
  await authenticatePage(page, token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/inbox/notifications");
  const inbox = page.getByRole("region", { name: "Notifications", exact: true });
  const row = page.locator(`[data-notification-id="${notificationID}"]`);
  await expect(row).toBeVisible();
  await expect(inbox.getByText("1 unread notifications", { exact: true })).toBeVisible();
  const before = testInfo.outputPath("notification-before-read.png");
  await page.screenshot({ path: before, fullPage: true });
  await testInfo.attach("before-read", { path: before, contentType: "image/png" });
  await expect(row).toHaveAttribute("data-unread", "true");
  const filters = page.getByRole("group", { name: "Filter notifications by read status" });
  await filters.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Mark as read", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(inbox.getByText("0 unread notifications", { exact: true })).toBeVisible();
  await expect(row).toBeHidden();
  await expect(filters.getByRole("button", { name: "Unread", exact: true })).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "No notifications match this filter" }),
  ).toBeVisible();
  await filters.getByRole("button", { name: "Read", exact: true }).click();
  await expect(row).toHaveAttribute("data-unread", "false");

  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      if (scheme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      await expect(row).toBeHidden();
      await expect(inbox.getByText("0 unread notifications", { exact: true })).toBeVisible();
      await filters.getByRole("button", { name: "Unread", exact: true }).click();
      await expect(row).toBeHidden();
      await filters.getByRole("button", { name: "Read", exact: true }).click();
      await expect(row).toBeVisible();
      const screenshot = testInfo.outputPath(`notification-read-${width}-${scheme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach(`read-${width}-${scheme}`, {
        path: screenshot,
        contentType: "image/png",
      });
    }
  }
  expect(errors).toEqual([]);
});

test("opening an engagement clears it from the active inbox and preserves read history", async ({
  page,
  request,
}, testInfo) => {
  const email = `notification-open-${randomUUID()}@example.com`;
  const { token } = await registerUser(request, email);
  const workspace = await createWorkspace(request, token, "Notification opening");
  const id = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, href, created_at)
     SELECT '${id}', id, '${workspace.id}', 'new_engagement', 'A new comment', 'Someone replied to your post.', '/inbox/engagement', datetime('now') FROM users WHERE email = '${email}';`,
  ]);
  await authenticatePage(page, token);
  await page.goto("/inbox/notifications");
  const row = page.locator(`[data-notification-id="${id}"]`);
  await expect(row).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("before-open.png"), fullPage: true });
  await row.getByRole("button", { name: "Open notification", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox\/engagement$/);
  await page.goto("/inbox/notifications");
  await expect(page.getByRole("button", { name: "Unread", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(row).toBeHidden();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(row).toHaveAttribute("data-unread", "false");
  await page.reload();
  await expect(row).toBeHidden();
});

test("notification panel keeps reads explicit, recovers failures and fits desktop and phones", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const email = `notification-panel-${randomUUID()}@example.com`;
  const { token } = await registerUser(request, email);
  const workspace = await createWorkspace(request, token, "Notification panel");
  const engagementID = randomUUID();
  const noticeID = randomUUID();
  const otherNoticeID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, href, created_at)
     SELECT '${engagementID}', id, '${workspace.id}', 'new_engagement', 'Panel comment', 'A comment to review.', '/inbox/engagement', datetime('now') FROM users WHERE email = '${email}';
     INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, created_at)
     SELECT '${noticeID}', id, '${workspace.id}', 'post_published', 'Panel update', 'Published on all destinations.', datetime('now') FROM users WHERE email = '${email}';
     INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, created_at)
     SELECT '${otherNoticeID}', id, '${workspace.id}', 'post_published', 'Another panel update', 'A second update.', datetime('now') FROM users WHERE email = '${email}';`,
  ]);
  await authenticatePage(page, token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto("/inbox/engagement");
  const bell = page.getByTestId("sidebar-notifications").filter({ visible: true });
  const panel = page.getByTestId("notification-panel");
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(bell).toHaveAccessibleName("Notifications, 3 unread");
      await expect(bell.getByText("3", { exact: true })).toBeVisible();
      await bell.focus();
      await page.keyboard.press("Enter");
      await expect(panel).toBeVisible();
      await expect(panel.getByText("Panel comment", { exact: true })).toBeVisible();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`panel-${width}-${scheme}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(bell).toBeFocused();
    }
  }
  await bell.click();
  await page.route("**/api/v1/notifications/read", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ detail: "Read unavailable" }),
    }),
  );
  await panel.getByRole("button", { name: /Panel comment/ }).click();
  await expect(
    panel.getByText("OpenPost could not mark this notification as read. Try again."),
  ).toBeVisible();
  await expect(panel.getByText("Panel comment", { exact: true })).toBeVisible();
  await expect(bell).toHaveAccessibleName("Notifications, 3 unread");
  await expect(panel).toBeVisible();
  await page.unroute("**/api/v1/notifications/read");
  await panel.getByRole("button", { name: /Panel comment/ }).click();
  await expect(panel).toBeHidden();
  await expect(bell).toHaveAccessibleName("Notifications, 2 unread");
  await bell.click();
  await expect(panel.getByText("Panel comment", { exact: true })).toBeHidden();
  const noticeRow = panel.locator(`[data-notification-id="${noticeID}"]`);
  await noticeRow.getByRole("button", { name: "Mark as read", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(noticeRow).toBeHidden();
  await expect(
    panel
      .locator(`[data-notification-id="${otherNoticeID}"]`)
      .getByRole("button", { name: "Mark as read", exact: true }),
  ).toBeFocused();
  await expect(bell).toHaveAccessibleName("Notifications, 1 unread");
  await panel.getByRole("button", { name: "Mark this inbox read", exact: true }).click();
  await expect(bell).toHaveAccessibleName("Notifications, 0 unread");
  await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ detail: "Refresh unavailable" }),
    }),
  );
  await page.clock.fastForward(31_000);
  await page.clock.resume();
  await expect(panel.getByText("Refresh unavailable", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeHidden();
  await page.unroute("**/api/v1/notifications?*");
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
  await panel.getByRole("link", { name: "Show all notifications", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox\/notifications\?status=all$/);
  await expect(page.locator(`[data-notification-id="${engagementID}"]`)).toHaveAttribute(
    "data-unread",
    "false",
  );
  await expect(page.locator(`[data-notification-id="${noticeID}"]`)).toHaveAttribute(
    "data-unread",
    "false",
  );
  await page.reload();
  await expect(bell).toHaveAccessibleName("Notifications, 0 unread");
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ detail: "Notifications unavailable" }),
    }),
  );
  await page.reload();
  await bell.click();
  await expect(panel.getByText("Notifications unavailable", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeHidden();
  await page.unroute("**/api/v1/notifications?*");
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
  const touchContext = await page
    .context()
    .browser()!
    .newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 320, height: 740 },
      isMobile: true,
      hasTouch: true,
    });
  try {
    const phone = await touchContext.newPage();
    await authenticatePage(phone, token);
    await phone.goto("/inbox/engagement");
    const phoneBell = phone.getByTestId("sidebar-notifications").filter({ visible: true });
    const touchBox = await phoneBell.boundingBox();
    expect(touchBox!.height).toBeGreaterThanOrEqual(44);
    expect(touchBox!.width).toBeGreaterThanOrEqual(44);
    await phoneBell.tap();
    await expect(phone.getByTestId("notification-panel")).toBeVisible();
    await phone
      .getByTestId("notification-panel")
      .getByRole("button", { name: "Close", exact: true })
      .tap();
    await expect(phone.getByTestId("notification-panel")).toBeHidden();
  } finally {
    await touchContext.close();
  }
  expect(errors).toEqual([]);
});
