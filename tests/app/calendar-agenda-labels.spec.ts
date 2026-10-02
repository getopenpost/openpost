import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("week agenda and empty-date guidance describe the displayed cross-month range", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const auth = await registerUser(request, `agenda-labels-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Agenda labels");
  const headers = { Authorization: `Bearer ${auth.token}` };
  expect(
    (
      await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
        headers,
        data: { timezone: "UTC", week_start: 0 },
      })
    ).ok(),
  ).toBe(true);
  const publication = await createPublication(
    request,
    auth.token,
    workspace.id,
    "Audit cross-month week",
  );
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `UPDATE publications SET status='published',actual_run_at='2026-09-28 12:00:00+00:00' WHERE id='${publication.id}';`,
  ]);
  await authenticatePage(page, auth.token);
  await page.goto("/calendar");
  for (const width of [1168, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      const week = page.getByRole("button", { name: "Week", exact: true });
      await week.focus();
      await page.keyboard.press("Enter");
      const range = await page.locator("main p[aria-live='polite']").innerText();
      expect(range).toMatch(/Sep 27.*Oct 3, 2026/);
      await expect(page.getByText("Audit cross-month week", { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`week-before-assert-${width}-${scheme}.png`),
      });
      const agenda = page.getByRole("region", { name: "Weekly publishing calendar", exact: true });
      await expect(agenda).toBeVisible();
      await expect(
        agenda.getByText(`Choose an open date in ${range}.`, { exact: true }),
      ).toBeVisible();
      const picker = agenda.getByRole("button", { name: `Empty date in ${range}`, exact: true });
      await picker.click();
      await expect(page.getByRole("option", { name: "Thu, Oct 1", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(picker).toBeFocused();
      await page.getByRole("button", { name: "Month", exact: true }).click();
      const month = page.getByRole("region", { name: "Monthly publishing calendar", exact: true });
      await expect(month).toBeVisible();
      await expect(
        month.getByText("Choose an open date in September 2026.", { exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  }
  expect(errors).toEqual([]);
});
