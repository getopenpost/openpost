import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("reloading before the row removal response leaves no partially removed weekdays", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `row-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Weekly removal recovery");
  const headers = { Authorization: `Bearer ${auth.token}` };
  for (let day = 0; day < 7; day++) {
    const created = await request.post("/api/v1/posting-schedules", {
      headers,
      data: { workspace_id: workspace.id, utc_hour: 9, utc_minute: 0, day_of_week: day },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  await authenticatePage(page, auth.token);
  await page.goto(`/settings?tab=schedule&workspace_id=${workspace.id}`);
  await page.getByRole("button", { name: "Remove the 9:00 AM row", exact: true }).click();
  let admitted!: () => void;
  const mutationCommitted = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  let release!: () => void;
  const responseReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/posting-schedules/**", async (route) => {
    if (route.request().method() !== "DELETE" && !route.request().url().endsWith("/batch-delete")) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    admitted();
    await responseReleased;
    // Reload has already discarded the old document and its waiting response.
    await route.abort().catch(() => {});
  });
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await mutationCommitted;
  await page.reload();
  release();
  const saved = await request.get("/api/v1/posting-schedules", {
    headers,
    params: { workspace_id: workspace.id },
  });
  expect(saved.ok()).toBeTruthy();
  expect(await saved.json()).toEqual([]);
  await expect(page.getByRole("heading", { name: "Weekly times", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add time", exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "No posting times yet. Add a row above or generate a suggested weekly pattern.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove the 9:00 AM row", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("after-interrupted-response.png") });
});
