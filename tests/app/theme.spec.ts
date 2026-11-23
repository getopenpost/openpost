import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser, assignBuiltInTheme } from "./helpers";

test.describe("theme management", () => {
  async function openPostsFromSidebar(page: Page) {
    await page
      .getByTestId("sidebar-workspace-navigation")
      .getByRole("button", { name: "Posts", exact: true })
      .click();
  }

  test("create a theme, reopen its draft, publish, apply, and return to Appearance", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(request, `theme-management-${randomUUID()}@example.com`);
    await createWorkspace(request, token, "Theme management");
    await authenticatePage(page, token);
    await page.goto("/settings?tab=appearance");
    await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeEnabled();
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
    await openPostsFromSidebar(page);
    await expect(page).toHaveURL(/\/publications(?:\?|$)/);
    await page.goBack();
    await expect(page.getByRole("button", { name: "Test Notebook", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Test Notebook", exact: true }).click();
    await page.getByRole("button", { name: "Apply Notebook", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "notebook");
    await openPostsFromSidebar(page);
    await expect(page).toHaveURL(/\/publications(?:\?|$)/);
    await page.goBack();
    await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeEnabled();
  });

  test.use({ hasTouch: true });
});

test.describe("profile theme continuity", () => {
  test.use({ serviceWorkers: "block" });

  test("public profiles retain the viewer's theme on direct entry and reload", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(request, `profile-theme-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Profile theme");
    const response = await request.patch("/api/v1/auth/profile", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        display_name: "Publishing record",
        public_profile_enabled: true,
        public_profile_visible_fields: ["display_name", "activity"],
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const me = await request.get("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const identity = await me.json();
    await assignBuiltInTheme(request, token, workspace.id, "dither-moss");
    await authenticatePage(page, token);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(`/u/${identity.username}`);
    await expect(
      page.getByRole("heading", { name: "Publishing record", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither-moss");
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither-moss");
    const colors = await page.locator(".profile-canvas").evaluate((element) => {
      const sample = document.createElement("span");
      element.append(sample);
      sample.style.color = "var(--activity-4)";
      const activity = getComputedStyle(sample).color;
      sample.style.color = "var(--primary)";
      const primary = getComputedStyle(sample).color;
      sample.remove();
      return { activity, primary };
    });
    expect(colors.activity).toBe(colors.primary);
    await page.context().clearCookies();
    await page.goto(`/u/${identity.username}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "calm");
    await expect(
      page.getByRole("heading", { name: "Publishing record", exact: true }),
    ).toBeVisible();
  });

  test("anonymous app entry uses the default Dither theme", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("data-theme-id", "calm");
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    }
  });
});
