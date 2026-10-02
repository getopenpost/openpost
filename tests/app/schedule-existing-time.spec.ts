import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("adding an existing time explains that no weekdays changed", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `existing-time-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Existing weekly time");
  const headers = { Authorization: `Bearer ${auth.token}` };
  for (let day = 0; day < 7; day++) {
    const response = await request.post("/api/v1/posting-schedules", {
      headers,
      data: { workspace_id: workspace.id, utc_hour: 9, utc_minute: 0, day_of_week: day },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await authenticatePage(page, auth.token);
  await page.goto(`/settings?tab=schedule&workspace_id=${workspace.id}`);
  const add = page.getByRole("button", { name: "Add time", exact: true });
  await expect(add).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove the 9:00 AM row", exact: true }),
  ).toBeVisible();
  await add.focus();
  await add.press("Enter");
  const notice = page.getByText("This time already exists for all selected days.", { exact: true });
  await expect(notice).toBeVisible();
  await expect(page.getByText("Time row added successfully", { exact: true })).toHaveCount(0);
  const saved = await request.get("/api/v1/posting-schedules", {
    headers,
    params: { workspace_id: workspace.id },
  });
  expect(saved.ok()).toBeTruthy();
  const slots = await saved.json();
  expect(slots).toHaveLength(7);
  expect(slots.map((slot: { day_of_week: number }) => slot.day_of_week).sort()).toEqual([
    0, 1, 2, 3, 4, 5, 6,
  ]);
  await page.screenshot({ path: info.outputPath("existing-time-desktop.png") });
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      await expect(add).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Remove the 9:00 AM row", exact: true }),
      ).toBeVisible();
      await add.click();
      await expect(notice).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({ path: info.outputPath(`existing-time-${width}-${colorScheme}.png`) });
    }
  }
  await page.locator("#new-time").fill("10:00");
  await add.focus();
  await add.press("Enter");
  await expect(page.getByText("Time row added successfully", { exact: true })).toBeVisible();
  const updated = await request.get("/api/v1/posting-schedules", {
    headers,
    params: { workspace_id: workspace.id },
  });
  expect(updated.ok()).toBeTruthy();
  const updatedSlots: { utc_hour: number; day_of_week: number }[] = await updated.json();
  expect(updatedSlots).toHaveLength(12);
  expect(
    updatedSlots
      .filter((slot) => slot.utc_hour === 10)
      .map((slot) => slot.day_of_week)
      .sort(),
  ).toEqual([1, 2, 3, 4, 5]);
  expect(errors).toEqual([]);
});
