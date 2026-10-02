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
      await expect(row).toHaveAttribute("data-unread", "false");
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
