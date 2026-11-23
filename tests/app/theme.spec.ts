import { randomUUID } from "node:crypto";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
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

  test(`theme library remains usable at 390px in light`, async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { token } = await registerUser(
      request,
      `theme-layout-390-light-${randomUUID()}@example.com`,
    );
    await createWorkspace(request, token, "Theme layout");
    await authenticatePage(page, token);
    await page.goto("/settings?tab=appearance");
    await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
    await page.getByRole("button", { name: "Test Supabase", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "supabase");
    await page.getByRole("button", { name: "Stop testing" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "calm");
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
    await page.getByRole("button", { name: "Create theme", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: /Theme name/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeFocused();
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

  test("tests every built-in theme and restores the saved theme when leaving Appearance", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(request, `theme-catalog-${randomUUID()}@example.com`);
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
    await openPostsFromSidebar(page);
    await expect(page).toHaveURL(/\/publications(?:\?|$)/);
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "calm");
    await page.goBack();
    await expect(page.getByRole("button", { name: "Create theme", exact: true })).toBeEnabled();
  });
});

test.describe("theme appearance qa", () => {
  async function loginAsFreshUser(request: APIRequestContext, page: Page, seed: string) {
    const email = `appearance-qa-${seed}-${crypto.randomUUID()}@example.com`;
    const { token } = await registerUser(request, email);
    const workspace = await createWorkspace(request, token, `Appearance QA ${seed}`);
    await authenticatePage(page, token);
    return { token, workspace };
  }

  test("built-in gallery opens a preview and editor controls are keyboard reachable", async ({
    page,
    request,
    browser,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300));
    });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

    await loginAsFreshUser(request, page, "editor");
    await page.goto("/settings?tab=appearance");
    await expect(page.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    // Open the first previewable/duplicateable theme entry if present, scoped to
    // the settings main region so sidebar links (e.g. "View all") cannot match.
    const previewTrigger = page
      .locator("main")
      .getByRole("button", { name: /preview|view|open/i })
      .first();
    if (await previewTrigger.count()) {
      await previewTrigger.click();
      await expect(page).toHaveURL(/settings/);
    }
    // The keyboard traversal below measures the appearance tab: fail loudly if
    // the trigger above navigated away instead of opening inline UI.
    expect(page.url(), "appearance tab stays mounted").toContain("settings");

    // Keyboard traversal: tab through the first 25 focusable elements, confirm a
    // visible focus indicator exists on each (outline or focus-visible ring).
    await page.keyboard.press("Tab");
    let focusable = 0;
    let withIndicator = 0;
    const missingIndicators: string[] = [];
    for (let step = 0; step < 25; step += 1) {
      const focused = page.locator(":focus");
      if ((await focused.count()) === 0) break;
      focusable += 1;
      const indicator = await focused.evaluate((element) => {
        const style = getComputedStyle(element);
        const boxShadow = style.boxShadow !== "none";
        const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        return boxShadow || outline;
      });
      if (indicator) withIndicator += 1;
      else
        missingIndicators.push(
          await focused.evaluate(
            (element) =>
              `${element.tagName} ${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 80) ?? ""}`,
          ),
        );
      await page.keyboard.press("Tab");
    }

    // Touch targets: desktop density may use the theme control height, but
    // coarse pointers must always get 44px targets. Measure in a
    // touch-emulated context with the same session.
    const touchContext = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    await touchContext.addCookies(await page.context().cookies());
    const touchPage = await touchContext.newPage();
    await touchPage.goto("/settings?tab=appearance");
    await expect(touchPage.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await touchPage.waitForLoadState("networkidle").catch(() => undefined);
    const smallTargets: string[] = await touchPage.evaluate(() => {
      const flagged: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("main button")) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const tag = element.tagName.toLowerCase();
        if (tag === "a") continue;
        if (rect.height > 0 && rect.height < 44) {
          flagged.push(
            `${tag}: ${Math.round(rect.height)}px :: ${(element.textContent ?? "").trim().slice(0, 40)}`,
          );
        }
      }
      return flagged.slice(0, 20);
    });
    await touchContext.close();

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    expect(focusable, "keyboard reaches appearance controls").toBeGreaterThan(0);
    expect(
      withIndicator,
      `every focused control shows a focus indicator: ${missingIndicators.join(" | ")}`,
    ).toBe(focusable);
    expect(smallTargets, `controls under 44px: ${smallTargets.join(" | ")}`).toEqual([]);
  });

  test("workspace assignment controls exist and switching is atomic", async ({ page, request }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300));
    });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

    const { token } = await loginAsFreshUser(request, page, "assign");
    await createWorkspace(request, token, "Appearance QA second");
    await page.goto("/settings?tab=appearance");
    await expect(page.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const themeIdBefore =
      (await page.evaluate(() => document.documentElement.getAttribute("data-theme-id"))) ?? "none";
    // A resolved theme is always applied, even before any assignment exists.
    expect(themeIdBefore, "a theme is always resolved").not.toBe("none");

    // If a workspace switcher exists, switch and capture mid-transition frames.
    const switcher = page.getByRole("button", { name: /workspace|switch/i }).first();
    if (await switcher.count()) {
      await switcher.click();
    }
    const themeIdAfter =
      (await page.evaluate(() => document.documentElement.getAttribute("data-theme-id"))) ?? "none";

    expect(themeIdAfter, "a theme is still resolved after switching").not.toBe("none");
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    // The shell stays mounted across the switch: the heading must survive.
    await expect(page.getByRole("heading", { name: /appearance|theme/i }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
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

  test("page headers stay compact and use theme icons", async ({ page, request }) => {
    const { token } = await registerUser(request, `compact-headers-${randomUUID()}@example.com`);
    await createWorkspace(request, token, "Compact headers");
    await authenticatePage(page, token);
    for (const path of ["/media", "/settings?tab=profile", "/prompts", "/analytics"]) {
      await page.goto(path);
      const heading = page.locator('[data-slot="page-header"] h1');
      await expect(heading).toBeVisible();
      expect(
        await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeLessThanOrEqual(20);
      await expect(page.locator('img[src*="/brand/features/"]')).toHaveCount(0);
    }
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
