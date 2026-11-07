import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const scheme of ["light"] as const) {
  for (const width of [1280, 320]) {
    test.describe(`analytics dates ${scheme} ${width}`, () => {
      test.use({ colorScheme: scheme, hasTouch: width < 768 });
      test("presets and custom dates apply complete ranges and cancel safely", async ({
        page,
        request,
      }, testInfo) => {
        const { token } = await registerUser(request, `dates-${randomUUID()}@example.com`);
        const workspace = await createWorkspace(request, token, "Analytics dates");
        await authenticatePage(page, token);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const ranges: { days: string | null; from: string | null; to: string | null }[] = [];
        await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
        await page.route("**/api/v1/analytics?**", (route) => {
          const q = new URL(route.request().url()).searchParams;
          ranges.push({ days: q.get("days"), from: q.get("from"), to: q.get("to") });
          return route.fulfill({
            json: {
              range_days: Number(q.get("days")),
              accounts: [],
              content: [],
              insights: [],
              trends: {},
              summary: {
                followers: { value: 0, measured: 0 },
                engagement: { value: 0, measured: 0 },
                views: { value: 0, measured: 0 },
                impressions: { value: 0, measured: 0 },
                reach: { value: 0, measured: 0 },
                published: 0,
              },
            },
          });
        });
        await page.goto(`/analytics?workspace=${workspace.id}`);
        const trigger = page.getByRole("button", { name: /^Reporting window:/ });
        await expect(trigger).toContainText("30 days");
        await page.screenshot({ path: testInfo.outputPath("before.png") });
        await trigger.click();
        await page.getByRole("button", { name: "Last year", exact: true }).click();
        await expect.poll(() => ranges.at(-1)).toEqual({ days: "365", from: null, to: null });
        await trigger.click();
        await page.getByRole("button", { name: "All time", exact: true }).click();
        await expect.poll(() => ranges.at(-1)).toEqual({ days: "0", from: null, to: null });
        await trigger.focus();
        await trigger.press("Enter");
        await page.getByRole("button", { name: "Custom range", exact: true }).click();
        await page.getByLabel("From", { exact: true }).fill("2026-07-21");
        await page.getByLabel("To", { exact: true }).fill("2026-07-22");
        expect(ranges.at(-1)).toEqual({ days: "0", from: null, to: null });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: testInfo.outputPath("custom-picker.png") });
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect
          .poll(() => ranges.at(-1))
          .toEqual({ days: "30", from: "2026-07-21", to: "2026-07-22" });
        await trigger.click();
        await page.getByLabel("To", { exact: true }).fill("2026-07-20");
        await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(trigger).toBeFocused();
        expect(ranges.at(-1)).toEqual({ days: "30", from: "2026-07-21", to: "2026-07-22" });
        await page.screenshot({ path: testInfo.outputPath("after.png") });
        expect(errors).toEqual([]);
      });
    });
  }
}
