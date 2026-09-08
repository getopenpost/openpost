import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("create a theme, reopen its draft, publish, apply, and return to Appearance", async ({
  page,
  request,
}) => {
  const { token } = await registerUser(request, `theme-management-${Date.now()}@example.com`);
  await createWorkspace(request, token, "Theme management");
  await authenticatePage(page, token);
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeEnabled();
  await page.screenshot({
    path: "/tmp/theme-management-after.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create theme", exact: true }).click();
  await page.getByRole("textbox", { name: /Theme name/ }).fill("My theme");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.getByText("My theme", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
  const republish = page.waitForResponse(
    (response) => response.url().endsWith("/publish") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  expect((await republish).ok()).toBe(true);
  await page.getByRole("button", { name: "Revisions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true }).first()).toBeVisible();
  const themePath = `/api/v1/themes/${new URL(page.url()).searchParams.get("theme")}`;
  await page.route(
    (url) => url.pathname === themePath,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Temporarily unavailable" }),
      }),
  );
  const restoration = page.waitForResponse(
    (response) => response.url().endsWith("/rollback") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Restore", exact: true }).first().click();
  await page.getByRole("button", { name: "Restore revision", exact: true }).click();
  expect((await restoration).ok()).toBe(true);
  const publishRestored = page.waitForResponse(
    (response) => response.url().endsWith("/publish") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  expect((await publishRestored).ok()).toBe(true);
  await page.unrouteAll({ behavior: "wait" });

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Test My theme", exact: true }).click();
  await page.getByRole("button", { name: "Apply My theme", exact: true }).click();
  await expect(page.getByRole("button", { name: "Applied My theme", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop testing" })).toHaveCount(0);
  await page.getByRole("button", { name: "Publications", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Test Notebook", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Test Notebook", exact: true }).click();
  await page.getByRole("button", { name: "Apply Notebook", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-id", "notebook");
  await page.getByRole("button", { name: "Publications", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeEnabled();
});

test.use({ hasTouch: true });

for (const width of [1440, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`theme library remains usable at ${width}px in ${scheme}`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const { token } = await registerUser(
        request,
        `theme-layout-${width}-${scheme}-${Date.now()}@example.com`,
      );
      await createWorkspace(request, token, "Theme layout");
      await authenticatePage(page, token);
      await page.goto("/settings?tab=appearance");
      await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeEnabled();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await page.screenshot({
        path: `/tmp/theme-library-${width}-${scheme}.png`,
      });
      await page.getByRole("button", { name: "Test Supabase", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme-id", "supabase");
      await page.getByRole("button", { name: "Stop testing" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme-id", "workshop");
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await page.getByRole("button", { name: "Create theme", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("textbox", { name: /Theme name/ })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const shortControls = await page
        .getByTestId("theme-library")
        .locator("button")
        .evaluateAll((buttons) =>
          buttons
            .filter((button) => {
              const rect = button.getBoundingClientRect();
              return rect.height > 0 && rect.height < 44;
            })
            .map((button) => button.textContent?.trim()),
        );
      expect(shortControls).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("tests every built-in theme and restores the saved theme when leaving Appearance", async ({
  page,
  request,
}) => {
  const { token } = await registerUser(request, `theme-catalog-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, token, "Theme catalog");
  await authenticatePage(page, token);
  const response = await request.get("/api/v1/themes/available", {
    headers: { Authorization: `Bearer ${token}` },
    params: { workspace_id: workspace.id, limit: 100 },
  });
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  const builtins = catalog.items.filter(
    (item: { reference: { kind: string } }) => item.reference.kind === "built_in",
  );
  expect(builtins.length).toBeGreaterThan(20);
  await page.goto("/settings?tab=appearance");
  for (const theme of builtins) {
    await page.getByRole("button", { name: `Test ${theme.name}`, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", theme.reference.id);
  }
  await page.getByRole("button", { name: "Publications", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-id", "workshop");
  await page.goBack();
  await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeEnabled();
});
