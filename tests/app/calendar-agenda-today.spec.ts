import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("Calendar selects a day and Today restores it without moving keyboard focus or changing posts", async ({
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

      const calendar = page.getByTestId("calendar-date-picker");
      await expect(calendar).toBeVisible();
      await expect(
        calendar.getByRole("button", { name: "Tuesday, Sep 1", exact: true }),
      ).toBeVisible();
      await calendar.getByRole("button", { name: "Tuesday, Sep 1", exact: true }).click();
      await expect(page.getByRole("button", { name: /Audit agenda day 1\b/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Audit agenda day 30\b/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Create post", exact: true })).toHaveCount(0);
      const second = calendar.getByRole("button", { name: "Wednesday, Sep 2", exact: true });
      await page.keyboard.press("ArrowRight");
      await expect(second).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(second).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: /Audit agenda day 2\b/ })).toBeVisible();
      const target = await second.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
      await today.focus();
      await page.keyboard.press("Enter");
      await expect(date).toBeInViewport();
      await expect(page.getByRole("button", { name: /Audit agenda day 30\b/ })).toBeVisible();
      await expect(today).toBeFocused();
      await expect(today).toBeInViewport();
      if (width === 320 && scheme === "light") {
        const accessibility = await new AxeBuilder({ page })
          .include('[data-testid="calendar-date-picker"]')
          .analyze();
        expect(accessibility.violations).toEqual([]);
      }
      await page.screenshot({ path: testInfo.outputPath(`today-${width}-${scheme}.png`) });
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await today.click();
      await expect(date).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Audit agenda day 1", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`desktop-${scheme}.png`) });
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
