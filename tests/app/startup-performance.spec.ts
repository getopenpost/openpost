import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

// Cold downloads and network failures must reach the network, not a service worker.
test.use({ serviceWorkers: "block" });

test("Appearance does not download every settings panel", async ({ page, request }) => {
  const { token } = await registerUser(request, `settings-budget-${Date.now()}@example.com`);
  await createWorkspace(request, token, "Settings performance");
  await authenticatePage(page, token);
  await page.goto("/settings?tab=appearance");
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }).first(),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  const scriptBytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter(
        (entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming,
      )
      .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
      .reduce((total, entry) => total + entry.decodedBodySize, 0),
  );
  expect(scriptBytes).toBeGreaterThan(0);
  expect(scriptBytes).toBeLessThan(3_000_000);
});

test("login stays within its JavaScript budget with analytics disabled", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const scriptBytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter(
        (entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming,
      )
      .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
      .reduce((total, entry) => total + entry.decodedBodySize, 0),
  );
  // Decoded bytes make the budget independent of server compression settings.
  expect(scriptBytes).toBeGreaterThan(0);
  expect(scriptBytes).toBeLessThan(1_200_000);
});

test("a failed settings download leaves navigation usable and can recover", async ({
  page,
  request,
}) => {
  const { token } = await registerUser(request, `settings-recovery-${Date.now()}@example.com`);
  await createWorkspace(request, token, "Settings recovery");
  await authenticatePage(page, token);
  await page.goto("/settings?tab=profile");
  await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.waitForLoadState("networkidle");
  await page.route("**/*.js", (route) => route.abort("failed"));
  await page.locator('[data-settings-tab="security"]').click();
  await expect(page.getByText("Could not load settings. Refresh to try again.")).toBeVisible();
  await expect(page.getByTestId("settings-navigation")).toBeVisible();
  await page.locator('[data-settings-tab="profile"]').click();
  await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByText("Could not load settings. Refresh to try again.")).toHaveCount(0);
  await page.locator('[data-settings-tab="security"]').click();
  await expect(page.getByText("Could not load settings. Refresh to try again.")).toBeVisible();
  await page.unroute("**/*.js");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page).toHaveURL(/tab=security/);
  await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByText("Could not load settings. Refresh to try again.")).toHaveCount(0);
});
