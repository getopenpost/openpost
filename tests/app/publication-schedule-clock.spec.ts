import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

const clocks = [
  {
    workspaceZone: "Europe/Lisbon",
    browserZone: "Asia/Tokyo",
    scheduledTime: "04:00 PM",
    publishedTime: "04:11 PM",
    dstTime: "01:57 AM",
    boundarySchedule: "2026-10-02T23:02:00Z",
    boundaryDispatch: "2026-10-02T22:57:00Z",
    dayFrom: "2026-10-02T23:00:00Z",
    dayBefore: "2026-10-03T23:00:00Z",
  },
  {
    workspaceZone: "UTC",
    browserZone: "America/Los_Angeles",
    scheduledTime: "03:00 PM",
    publishedTime: "03:11 PM",
    dstTime: "12:57 AM",
    boundarySchedule: "2026-10-03T00:02:00Z",
    boundaryDispatch: "2026-10-02T23:57:00Z",
    dayFrom: "2026-10-03T00:00:00Z",
    dayBefore: "2026-10-04T00:00:00Z",
  },
] as const;

for (const clock of clocks) {
  test.describe(`${clock.workspaceZone} workspace and ${clock.browserZone} browser`, () => {
    test.use({ timezoneId: clock.browserZone });
    test("planned List and Calendar share the authored clock while published outcomes use actual time", async ({
      page,
      request,
    }, testInfo) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const auth = await registerUser(request, `schedule-clock-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Schedule clock");
      const headers = { Authorization: `Bearer ${auth.token}` };
      const settings = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
        headers,
        data: { timezone: clock.workspaceZone },
      });
      expect(settings.ok()).toBe(true);
      const fixtures = [
        {
          text: "Audit schedule with dispatch jitter",
          status: "scheduled",
          scheduledAt: "2026-10-02T15:00:00Z",
          actualAt: "2026-10-02T15:11:00Z",
          day: "Oct 2",
          time: clock.scheduledTime,
        },
        {
          text: "Audit authored midnight boundary",
          status: "scheduled",
          scheduledAt: clock.boundarySchedule,
          actualAt: clock.boundaryDispatch,
          day: "Oct 3",
          time: "12:02 AM",
        },
        {
          text: "Audit publishing through autumn clock change",
          status: "publishing",
          scheduledAt: "2026-10-25T00:57:00Z",
          actualAt: "2026-10-25T01:02:00Z",
          day: "Oct 25",
          time: clock.dstTime,
        },
        {
          text: "Audit published recorded outcome",
          status: "published",
          scheduledAt: "2026-10-02T15:00:00Z",
          actualAt: "2026-10-02T15:11:00Z",
          day: "Oct 2",
          time: clock.publishedTime,
        },
      ];
      const records: Array<{ id: string; scheduledAt: string; actualAt: string }> = [];
      for (const fixture of fixtures) {
        const publication = await createPublication(
          request,
          auth.token,
          workspace.id,
          fixture.text,
        );
        // Read fixtures have no jobs or provider destinations, so no delivery can execute.
        execFileSync("sqlite3", [
          "-cmd",
          ".timeout 5000",
          `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
          `UPDATE publications SET status='${fixture.status}', scheduled_at='${fixture.scheduledAt.replace("T", " ").replace("Z", "+00:00")}', actual_run_at='${fixture.actualAt.replace("T", " ").replace("Z", "+00:00")}', random_delay_minutes=15 WHERE id='${publication.id}';`,
        ]);
        records.push({
          id: publication.id,
          scheduledAt: fixture.scheduledAt,
          actualAt: fixture.actualAt,
        });
      }
      const boundaryRange = await request.get("/api/v1/publications", {
        headers,
        params: {
          workspace_id: workspace.id,
          calendar_from: clock.dayFrom,
          calendar_before: clock.dayBefore,
        },
      });
      expect(boundaryRange.ok()).toBe(true);
      expect((await boundaryRange.json()).map((item: { id: string }) => item.id)).toEqual([
        records[1].id,
      ]);
      await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z"));
      await page.setViewportSize({ width: 390, height: 900 });
      await authenticatePage(page, auth.token);
      await page.goto("/calendar");
      for (const fixture of fixtures) {
        const item = page.getByRole("button").filter({ hasText: fixture.text });
        await expect(item).toContainText(fixture.time);
        await expect(item.locator("xpath=ancestor::section[1]").getByRole("heading")).toContainText(
          fixture.day,
        );
      }
      await page.screenshot({ path: testInfo.outputPath("calendar-clock.png") });
      await page.getByRole("link", { name: "List", exact: true }).click();
      await page.getByRole("tab", { name: "Scheduled", exact: true }).click();
      for (const fixture of fixtures.filter((item) => item.status !== "published")) {
        await expect(page.locator("article").filter({ hasText: fixture.text })).toContainText(
          `${fixture.day}, ${fixture.time}`,
        );
      }
      await page.screenshot({ path: testInfo.outputPath("list-clock.png") });
      for (const scheme of ["light", "dark"] as const) {
        await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        for (const width of [1280, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await page.reload();
          if (scheme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
          else await expect(page.locator("html")).not.toHaveClass(/dark/);
          await expect(page.getByRole("tab", { name: "Scheduled", exact: true })).toHaveAttribute(
            "aria-selected",
            "true",
          );
          const scheduled = page.locator("article").filter({ hasText: fixtures[0].text });
          await expect(scheduled).toContainText(`Oct 2, ${clock.scheduledTime}`);
          const calendar = page.getByRole("link", { name: "Calendar", exact: true });
          await calendar.focus();
          await page.keyboard.press("Enter");
          await expect(
            page.getByRole("heading", { name: "Publications", exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("button").filter({ hasText: fixtures[0].text }),
          ).toContainText(clock.scheduledTime);
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
            false,
          );
          await page.screenshot({ path: testInfo.outputPath(`calendar-${width}-${scheme}.png`) });
          const list = page.getByRole("link", { name: "List", exact: true });
          await list.focus();
          await page.keyboard.press("Enter");
          await expect(page.getByRole("tab", { name: "Scheduled", exact: true })).toHaveAttribute(
            "aria-selected",
            "true",
          );
          await expect(scheduled).toContainText(`Oct 2, ${clock.scheduledTime}`);
          await page.screenshot({ path: testInfo.outputPath(`list-${width}-${scheme}.png`) });
        }
      }
      await page.getByRole("tab", { name: "Published", exact: true }).click();
      await expect(page.locator("article").filter({ hasText: fixtures[3].text })).toContainText(
        `${fixtures[3].day}, ${fixtures[3].time}`,
      );
      for (const record of records) {
        const response = await request.get(`/api/v1/publications/${record.id}`, { headers });
        expect(response.ok()).toBe(true);
        const persisted = await response.json();
        expect(persisted.scheduled_at).toBe(record.scheduledAt);
        expect(persisted.actual_run_at).toBe(record.actualAt);
      }
      expect(errors).toEqual([]);
    });
  });
}
