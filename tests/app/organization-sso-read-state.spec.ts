import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("SSO empty reads settle and failed reads do not advertise empty configuration", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `sso-read-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "SSO read states");
  await authenticatePage(page, auth.token);
  test.setTimeout(90000);
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/settings?tab=sso");
      await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(
        page.getByText("No work sign-in services have been added.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("No identity events have been recorded.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`sso-empty-loaded-${width}-${scheme}.png`),
        fullPage: true,
      });
      await page.route("**/api/v1/organizations/*/identity-audit-events*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          body: JSON.stringify({ status: 500, detail: "Audit temporarily unavailable" }),
        }),
      );
      await page.reload();
      await expect(page.getByRole("alert")).toContainText("Audit temporarily unavailable");
      await expect(
        page.getByText("No work sign-in services have been added.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("No identity events have been recorded.", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`sso-cold-read-failure-${width}-${scheme}.png`),
        fullPage: true,
      });
      await page.unroute("**/api/v1/organizations/*/identity-audit-events*");
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(
        page.getByText("No identity events have been recorded.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
    }
});
