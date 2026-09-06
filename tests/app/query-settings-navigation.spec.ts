import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320])
  for (const scheme of ["light", "dark"] as const) {
    test(`organization settings settles after cached navigation at ${width}px ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const auth = await registerUser(request, `query-settings-${Date.now()}@example.com`);
      await createWorkspace(request, auth.token, "Query settings");
      await authenticatePage(page, auth.token);
      await page.goto("/settings?tab=profile");
      await expect(page.getByTestId("settings-navigation")).toBeVisible();
      if (width >= 768) await page.getByRole("link", { name: "Organization", exact: true }).click();
      else {
        await page
          .getByTestId("settings-navigation")
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await page.getByRole("option", { name: "Plan & usage", exact: true }).click();
      }
      await expect(page.getByRole("heading", { name: "Plan & usage", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("plan-navigation.png"), fullPage: true });
      await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("plan-settled.png"), fullPage: true });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      for (const [tab, label] of [
        ["accounts", "Social accounts"],
        ["audit", "Organization audit"],
        ["ownership", "Ownership"],
        ["plan", "Plan & usage"],
      ]) {
        if (width >= 768) {
          const group = tab === "accounts" ? "Workspace" : "Organization";
          await page.getByRole("link", { name: group, exact: true }).click();
          await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
            "aria-busy",
            "false",
          );
          await page.locator(`[data-settings-tab="${tab}"]`).click();
        } else {
          await page
            .getByTestId("settings-navigation")
            .getByRole("button", { name: "Settings", exact: true })
            .click();
          await page.getByRole("option", { name: label, exact: true }).click();
        }
        await expect(page).toHaveURL(new RegExp(`tab=${tab}(?:&|$)`));
        await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
          "aria-busy",
          "false",
        );
        await expect(page.getByTestId("settings-navigation")).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }
