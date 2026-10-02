import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("Today reveals its agenda date without moving keyboard focus or changing posts", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const auth = await registerUser(request, `agenda-today-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Agenda Today");
  const headers = { Authorization: `Bearer ${auth.token}` };
  expect(
    (
      await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
        headers,
        data: { timezone: "UTC" },
      })
    ).ok(),
  ).toBe(true);
  const ids: string[] = [];
  for (let day = 1; day <= 30; day++) {
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      `Audit agenda day ${day}`,
    );
    ids.push(publication.id);
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='published',actual_run_at='2026-09-${String(day).padStart(2, "0")} 12:00:00+00:00' WHERE id='${publication.id}';`,
    ]);
  }
  await authenticatePage(page, auth.token);
  await page.goto("/calendar");
  for (const width of [390, 320, 1168]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      const date = page.getByRole("heading", { name: "Wednesday, Sep 30", exact: true });
      const today = page.getByRole("main").getByRole("button", { name: "Today", exact: true });
      await expect(date).toBeVisible();
      await expect(date).not.toBeInViewport();
      await today.focus();
      await page.keyboard.press("Enter");
      await expect(date).toBeInViewport();
      await expect(today).toBeFocused();
      await expect(today).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`today-${width}-${scheme}.png`) });
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await today.click();
      await expect(date).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  }
  for (const id of [ids[0], ids[29]]) {
    const response = await request.get(`/api/v1/publications/${id}`, { headers });
    expect(response.ok()).toBe(true);
    const publication = await response.json();
    expect(publication.status).toBe("published");
    expect(publication.revision).toBe(1);
  }
  expect(errors).toEqual([]);
});

test("Today resets a later empty-date choice to today", async ({ page, request }) => {
  await page.clock.setFixedTime(new Date("2026-09-29T12:00:00Z"));
  await page.setViewportSize({ width: 390, height: 850 });
  const auth = await registerUser(request, `agenda-empty-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Empty Today");
  const headers = { Authorization: `Bearer ${auth.token}` };
  expect(
    (
      await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
        headers,
        data: { timezone: "UTC" },
      })
    ).ok(),
  ).toBe(true);
  const publication = await createPublication(
    request,
    auth.token,
    workspace.id,
    "Audit earlier date",
  );
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `UPDATE publications SET status='published',actual_run_at='2026-09-01 12:00:00+00:00' WHERE id='${publication.id}';`,
  ]);
  await authenticatePage(page, auth.token);
  await page.goto("/calendar");
  const picker = page.getByRole("button", { name: "Empty date in September 2026", exact: true });
  await picker.click();
  await page.getByRole("option", { name: "Wed, Sep 30", exact: true }).click();
  await expect(picker).toHaveText("Wed, Sep 30");
  const today = page.getByRole("main").getByRole("button", { name: "Today", exact: true });
  await today.focus();
  await page.keyboard.press("Enter");
  await expect(picker).toHaveText("Tue, Sep 29");
  await expect(picker).toBeInViewport();
  await expect(today).toBeFocused();
});
