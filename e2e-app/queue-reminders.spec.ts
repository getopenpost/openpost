import { expect, test } from "@playwright/test";

import { expectNoSeriousAccessibilityViolations } from "./accessibility";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("an editor can configure queue reminder emails on desktop and phone", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

  const { token } = await registerUser(request, "queue-reminders@example.com");
  const workspace = await createWorkspace(request, token, "Queue reminders");
  await authenticatePage(page, token);
  await page.goto("/settings?tab=notifications");

  const section = page.getByRole("region", { name: "Queue reminders" });
  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(
    section.getByText("Reminders start after this Workspace queues its first post."),
  ).toBeVisible();
  await section.getByRole("checkbox", { name: "Low queue runway" }).check();
  await section.getByRole("checkbox", { name: "Queue emptied" }).check();
  await section.getByRole("spinbutton", { name: "Days of runway" }).fill("14");
  await section.getByRole("button", { name: "Save queue reminders" }).click();
  await expect(page.getByText("Queue reminders saved.")).toBeVisible();
  await page.screenshot({
    path: "/tmp/openpost-queue-reminders-desktop.png",
    fullPage: true,
  });

  const saved = await request.get(`/api/v1/notifications/queue-reminders/${workspace.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(saved.ok()).toBeTruthy();
  await expect(saved.json()).resolves.toMatchObject({
    low_runway_enabled: true,
    queue_emptied_enabled: true,
    runway_days: 14,
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(section).toBeVisible();
    await page.screenshot({
      path: `/tmp/openpost-queue-reminders-${viewport.width}.png`,
      fullPage: true,
    });
    const overflow = await section.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    );
    expect(overflow, `${viewport.width}px queue reminder section overflows`).toBe(false);
  }

  await expectNoSeriousAccessibilityViolations(page);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
