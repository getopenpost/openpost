import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  clickComposerDeliveryAction,
  createWorkspace,
  registerUser,
} from "./helpers";

test("composer advances saved time slots across hour boundaries", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `slots-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Time slot intervals");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const settings = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
    headers,
    data: { timezone: "UTC", slot_start_hour: 5, slot_end_hour: 23, slot_interval_minutes: 90 },
  });
  expect(settings.ok(), await settings.text()).toBeTruthy();
  await authenticatePage(page, auth.token);
  await page.goto(`/?workspace_id=${workspace.id}`);
  await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toBeVisible();
  await clickComposerDeliveryAction(page, "Schedule");
  const dialog = page.getByTestId("schedule-dialog-shell");
  await dialog.getByRole("button", { name: "Tomorrow 09:00", exact: true }).click();
  await expect(dialog.getByTestId("schedule-dialog-time-list").getByRole("button")).toHaveText([
    "05:00",
    "06:30",
    "08:00",
    "09:30",
    "11:00",
    "12:30",
    "14:00",
    "15:30",
    "17:00",
    "18:30",
    "20:00",
    "21:30",
    "23:00",
  ]);
  await dialog.getByRole("button", { name: "06:30", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Schedule", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("ninety-minute-slots.png") });
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(dialog.getByTestId("schedule-dialog-time-list").getByRole("button")).toHaveCount(
        13,
      );
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await dialog.getByRole("button", { name: "06:30", exact: true }).focus();
      await expect(dialog.getByRole("button", { name: "06:30", exact: true })).toBeFocused();
      await page.screenshot({ path: info.outputPath(`slots-${width}-${colorScheme}.png`) });
    }
  }
});
