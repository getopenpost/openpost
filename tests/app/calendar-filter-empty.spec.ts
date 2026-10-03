import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("Calendar explains filtered emptiness and clears filters without changing dates or posts", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-03T12:00:00Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const auth = await registerUser(request, `calendar-filter-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Calendar Filter Recovery");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const publication = await createPublication(
    request,
    auth.token,
    workspace.id,
    "Audit scheduled filter recovery",
  );
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `UPDATE publications SET status='scheduled',scheduled_at='2026-10-03 14:00:00+00:00' WHERE id='${publication.id}';`,
  ]);
  const emptyWorkspace = await createWorkspace(request, auth.token, "Calendar Empty Workspace");
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${emptyWorkspace.id}','filter-${accountID}','bluesky','${accountID}','auditfilter',X'00',1);`,
  ]);
  await authenticatePage(page, auth.token);
  await page.goto("/calendar");
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      await expect(
        page.getByRole("button", { name: /Audit scheduled filter recovery/ }).first(),
      ).toBeVisible();
      for (const view of ["Month", "Week"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        const range = page.getByRole("main").locator('p[aria-live="polite"]');
        const before = await range.innerText();
        const status = page.getByRole("button", { name: "All posts", exact: true });
        await status.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("menuitemradio", { name: "Published", exact: true }).click();
        await expect(
          page.getByRole("button", { name: /Audit scheduled filter recovery/ }),
        ).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(`filtered-${width}-${scheme}-${view}.png`),
        });
        await expect(
          page.getByText(
            "No posts match the selected dates and filters. Try another date range or clear the filters.",
            { exact: true },
          ),
        ).toBeVisible();
        const clear = page.getByRole("button", { name: "Clear filters", exact: true });
        await clear.focus();
        await page.keyboard.press("Enter");
        await expect(status).toBeVisible();
        await expect(
          page.getByRole("button", { name: /Audit scheduled filter recovery/ }).first(),
        ).toBeVisible();
        await expect(range).toHaveText(before);
        await expect(clear).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 850 });
  await page.getByRole("button", { name: "All workspaces", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Calendar Filter Recovery", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Audit scheduled filter recovery/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "All platforms", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Bluesky", exact: true }).click();
  await page.getByRole("button", { name: "All posts", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Published", exact: true }).click();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  for (const name of ["All workspaces", "All platforms", "All posts"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: /Audit scheduled filter recovery/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No posts in this view", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  const result = await request.get(`/api/v1/publications/${publication.id}`, { headers });
  const stored = await result.json();
  expect(stored.status).toBe("scheduled");
  expect(stored.revision).toBe(1);
  expect(new Date(stored.scheduled_at).toISOString()).toBe("2026-10-03T14:00:00.000Z");
});
