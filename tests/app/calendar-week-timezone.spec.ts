import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("Week grid retains both posts in a repeated local hour and changes timezone correctly", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
  await page.setViewportSize({ width: 1440, height: 960 });
  const auth = await registerUser(request, `week-timezone-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Week timezone");
  const headers = { Authorization: `Bearer ${auth.token}` };
  for (const [title, instant] of [
    ["Before clock change", "2026-11-01 05:15:00+00:00"],
    ["After clock change", "2026-11-01 06:45:00+00:00"],
  ]) {
    const publication = await createPublication(request, auth.token, workspace.id, title);
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='published',actual_run_at='${instant}' WHERE id='${publication.id}';`,
    ]);
  }
  await authenticatePage(page, auth.token);
  for (const timezone of ["America/New_York", "UTC"]) {
    expect(
      (
        await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
          headers,
          data: { timezone, week_start: 0 },
        })
      ).ok(),
    ).toBe(true);
    for (const scheme of ["light"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/calendar");
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      await page.getByRole("button", { name: "Week", exact: true }).click();
      const grid = page.getByRole("region", { name: "Weekly publishing calendar" });
      await expect
        .poll(() =>
          grid
            .getByText(timezone, { exact: true })
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        )
        .toBe(true);
      const firstHour = timezone === "UTC" ? "05:00" : "01:00";
      const secondHour = timezone === "UTC" ? "06:00" : "01:00";
      const first = grid
        .getByRole("group", { name: `Sunday, Nov 1 ${firstHour}`, exact: true })
        .getByRole("button", { name: "Before clock change", exact: true });
      const second = grid
        .getByRole("group", { name: `Sunday, Nov 1 ${secondHour}`, exact: true })
        .getByRole("button", { name: "After clock change", exact: true });
      await expect(first).toBeVisible();
      await expect(second).toBeVisible();
      await expect(first).toHaveAttribute("style", /25%/);
      await expect(second).toHaveAttribute("style", /75%/);
      await expect(grid.locator("[data-calendar-week-item]")).toHaveCount(2);
      await first.focus();
      await expect(first).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`week-${timezone.replaceAll("/", "-")}-${scheme}.png`),
      });
    }
  }
  expect(errors).toEqual([]);
});
