import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("Calendar keeps the chosen date across Month and Week and opens the composer on that date", async ({
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
  expect(
    (
      await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
        headers: { Authorization: `Bearer ${auth.token}` },
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
      await page.goto("/calendar");
      const picker = page.getByTestId("calendar-date-picker");
      const chosenDate = picker.getByRole("button", { name: "Monday, Sep 28", exact: true });
      await chosenDate.click();
      await expect(chosenDate).toHaveAccessibleDescription("1 post");
      await page.getByRole("button", { name: "Week", exact: true }).click();
      await expect(page.locator("main p[aria-live='polite']")).toHaveText(/Sep 27.*Oct 3, 2026/);
      await expect(chosenDate).toHaveAttribute("aria-pressed", "true");
      await chosenDate.focus();
      await page.keyboard.press("ArrowUp");
      const previousWeekDate = picker.getByRole("button", { name: "Monday, Sep 21", exact: true });
      await expect(previousWeekDate).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(chosenDate).toBeFocused();
      await expect(page.getByRole("button", { name: /Audit cross-month week/ })).toBeVisible();
      const selectionColor = await chosenDate.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const nextMonthDate = picker.getByRole("button", { name: "Thursday, Oct 1", exact: true });
      await nextMonthDate.click();
      await expect(nextMonthDate).toHaveAttribute("aria-pressed", "true");
      await expect(chosenDate).toHaveAttribute("aria-pressed", "false");
      await expect
        .poll(() => nextMonthDate.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(selectionColor);
      await expect(
        page.getByRole("heading", { name: "Thursday, Oct 1", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /Audit cross-month week/ })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`week-${width}-${scheme}.png`) });
      await page.getByRole("button", { name: "Month", exact: true }).click();
      await expect(
        picker.getByRole("button", { name: "Thursday, Oct 1", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.getByRole("button", { name: "Create post", exact: true }).click();
      await expect(page).toHaveURL(/date=2026-10-01/);
    }
  }
  expect(errors).toEqual([]);
});
