import { randomUUID } from "node:crypto";
import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import {
  authenticatePage,
  createPublication,
  createWorkspace,
  registerUser,
  expectPostText,
} from "./helpers";
import { expectNoSeriousAccessibilityViolations } from "./accessibility";
import { execFileSync } from "node:child_process";

test.describe("navigation organization", () => {
  test("navigation separates work, workspace management, and personal preferences", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `navigation-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Navigation workspace");
    await authenticatePage(page, auth.token);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/publications");
    const workNavigation = page.getByTestId("sidebar-workspace-navigation");
    for (const name of ["Posts", "Inbox", "Analytics", "Ideas", "Studio", "Media", "Automations"]) {
      await expect(workNavigation.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("sidebar-new-post")).toHaveAccessibleName("New post");
    await page.getByTestId("profile-menu-trigger").click();
    await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Profile & security", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Preferences", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Send feedback", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Help & feedback", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Editors", exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Preferences", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Preferences", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Language", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Usage data sharing", { exact: true })).toBeVisible();
    const sounds = dialog.getByRole("checkbox", { name: "Interface sounds" });
    const checked = await sounds.getAttribute("aria-checked");
    await sounds.click();
    await expect(sounds).toHaveAttribute("aria-checked", checked === "true" ? "false" : "true");
    await page.keyboard.press("Escape");
    await page.getByTestId("workspace-menu-trigger").click();
    await page.getByRole("menuitem", { name: "Connected accounts", exact: true }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await page.goto("/publications");
    await page
      .getByRole("navigation", { name: "Post view" })
      .getByRole("link", { name: "Calendar", exact: true })
      .click();
    await expect(page).toHaveURL(/\/calendar$/);
    await page.goto("/media");
    await workNavigation.getByRole("button", { name: "Posts", exact: true }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await page.reload();
    await page
      .getByRole("navigation", { name: "Post view" })
      .getByRole("link", { name: "List", exact: true })
      .click();
    await expect(page).toHaveURL(/\/publications$/);
    const collapse = page.getByRole("button", {
      name: "Toggle sidebar",
      exact: true,
    });
    await collapse.focus();
    await page.keyboard.press("Enter");
    for (const name of ["Posts", "Inbox", "Analytics", "Media"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Media", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/media$/);
    expect(errors).toEqual([]);
  });

  test("mobile menus preserve keyboard focus and expose editor creation", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const auth = await registerUser(request, `nav-keyboard-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Keyboard workspace");
    await authenticatePage(page, auth.token);
    await page.goto("/publications");
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await nav.getByRole("button", { name: "More", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("End");
    const profile = page.getByRole("menuitem", { name: "Profile", exact: true });
    await expect(profile).toBeFocused();
    await page.keyboard.press("Enter");
    const back = page.getByRole("menuitem", { name: "Back", exact: true });
    await expect(back).toBeFocused();
    // Menu reflow can emit pointerleave without a new pointer action.
    await back.dispatchEvent("pointerleave", { pointerType: "mouse" });
    await expect(back).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(profile).toBeFocused();
    await page.keyboard.press("Escape");
    await nav.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Studio", exact: true }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await nav.getByRole("button", { name: "New post", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  for (const width of [1440, 390]) {
    test(`navigation menu preserves a keyboard choice made during opening at ${width}px`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const auth = await registerUser(request, `nav-opening-${randomUUID()}@example.com`);
      await createWorkspace(request, auth.token, "Keyboard workspace");
      await authenticatePage(page, auth.token);
      await page.goto("/publications");
      // Send End as soon as opening gives an item focus, before later focus work can run.
      await page.evaluate(() => {
        const moveToLast = (event: FocusEvent) => {
          const item = event.target as HTMLElement;
          if (item.getAttribute("role") !== "menuitem") return;
          document.removeEventListener("focusin", moveToLast);
          queueMicrotask(() =>
            item.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "End",
                code: "End",
                bubbles: true,
                cancelable: true,
              }),
            ),
          );
        };
        document.addEventListener("focusin", moveToLast);
      });
      const trigger =
        width === 390
          ? page
              .getByRole("navigation", { name: "Primary navigation" })
              .getByRole("button", { name: "More", exact: true })
          : page.getByRole("button", {
              name: "Switch workspace: Keyboard workspace",
              exact: true,
            });
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        page.getByRole("menuitem", {
          name: width === 390 ? "Profile" : "Workspace settings",
          exact: true,
        }),
      ).toBeFocused();
    });
  }

  test("short desktop keeps navigation and contextual draft resume reachable", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `nav-short-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Short navigation workspace");
    const response = await request.post("/api/v1/publications", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        workspace_id: workspace.id,
        title: "A recent thought to resume",
        source_text: "A recent thought to resume",
        content_profile: "short_text",
        social_account_ids: [],
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto("/publications");
    await page.getByTestId("profile-menu-trigger").click();
    await page.getByRole("menuitem", { name: "Preferences", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Preferences", exact: true })
      .getByRole("checkbox", { name: "Show drafts in the sidebar", exact: true })
      .check();
    await page.keyboard.press("Escape");
    await page.goto("/");
    const planner = page.getByTestId("desktop-sidebar-planner");
    const viewAll = planner.getByRole("button", {
      name: "View all",
      exact: true,
    });
    await expect(viewAll).toBeInViewport();
    const draft = planner.getByRole("link", {
      name: "Resume draft: A recent thought to resume",
      exact: true,
    });
    await expect(draft).toBeVisible();
    await draft.scrollIntoViewIfNeeded();
    const draftBounds = await draft.boundingBox();
    const contentBounds = await page.locator('[data-sidebar="content"]').boundingBox();
    expect(draftBounds!.y).toBeGreaterThanOrEqual(contentBounds!.y);
    expect(draftBounds!.y + draftBounds!.height).toBeLessThanOrEqual(
      contentBounds!.y + contentBounds!.height,
    );
    await page.locator('[data-sidebar="content"]').evaluate((content) => content.scrollTo(0, 0));
    for (const name of ["Posts", "Inbox", "Analytics"])
      await expect(
        page.getByTestId("sidebar-workspace-navigation").getByRole("button", { name, exact: true }),
      ).toBeInViewport();
    await viewAll.click();
    await expect(page).toHaveURL(/publications\?tab=drafts$/);
    await expect(page.getByTestId("publication-list")).toBeVisible();
    await expect(planner).toBeVisible();
  });

  test("drafts fill the sidebar on every workspace page", async ({ page, request }) => {
    const auth = await registerUser(request, `nav-drafts-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Draft navigation");
    for (let index = 1; index <= 12; index++) {
      await createPublication(request, auth.token, workspace.id, `Sidebar draft ${index}`);
    }
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/publications");
    await expect(page.getByTestId("sidebar-draft-list")).toHaveCount(0);
    await page.getByTestId("profile-menu-trigger").click();
    await page.getByRole("menuitem", { name: "Preferences", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Preferences", exact: true });
    const preference = dialog.getByRole("checkbox", {
      name: "Show drafts in the sidebar",
    });
    await expect(preference).not.toBeChecked();
    await preference.click();
    await page.keyboard.press("Escape");
    await page.reload();
    const drafts = page.getByTestId("sidebar-draft-list");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of ["/", "/publications", "/inbox/engagement", "/analytics", "/media"]) {
      await page.goto(route);
      await expect(drafts.getByRole("link")).toHaveCount(12);
      // The planner sections own the horizontal inset; the content region must not pad them again.
      const draftsInset = await page.locator('[data-sidebar="content"]').evaluate((content) => {
        const bounds = content.getBoundingClientRect();
        const link = content.querySelector('[data-testid="sidebar-draft-list"] a');
        return link ? Math.round(link.getBoundingClientRect().x - bounds.x) : -1;
      });
      expect(draftsInset).toBe(8);
      const visibleCount = await drafts.getByRole("link").evaluateAll((links) => {
        const viewport = links[0].closest("ul")!.getBoundingClientRect();
        return links.filter((link) => {
          const bounds = link.getBoundingClientRect();
          return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
        }).length;
      });
      expect(visibleCount).toBeGreaterThan(3);
    }
    await page.setViewportSize({ width: 1280, height: 600 });
    await drafts.getByRole("link").last().scrollIntoViewIfNeeded();
    await expect(drafts.getByRole("link").last()).toBeInViewport();
    const lastDraft = await drafts.getByRole("link").last().boundingBox();
    const sidebarContent = await page.locator('[data-sidebar="content"]').boundingBox();
    expect(lastDraft!.y).toBeGreaterThanOrEqual(sidebarContent!.y);
    expect(lastDraft!.y + lastDraft!.height).toBeLessThanOrEqual(
      sidebarContent!.y + sidebarContent!.height,
    );
    await expect(page.getByRole("button", { name: "Media", exact: true })).toBeInViewport();
    expect(errors).toEqual([]);
  });
});

test.describe("navigation progress", () => {
  test.use({ serviceWorkers: "block" });

  test.afterEach(async ({ page }) => {
    expect(await page.pageErrors()).toEqual([]);
  });

  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`navigation progress follows slow routes with ${reducedMotion} motion`, async ({
      page,
    }) => {
      await page.emulateMedia({
        reducedMotion,
        colorScheme: reducedMotion === "reduce" ? "dark" : "light",
      });
      await page.goto("/login");
      await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
      await page.waitForLoadState("networkidle");
      let release!: () => void;
      const download = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/*.js", async (route) => {
        await download;
        await route.continue();
      });
      try {
        await page.locator('a[href="/register"]').click();
        await expect(page.locator(".navigation-progress .bar")).toBeVisible();
        if (reducedMotion === "reduce")
          await expect(page.locator(".navigation-progress .bar")).toHaveCSS(
            "transition-duration",
            "0s",
          );
      } finally {
        release();
      }
      await expect(page).toHaveURL(/\/register$/);
      await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
      await expect(page.locator(".navigation-progress .bar")).toHaveCount(0);
      await page.unroute("**/*.js");
      // Cached history navigation should finish without showing another bar.
      await page.evaluate(() => {
        const bars: number[] = [];
        Object.assign(window, { navigationBars: bars });
        new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes) {
              if (node instanceof HTMLElement && node.classList.contains("bprogress"))
                bars.push(performance.now());
            }
        }).observe(document.querySelector(".navigation-progress")!, { childList: true });
      });
      await page.goBack();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => (window as Window & { navigationBars: number[] }).navigationBars),
      ).toEqual([]);
    });
  }

  test("a superseded slow navigation cannot clear the current progress", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('a[href="/register"]')).toBeVisible();
    await page.waitForLoadState("networkidle");
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let phase = first;
    await page.route("**/*.js", async (route) => {
      const pending = phase;
      await pending;
      await route.continue();
    });
    try {
      await page.locator('a[href="/register"]').click();
      await expect(page.locator(".navigation-progress .bar")).toBeVisible();
      phase = second;
      await page.locator('a[href="/forgot-password"]').click();
      releaseFirst();
      await expect(page.locator(".navigation-progress .bar")).toBeVisible();
      // The bar must not disappear within the previous bar's completion animation window.
      await expect(
        expect(page.locator(".navigation-progress .bar")).toHaveCount(0, { timeout: 700 }),
      ).rejects.toThrow();
      await expect(page.locator(".navigation-progress .bar")).toBeVisible();
    } finally {
      releaseFirst();
      releaseSecond();
    }
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.locator(".navigation-progress .bar")).toHaveCount(0);
  });
});

test.describe("not found", () => {
  const missingPath = "/route-that-openpost-does-not-have";

  function isExpectedMissingRouteError(message: string, locationURL = ""): boolean {
    if (message.includes(`Not found: ${missingPath}`)) return true;
    if (!message.includes("status of 404") || !locationURL) return false;
    try {
      return new URL(locationURL).pathname === missingPath;
    } catch {
      return false;
    }
  }

  function captureBrowserErrors(page: Page) {
    const errors: string[] = [];
    page.on("console", (message: ConsoleMessage) => {
      if (
        message.type() === "error" &&
        !isExpectedMissingRouteError(message.text(), message.location().url)
      ) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error: Error) => {
      if (!isExpectedMissingRouteError(error.message)) errors.push(error.message);
    });
    return errors;
  }

  test("unknown documents return 404 with a complete recovery page", async ({ page, request }) => {
    const errors = captureBrowserErrors(page);
    const response = await page.goto(missingPath);

    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("app-error-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeFocused();
    await expectNoSeriousAccessibilityViolations(page);
    await expect(page.getByText("HTTP 404")).toBeVisible();
    await expect(page.getByRole("link", { name: "OpenPost home" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New post" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Posts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Media" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "href",
      "https://openpo.st/docs/usage/",
    );
    await expect(page.getByRole("link", { name: "Contact support" })).toHaveCount(0);

    const reload = await page.reload();
    expect(reload?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeFocused();

    expect((await request.get("/publications/example")).status()).toBe(200);
    expect((await request.get("/calendar-export")).status()).toBe(404);
    for (const retiredPath of [
      // /accounts and /studio are first-class destinations now, not retired paths.
      "/accounts/setup",
      "/activity",
      "/posts",
      "/engagement",
      "/messages",
      "/notifications",
      "/video-studio",
    ]) {
      expect((await request.get(retiredPath)).status(), retiredPath).toBe(404);
    }
    expect(errors).toEqual([]);
  });

  test("the error boundary reports offline state and restores the underlying recovery in place", async ({
    page,
  }) => {
    const errors = captureBrowserErrors(page);
    await page.addInitScript(() => {
      (window as typeof window & { __openpostOnline?: boolean }).__openpostOnline = false;
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () =>
          (window as typeof window & { __openpostOnline?: boolean }).__openpostOnline ?? true,
      });
    });

    const response = await page.goto(missingPath);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Try again" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Contact support" })).toHaveCount(0);
    await expectNoSeriousAccessibilityViolations(page);

    await page.evaluate(() => {
      (window as typeof window & { __openpostOnline?: boolean }).__openpostOnline = true;
      window.dispatchEvent(new Event("online"));
    });

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("chunk recovery navigation", () => {
  test.use({ serviceWorkers: "block" });

  test("a later transient route import recovers after a healthy navigation", async ({ page }) => {
    test.setTimeout(60_000);
    let failedAsset = "";
    let failures = 0;
    let failNext = false;
    await page.route("**/_app/immutable/nodes/*.js", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (failNext && (!failedAsset || failedAsset === pathname)) {
        failedAsset = pathname;
        failures++;
        failNext = false;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

    failNext = true;
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

    failNext = true;
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    expect(failures).toBe(2);
  });

  test("two consecutive transient route imports recover within the retry limit", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

    let failedAsset = "";
    let failures = 0;
    let forgotNavigationCount = 0;
    let lastFailedNavigation = 0;
    await page.route("**/forgot-password", async (route) => {
      if (route.request().isNavigationRequest()) forgotNavigationCount++;
      await route.continue();
    });
    await page.route("**/_app/immutable/nodes/*.js", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (
        failures < 2 &&
        forgotNavigationCount > lastFailedNavigation &&
        (!failedAsset || failedAsset === pathname)
      ) {
        failedAsset = pathname;
        failures++;
        lastFailedNavigation = forgotNavigationCount;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    expect(failures).toBe(2);
    expect(forgotNavigationCount).toBeGreaterThanOrEqual(3);
  });

  test("a persistent route import failure stops at a visible error", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

    let failedAsset = "";
    let failures = 0;
    let forgotNavigationCount = 0;
    let lastFailedNavigation = 0;
    await page.route("**/forgot-password", async (route) => {
      if (route.request().isNavigationRequest()) forgotNavigationCount++;
      await route.continue();
    });
    await page.route("**/_app/immutable/nodes/*.js", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (
        forgotNavigationCount > lastFailedNavigation &&
        (!failedAsset || failedAsset === pathname)
      ) {
        failedAsset = pathname;
        failures++;
        lastFailedNavigation = forgotNavigationCount;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/forgot-password");
    await expect.poll(() => failures, { timeout: 15_000 }).toBe(4);
    await expect(
      page.getByRole("heading", { name: /^(OpenPost could not show this page|Internal Error)$/ }),
    ).toBeVisible({ timeout: 30_000 });
    expect(forgotNavigationCount).toBe(4);
  });
});

test.describe("load recovery", () => {
  test("accepted invitations retry workspace refresh without consuming the token again", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `invite-refresh-recovery-${unique}@example.com`);
    const workspace = (await createWorkspace(
      request,
      auth.token,
      "Invite Refresh Recovery E2E",
    )) as {
      id: string;
    };
    await authenticatePage(page, auth.token);

    // Invitation refresh goes through app bootstrap, not the workspaces list.
    // The initial page-load bootstrap carries no preference and must pass;
    // only the refresh (preferred_workspace_id set) fails until retried.
    // Both the initial attempt and its one automatic retry fail so the error
    // surfaces instead of being absorbed.
    let allowWorkspaceRefresh = false;
    await page.route("**/api/v1/app/bootstrap?**", async (route) => {
      const preferred = new URL(route.request().url()).searchParams.get("preferred_workspace_id");
      if (!preferred || allowWorkspaceRefresh) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { title: "Unavailable", status: 503 },
      });
    });

    let acceptanceRequests = 0;
    await page.route("**/api/v1/workspace-invitations/accept", async (route) => {
      acceptanceRequests++;
      await route.fulfill({
        contentType: "application/json",
        json: { workspace_id: workspace.id, role: "editor" },
      });
    });

    await page.goto("/invite?token=consumed-token");

    await expect(
      page.getByRole("heading", { level: 1, name: "Invitation accepted" }),
    ).toBeVisible();
    await expect(page.getByTestId("invite-error")).toHaveCount(0);
    const refreshError = page.getByTestId("invite-workspace-refresh-error");
    await expect(refreshError).toContainText(
      "You joined the workspace, but OpenPost could not refresh your workspace list.",
    );
    await expect(page.getByRole("link", { name: "Open Workspace" })).toHaveCount(0);

    allowWorkspaceRefresh = true;
    await refreshError.getByRole("button", { name: "Try again" }).click();

    await expect(refreshError).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Workspace" })).toBeVisible();
    expect(acceptanceRequests).toBe(1);
  });
});

test.describe("loading boundaries", () => {
  test.use({ serviceWorkers: "block" });

  test.afterEach(async ({ page }) => {
    expect(await page.pageErrors()).toEqual([]);
  });

  for (const section of ["publications", "messages", "engagement"] as const) {
    test(`${section} keeps controls while the selected view loads at 390px`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.emulateMedia({
        colorScheme: "light",
      });
      const { token } = await registerUser(
        request,
        `view-loading-${section}-${randomUUID()}@example.com`,
      );
      await createWorkspace(request, token, "View loading");
      await authenticatePage(page, token);
      await page.goto(
        section === "publications" ? "/publications?tab=scheduled" : `/inbox/${section}`,
      );
      await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
        "aria-busy",
        "false",
      );
      // Inbox keeps an authorized long-poll pending after its visible data settles.
      if (section === "publications") await page.waitForLoadState("networkidle");
      if (section === "messages") {
        await page.getByRole("button", { name: "Filters", exact: true }).click();
      }
      let release!: () => void;
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(
        section === "publications"
          ? "**/api/v1/publications?**"
          : section === "messages"
            ? "**/api/v1/messages?**"
            : "**/api/v1/engagement?**",
        async (route) => {
          await response;
          await route.continue();
        },
      );
      const control =
        section === "publications"
          ? page.getByRole("tab", { name: "Published", exact: true })
          : page.getByRole("checkbox", { name: "Archived", exact: true });
      try {
        if (section === "engagement") {
          await page.getByRole("button", { name: "Filters", exact: true }).click();
        }
        await control.click();
        await expect(page.getByTestId("page-loading")).toBeVisible();
        await expect(control).toBeVisible();
        if (section !== "publications") {
          const navigation = page.getByTestId("communications-navigation");
          await expect(navigation).toBeVisible();
        }
        const action =
          section === "publications"
            ? page.getByRole("button", { name: "Refresh", exact: true })
            : page.locator('[data-slot="page-header-actions"]').getByRole("button").first();
        await expect(action).toBeVisible();
      } finally {
        release();
      }
      await expect(page.getByTestId("page-loading")).toHaveCount(0);
      await expect(control).toBeVisible();
    });
  }

  test(`settings keeps navigation during section downloads at 390px light`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const { token } = await registerUser(request, `loading-boundary-${randomUUID()}@example.com`);
    await createWorkspace(request, token, "Loading boundaries");
    await authenticatePage(page, token);
    await page.goto("/settings?tab=general");
    await expect(page.getByTestId("settings-navigation")).toBeVisible();
    await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page.waitForLoadState("networkidle");
    let release!: () => void;
    const download = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*.js", async (route) => {
      await download;
      await route.continue();
    });
    try {
      await page
        .getByTestId("settings-navigation")
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      await page.getByRole("option", { name: "Security", exact: true }).click();
      await expect(page).toHaveURL(/tab=security/);
      await expect(page.getByTestId("page-loading")).toBeVisible();
      await expect(page.getByTestId("settings-navigation")).toBeVisible();
    } finally {
      release();
    }
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    // Panel content only renders after its section download completes.
    await expect(page.getByRole("heading", { name: "Active sessions", exact: true })).toBeVisible();
    await expect(page.getByTestId("settings-navigation")).toBeVisible();
  });

  for (const surface of ["calendar", "media"] as const) {
    test(`${surface} keeps controls when its data scope changes`, async ({ page, request }) => {
      const { token } = await registerUser(
        request,
        `scope-loading-${surface}-${randomUUID()}@example.com`,
      );
      await createWorkspace(request, token, "First workspace");
      await createWorkspace(request, token, "Second workspace");
      await authenticatePage(page, token);
      await page.goto(`/${surface}`);
      const control =
        surface === "calendar"
          ? page.getByRole("button", { name: "Next month", exact: true })
          : page.getByTestId("media-filter-bar").getByRole("searchbox");
      await expect(control).toBeVisible();
      await page.waitForLoadState("networkidle");
      let release!: () => void;
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(
        surface === "media" ? "**/api/v1/media**" : "**/api/v1/**",
        async (route) => {
          await response;
          await route.continue();
        },
      );
      try {
        if (surface === "calendar") await control.click();
        else {
          await page
            .locator('[data-slot="page-header-actions"]')
            .getByRole("button", { name: "First workspace", exact: true })
            .click();
          await page.getByRole("option", { name: "Second workspace", exact: true }).click();
        }
        await expect(page.getByTestId("page-loading")).toBeVisible();
        await expect(control).toBeVisible();
        if (surface === "media") {
          await expect(page.getByTestId("media-lifecycle-tabs")).toBeVisible();
          await control.fill("launch");
          await expect(control).toHaveValue("launch");
        }
      } finally {
        release();
      }
      await expect(page.getByTestId("page-loading")).toHaveCount(0);
    });
  }

  test("Grow can switch back while another account is still loading", async ({ page, request }) => {
    const { token } = await registerUser(request, `grow-loading-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Grow loading");
    await authenticatePage(page, token);
    const accounts = ["first", "second"].map((name) => ({
      id: name,
      workspace_id: workspace.id,
      platform: "bluesky",
      is_active: true,
      account_username: name,
    }));
    await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: accounts }));
    await page.route("**/api/v1/account-features?**", (route) =>
      route.fulfill({
        json: accounts.map((account) => ({
          social_account_id: account.id,
          feature: "grow",
          effective_enabled: true,
        })),
      }),
    );
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/growth?**", async (route) => {
      const account = new URL(route.request().url()).searchParams.get("account_id");
      if (account === "second") await response;
      await route.fulfill({
        json: {
          items: [],
          follow_updates: [],
          sync_state: {
            workspace_id: workspace.id,
            social_account_id: account,
            status: "ok",
            last_success_at: null,
          },
        },
      });
    });
    await page.goto("/grow");
    const selector = page.getByTestId("grow-account-select");
    await expect(selector).toContainText("first");
    await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
      "aria-busy",
      "false",
    );
    try {
      await selector.click();
      await page.getByRole("option").filter({ hasText: "second" }).click();
      await expect(page.getByTestId("page-loading")).toBeVisible();
      await expect(selector).toBeVisible();
      await selector.click();
      await page.getByRole("option").filter({ hasText: "first" }).click();
      await expect(selector).toContainText("first");
      await expect(page.getByTestId("page-loading")).toHaveCount(0);
    } finally {
      release();
    }
    await expect(selector).toContainText("first");
  });
});

test.describe("invalid link recovery", () => {
  for (const path of ["/invite", "/cli/authorize", "/preview"]) {
    test(`incomplete ${path} links offer keyboard recovery without requests`, async ({
      page,
      request,
    }) => {
      const auth = await registerUser(request, `invalid-links-${randomUUID()}@example.com`);
      await createWorkspace(request, auth.token, "Invalid Links");
      await authenticatePage(page, auth.token);
      await page.goto("/invite");
      const forbidden: string[] = [];
      page.on("request", (request) => {
        if (/workspace-invitations|cli\/auth\/(session|approve|deny)/.test(request.url()))
          forbidden.push(request.url());
      });
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const recovery = page.getByRole("link", {
        name: path === "/preview" ? "Open composer" : "Return to OpenPost",
        exact: true,
      });
      await expect(recovery).toBeVisible();
      await expect(recovery).toHaveAttribute("href", "/");
      await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
      await recovery.focus();
      await expect(recovery).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/$/);
      expect(forbidden).toEqual([]);
    });
  }
});

test.describe("notifications read state", () => {
  test("notification status, count and filters agree after reading and reload", async ({
    page,
    request,
  }) => {
    const email = `notification-state-${randomUUID()}@example.com`;
    const { token } = await registerUser(request, email);
    const workspace = await createWorkspace(request, token, "Audit notification state");
    const notificationID = randomUUID();
    const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
    // Seed a stored event, without triggering a provider or external delivery.
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      database,
      `INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, created_at)
       SELECT '${notificationID}', id, '${workspace.id}', 'post_published', 'Audit read state', 'Synthetic stored notification.', datetime('now')
       FROM users WHERE email = '${email}';`,
    ]);
    await authenticatePage(page, token);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/inbox/notifications");
    const inbox = page.getByRole("region", { name: "Notifications", exact: true });
    const row = page.locator(`[data-notification-id="${notificationID}"]`);
    await expect(row).toBeVisible();
    await expect(inbox.getByText("1 unread notifications", { exact: true })).toBeVisible();
    await expect(row).toHaveAttribute("data-unread", "true");
    const filters = page.getByRole("tablist", { name: "Filter notifications by read status" });
    await filters.getByRole("tab", { name: "Unread", exact: true }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Mark as read", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(inbox.getByText("0 unread notifications", { exact: true })).toBeVisible();
    await expect(row).toBeHidden();
    await expect(filters.getByRole("tab", { name: "Unread", exact: true })).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "No notifications match this filter" }),
    ).toBeVisible();
    await filters.getByRole("tab", { name: "Read", exact: true }).click();
    await expect(row).toHaveAttribute("data-unread", "false");

    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(row).toBeHidden();
    await expect(inbox.getByText("0 unread notifications", { exact: true })).toBeVisible();
    await filters.getByRole("tab", { name: "Unread", exact: true }).click();
    await expect(row).toBeHidden();
    await filters.getByRole("tab", { name: "Read", exact: true }).click();
    await expect(row).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("opening an engagement clears it from the active inbox and preserves read history", async ({
    page,
    request,
  }) => {
    const email = `notification-open-${randomUUID()}@example.com`;
    const { token } = await registerUser(request, email);
    const workspace = await createWorkspace(request, token, "Notification opening");
    const id = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, href, created_at)
       SELECT '${id}', id, '${workspace.id}', 'new_engagement', 'A new comment', 'Someone replied to your post.', '/inbox/engagement', datetime('now') FROM users WHERE email = '${email}';`,
    ]);
    await authenticatePage(page, token);
    await page.goto("/inbox/notifications");
    const row = page.locator(`[data-notification-id="${id}"]`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Open notification", exact: true }).click();
    await expect(page).toHaveURL(/\/inbox\/engagement$/);
    await page.goto("/inbox/notifications");
    await expect(page.getByRole("tab", { name: "Unread", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(row).toBeHidden();
    await page.getByRole("tab", { name: "Read", exact: true }).click();
    await expect(row).toHaveAttribute("data-unread", "false");
    await page.reload();
    await expect(row).toBeHidden();
  });

  test("notification panel keeps reads explicit, recovers failures and fits desktop and phones", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(10_000);
    const email = `notification-panel-${randomUUID()}@example.com`;
    const { token } = await registerUser(request, email);
    const workspace = await createWorkspace(request, token, "Notification panel");
    const engagementID = randomUUID();
    const noticeID = randomUUID();
    const otherNoticeID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, href, created_at)
       SELECT '${engagementID}', id, '${workspace.id}', 'new_engagement', 'Panel comment', 'A comment to review.', '/inbox/engagement', datetime('now') FROM users WHERE email = '${email}';
       INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, created_at)
       SELECT '${noticeID}', id, '${workspace.id}', 'post_published', 'Panel update', 'Published on all destinations.', datetime('now') FROM users WHERE email = '${email}';
       INSERT INTO user_notifications (id, user_id, workspace_id, type, title, body, created_at)
       SELECT '${otherNoticeID}', id, '${workspace.id}', 'post_published', 'Another panel update', 'A second update.', datetime('now') FROM users WHERE email = '${email}';`,
    ]);
    await authenticatePage(page, token);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto("/inbox/engagement");
    const bell = page.getByTestId("sidebar-notifications").filter({ visible: true });
    const panel = page.getByTestId("notification-panel");
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(bell).toHaveAccessibleName("Notifications, 3 unread");
    await expect(bell.getByText("3", { exact: true })).toBeVisible();
    await bell.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Panel comment", { exact: true })).toBeVisible();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(bell).toBeFocused();
    await bell.click();
    await page.route("**/api/v1/notifications/read", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Read unavailable" }),
      }),
    );
    await panel.getByRole("button", { name: /Panel comment/ }).click();
    await expect(
      panel.getByText("OpenPost could not mark this notification as read. Try again."),
    ).toBeVisible();
    await expect(panel.getByText("Panel comment", { exact: true })).toBeVisible();
    await expect(bell).toHaveAccessibleName("Notifications, 3 unread");
    await expect(panel).toBeVisible();
    await page.unroute("**/api/v1/notifications/read");
    await panel.getByRole("button", { name: /Panel comment/ }).click();
    await expect(panel).toBeHidden();
    await expect(bell).toHaveAccessibleName("Notifications, 2 unread");
    await bell.click();
    await expect(panel.getByText("Panel comment", { exact: true })).toBeHidden();
    const noticeRow = panel.locator(`[data-notification-id="${noticeID}"]`);
    await noticeRow.getByRole("button", { name: "Mark as read", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(noticeRow).toBeHidden();
    await expect(
      panel
        .locator(`[data-notification-id="${otherNoticeID}"]`)
        .getByRole("button", { name: "Mark as read", exact: true }),
    ).toBeFocused();
    await expect(bell).toHaveAccessibleName("Notifications, 1 unread");
    await panel.getByRole("button", { name: "Mark this inbox read", exact: true }).click();
    await expect(bell).toHaveAccessibleName("Notifications, 0 unread");
    await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
    await page.route("**/api/v1/notifications?*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Refresh unavailable" }),
      }),
    );
    await page.clock.fastForward(31_000);
    await page.clock.resume();
    await expect(panel.getByText("Refresh unavailable", { exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeHidden();
    await page.unroute("**/api/v1/notifications?*");
    await panel.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
    await panel.getByRole("link", { name: "Show all notifications", exact: true }).click();
    await expect(page).toHaveURL(/\/inbox\/notifications\?status=all$/);
    await expect(page.locator(`[data-notification-id="${engagementID}"]`)).toHaveAttribute(
      "data-unread",
      "false",
    );
    await expect(page.locator(`[data-notification-id="${noticeID}"]`)).toHaveAttribute(
      "data-unread",
      "false",
    );
    await page.reload();
    await expect(bell).toHaveAccessibleName("Notifications, 0 unread");
    await page.route("**/api/v1/notifications?*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Notifications unavailable" }),
      }),
    );
    await page.reload();
    await bell.click();
    await expect(panel.getByText("Notifications unavailable", { exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeHidden();
    await page.unroute("**/api/v1/notifications?*");
    await panel.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
    const touchContext = await page
      .context()
      .browser()!
      .newContext({
        baseURL: testInfo.project.use.baseURL,
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
      });
    try {
      const phone = await touchContext.newPage();
      await authenticatePage(phone, token);
      await phone.goto("/inbox/engagement");
      const phoneBell = phone.getByTestId("sidebar-notifications").filter({ visible: true });
      const touchBox = await phoneBell.boundingBox();
      expect(touchBox!.height).toBeGreaterThanOrEqual(44);
      expect(touchBox!.width).toBeGreaterThanOrEqual(44);
      await phoneBell.tap();
      await expect(phone.getByTestId("notification-panel")).toBeVisible();
      await phone
        .getByTestId("notification-panel")
        .getByRole("button", { name: "Close", exact: true })
        .tap();
      await expect(phone.getByTestId("notification-panel")).toBeHidden();
    } finally {
      await touchContext.close();
    }
    expect(errors).toEqual([]);
  });
});

test.describe("workspace switcher", () => {
  // The create-flow half of this selection race was fixed by decoupling workspace
  // selection from dialog mount state in create-workspace-dialog.svelte (the
  // selection guard now checks only the actor identity, so bootstrap-invalidation
  // remounts mid-flight no longer abort selection). Re-enabled to prove it end to end.
  test("workspace switcher creates and selects a workspace", async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const unique = Date.now().toString(36);
    const email = `workspace-create-${unique}@example.com`;
    const firstName = `Personal ${unique}`;
    const newName = `Project ${unique}`;

    const auth = await registerUser(request, email);
    await createWorkspace(request, auth.token, firstName);

    await authenticatePage(page, auth.token);
    await page.goto("/");

    const workspaceButton = page
      .getByRole("button", { name: new RegExp(`${firstName}|${newName}`) })
      .first();
    await expect(workspaceButton).toBeVisible();
    await page.reload();
    await expect(workspaceButton).toContainText(firstName);

    await workspaceButton.click();
    await page.getByRole("menuitem", { name: "Create workspace" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();
    await dialog.getByLabel("Workspace name").fill(newName);

    const createResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/workspaces" && response.request().method() === "POST";
    });
    await dialog.getByRole("button", { name: "Create workspace" }).click();
    expect((await createResponse).ok()).toBe(true);

    await expect(dialog).toBeHidden();
    await expect(workspaceButton).toContainText(newName);

    await workspaceButton.click();
    await expect(page.getByRole("menuitem", { name: new RegExp(newName) })).toBeVisible();
    await page.getByRole("menuitem", { name: new RegExp(firstName) }).click();
    await expect(workspaceButton).toContainText(firstName);
    await page
      .getByTestId("sidebar-workspace-navigation")
      .getByRole("button", { name: "Inbox", exact: true })
      .click();
    await expect(page).toHaveURL(/\/inbox\/engagement/);
    await expect(
      page.getByRole("heading", { name: "No engagement yet", exact: true }),
    ).toBeVisible();
    await workspaceButton.click();
    await expect(page.getByRole("menuitem", { name: new RegExp(newName) })).toBeVisible();
    await page.getByRole("menuitem", { name: new RegExp(newName) }).click();
    await expect(workspaceButton).toContainText(newName);
    await page.reload();
    await expect(workspaceButton).toContainText(newName);
    await workspaceButton.click();
    await expect(page.getByRole("menuitem", { name: new RegExp(firstName) })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: new RegExp(newName) })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    const trigger = workspaceButton;
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("menuitem", { name: new RegExp(firstName) })).toBeVisible();
    const createdItem = page.getByRole("menuitem", { name: new RegExp(newName) });
    await expect(createdItem).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");

    await expect(createdItem).toBeFocused();
    await expect(createdItem).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(pageErrors).toEqual([]);
  });

  test("workspace-scoped pages reload when the sidebar workspace changes", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const email = `workspace-pages-${unique}@example.com`;
    const auth = await registerUser(request, email);
    const first = (await createWorkspace(request, auth.token, `Editorial ${unique}`)) as {
      id: string;
      name: string;
    };
    const second = (await createWorkspace(request, auth.token, `Campaign ${unique}`)) as {
      id: string;
      name: string;
    };

    await authenticatePage(page, auth.token);
    await page.goto("/settings?tab=accounts");

    const workspaces = [first, second];
    const workspaceButton = page
      .getByRole("button", {
        name: new RegExp(workspaces.map((workspace) => workspace.name).join("|")),
      })
      .first();
    await expect(workspaceButton).toBeVisible();

    const activeText = await workspaceButton.innerText();
    const active = workspaces.find((workspace) => activeText.includes(workspace.name));
    expect(active).toBeTruthy();
    const next = active?.id === first.id ? second : first;

    const accountsRequest = page.waitForRequest((candidate) => {
      const url = new URL(candidate.url());
      return (
        url.pathname === "/api/v1/accounts" && url.searchParams.get("workspace_id") === next.id
      );
    });
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(next.name) }).click();
    await accountsRequest;
    await expect(workspaceButton).toContainText(next.name);

    await page.goto("/publications");
    await expect(workspaceButton).toContainText(next.name);
    const previous = next.id === first.id ? second : first;
    const publicationsRequest = page.waitForRequest((candidate) => {
      const url = new URL(candidate.url());
      return (
        url.pathname === "/api/v1/publications" &&
        url.searchParams.get("workspace_id") === previous.id
      );
    });
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(previous.name) }).click();
    await publicationsRequest;
    await expect(workspaceButton).toContainText(previous.name);
  });

  test("dirty composer workspace switches can stay, save to the origin, or discard", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `workspace-composer-${unique}@example.com`);
    const first = (await createWorkspace(request, auth.token, `Origin ${unique}`)) as {
      id: string;
      name: string;
    };
    const second = (await createWorkspace(request, auth.token, `Target ${unique}`)) as {
      id: string;
      name: string;
    };

    await authenticatePage(page, auth.token);
    await page.addInitScript((workspace) => {
      localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
    }, first);

    const draftWrites: Array<{ workspace_id?: string; source_text?: string }> = [];
    let draftAttempt = 0;
    let releaseDraftResponse!: () => void;
    const draftResponseGate = new Promise<void>((resolveDraft) => {
      releaseDraftResponse = resolveDraft;
    });
    await page.route("**/api/v1/publications", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      draftAttempt += 1;
      draftWrites.push(
        route.request().postDataJSON() as {
          workspace_id?: string;
          source_text?: string;
        },
      );
      if (draftAttempt === 1) {
        await draftResponseGate;
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          json: {
            title: "Draft unavailable",
            status: 503,
            detail: "Temporary save failure",
          },
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "workspace-switch-publication",
          workspace_id: route.request().postDataJSON()?.workspace_id,
          revision: 1,
          title: "",
          content_profile: "short_text",
          source_text: route.request().postDataJSON()?.source_text ?? "",
          status: "draft",
          renditions: [],
        },
      });
    });

    await page.goto("/");
    const composer = page.getByTestId("text-thread-composer-shell");
    const textarea = composer.getByRole("textbox", { name: "Post text" });
    await expect(textarea).toBeVisible();
    const workspaceButton = page
      .getByRole("button", { name: new RegExp(`${first.name}|${second.name}`) })
      .first();
    await expect(workspaceButton).toContainText(first.name);

    await textarea.fill("Keep this exact draft");
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();
    const switchDialog = page.getByTestId("composer-workspace-switch-dialog");
    await expect(switchDialog).toBeVisible();
    await expect(switchDialog).toContainText(second.name);
    await switchDialog.getByRole("button", { name: "Stay here" }).click();
    await expect(switchDialog).toBeHidden();
    await expect(workspaceButton).toContainText(first.name);
    await expectPostText(textarea, "Keep this exact draft");
    await textarea.fill("Keep this exact draft after staying");

    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();
    await switchDialog.getByRole("button", { name: "Save draft" }).click();
    releaseDraftResponse();
    await expect(switchDialog).toBeVisible();
    await expect(switchDialog.getByRole("alert")).toContainText("Temporary save failure");
    await expect(workspaceButton).toContainText(first.name);
    await expectPostText(textarea, "Keep this exact draft after staying");
    await switchDialog.getByRole("button", { name: "Save draft" }).click();
    await expect(switchDialog).toBeHidden();
    await expect(workspaceButton).toContainText(second.name);
    await expectPostText(textarea, "");
    expect(draftWrites).toHaveLength(2);
    for (const draftWrite of draftWrites) {
      expect(draftWrite).toEqual(
        expect.objectContaining({
          workspace_id: first.id,
          source_text: "Keep this exact draft after staying",
        }),
      );
    }
    await expect(page).toHaveURL(/\/$/);

    await textarea.fill("Discard only after confirmation");
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(first.name) }).click();
    await expect(switchDialog).toBeVisible();
    await switchDialog.getByRole("button", { name: "Discard and switch" }).click();
    await expect(switchDialog).toBeHidden();
    await expect(workspaceButton).toContainText(first.name);
    await expectPostText(textarea, "");
    expect(draftWrites).toHaveLength(2);
  });

  // Regression: switching workspaces while the previous workspace has an
  // in-flight request must keep the newly selected workspace's account data.
  test("a slow previous-workspace response cannot replace current account data", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `workspace-race-${unique}@example.com`);
    const first = (await createWorkspace(request, auth.token, `Slow ${unique}`)) as {
      id: string;
      name: string;
    };
    const second = (await createWorkspace(request, auth.token, `Fast ${unique}`)) as {
      id: string;
      name: string;
    };

    await authenticatePage(page, auth.token);
    await page.addInitScript((workspace) => {
      localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
    }, first);
    let releaseSlowResponse = () => {};
    const slowResponseGate = new Promise<void>((resolve) => {
      releaseSlowResponse = resolve;
    });
    let slowRequestStarted = false;
    let markSlowRequestFinished = () => {};
    const slowRequestFinished = new Promise<void>((resolve) => {
      markSlowRequestFinished = resolve;
    });
    await page.route("**/api/v1/accounts?**", async (route) => {
      const workspaceId = new URL(route.request().url()).searchParams.get("workspace_id");
      if (workspaceId === first.id) {
        slowRequestStarted = true;
        await slowResponseGate;
      }
      const isCurrent = workspaceId === second.id;
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: isCurrent ? "fast-account" : "slow-account",
            workspace_id: workspaceId,
            platform: "bluesky",
            account_id: isCurrent ? "did:plc:fast" : "did:plc:slow",
            account_username: isCurrent ? "fast_current" : "slow_previous",
            is_active: true,
          },
        ],
      });
      if (workspaceId === first.id) markSlowRequestFinished();
    });

    await page.goto("/settings?tab=accounts");
    const workspaceButton = page.getByRole("button", { name: new RegExp(first.name) }).first();
    await expect(workspaceButton).toBeVisible();
    await expect.poll(() => slowRequestStarted).toBe(true);
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();

    await expect(page.getByText("@fast_current")).toBeVisible();
    releaseSlowResponse();
    await slowRequestFinished;
    await expect(page.getByText("@fast_current")).toBeVisible();
    await expect(page.getByText("@slow_previous")).toHaveCount(0);
  });
});

test.describe("locale", () => {
  test.use({ locale: "ru-RU" });

  test("a fresh Russian browser selects Russian", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Войти", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  });

  test("a saved language takes precedence over the browser language", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en", url: baseURL! }]);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign In", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("Russian login recovery fits a narrow phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.route("**/api/v1/auth/config", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await page.goto("/login");
    await expect(page.getByRole("status")).toContainText(
      "Не удалось загрузить настройки аккаунта.",
      {
        timeout: 30_000,
      },
    );
    await expect(page.getByRole("status").getByRole("button")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
});

test.describe("query settings navigation", () => {
  test(`organization settings settles after cached navigation at 1280px light`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `query-settings-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Query settings");
    await authenticatePage(page, auth.token);
    await page.goto("/settings?tab=profile");
    test.skip(
      (await page.locator('meta[name="openpost-edition"][content="cloud"]').count()) === 0,
      "Plan & usage is hosted-only",
    );
    await expect(page.getByTestId("settings-navigation")).toBeVisible();
    await page.getByRole("link", { name: "Organization", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Plan & usage", exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    for (const [tab, label] of [
      ["accounts", "Social accounts"],
      ["audit", "Organization audit"],
      ["ownership", "Ownership"],
      ["plan", "Plan & usage"],
    ]) {
      {
        const group = tab === "accounts" ? "Workspace" : "Organization";
        await page.getByRole("link", { name: group, exact: true }).click();
        await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
          "aria-busy",
          "false",
        );
        await page.locator(`[data-settings-tab="${tab}"]`).click();
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
});

test.describe("input feedback", () => {
  test("password errors appear at the field on keyboard submission and focus the first invalid field", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/reset-password#token=local-invalid-preview-token");
    const password = page.locator("#new-password");
    const confirmation = page.locator("#confirm-password");
    await expect(password).toBeVisible({ timeout: 30000 });
    await expect(password).toHaveAttribute("aria-invalid", "false");
    await password.fill("short");
    await password.press("Enter");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toBeFocused();
    await expect(page.locator("#new-password-feedback")).toContainText("12");
    await password.fill("a-long-local-test-password");
    await confirmation.fill("different-local-test-password");
    await confirmation.press("Enter");
    await expect(confirmation).toHaveAttribute("aria-invalid", "true");
    await expect(confirmation).toBeFocused();
    await expect(page.locator("#confirm-password-feedback")).toContainText("match");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    expect(errors).toEqual([]);
  });
});

test.describe("download feedback", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) document.documentElement.dataset.requestedDownload = this.download;
      };
    });
  });

  test("Image Editor distinguishes an export request from browser file delivery", async ({
    page,
  }) => {
    await page.goto("/image-editor");
    await page.getByRole("button", { name: /Instagram square/ }).click();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Export design" })
      .getByRole("button", { name: "Download", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-requested-download", /\.png$/);
    await expect(page.getByText("Export download started.", { exact: true }).first()).toBeVisible({
      timeout: 2000,
    });
  });

  test("Quick Cut describes frame download requests after real video decoding", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `cut-download-${Date.now()}@example.com`);
    await createWorkspace(request, auth.token, "Quick Cut downloads");
    await authenticatePage(page, auth.token);
    await page.addInitScript(() =>
      Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
    );
    await page.goto("/quick-cut");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open videos", exact: true }).click();
    await (await chooser).setFiles("tests/app/fixtures/product-screenshots/study-sos-demo.mp4");
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Capture current frame", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-requested-download", /\.png$/);
    const file = await page.locator("html").getAttribute("data-requested-download");
    await expect(
      page.getByText(`Download started for ${file}.`, { exact: true }).first(),
    ).toBeVisible({ timeout: 2000 });
  });

  test("Video Editor distinguishes verified project media from its frame download request", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `video-download-${Date.now()}@example.com`);
    await createWorkspace(request, auth.token, "Video frame downloads");
    await authenticatePage(page, auth.token);
    await page.goto("/video-editor");
    await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
    await page
      .locator("[data-video-transport]")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Save current frame", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-requested-download", /\.png$/);
    const file = await page.locator("html").getAttribute("data-requested-download");
    await page.locator("[data-project-details]").click();
    await expect(page.locator("[data-project-summary]")).toContainText(/(?:1 media|Media: 1)/);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-project-summary]")).toHaveCount(0);
    await expect(
      page.getByText(`Saved ${file} to project media. Download started.`, { exact: true }).first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("diagnostics isolation", () => {
  test("browser test servers disable external diagnostics", async ({ request }) => {
    const response = await request.get("/api/v1/diagnostics/public-config");
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ enabled: false });
  });
});

test.describe("dither polish", () => {
  // Keep the visual sweep on network assets. PWA lifecycle has its own browser suite.
  test.use({ serviceWorkers: "block" });

  test.describe("touch theme controls", () => {
    test.use({ hasTouch: true });
    test("custom Dither colors survive undo, publish, assignment, and reload", async ({
      page,
      request,
    }) => {
      test.setTimeout(90_000);
      const { token } = await registerUser(request, `dither-accent-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, token, "Custom Dither");
      const created = await request.post("/api/v1/themes", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          organization_id: workspace.organization_id,
          name: "Dither violet",
          duplicate_built_in_id: "dither",
        },
      });
      expect(created.ok()).toBe(true);
      await authenticatePage(page, token);
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto("/settings?tab=appearance");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const hue = page.getByRole("spinbutton", {
        name: "Accent hue",
        exact: true,
      });
      await expect(hue).toHaveValue("45");
      await hue.fill("305");
      await expect(page.getByRole("slider", { name: "Accent hue" })).toHaveAttribute(
        "aria-valuenow",
        "305",
      );
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(hue).toHaveValue("45");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(hue).toHaveValue("305");
      await page.getByRole("button", { name: "Choose Canvas color", exact: true }).click();
      const hex = page.getByRole("textbox", { name: "Hex color", exact: true });
      await hex.fill("#faf9fc");
      await hex.press("Enter");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("textbox", { name: "Canvas", exact: true })).toHaveValue(
        "#faf9fc",
      );
      const saved = page.waitForResponse(
        (response) => response.url().endsWith("/draft") && response.request().method() === "PUT",
      );
      const published = page.waitForResponse(
        (response) => response.url().endsWith("/publish") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      const savedResponse = await saved;
      expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
      expect((await published).ok()).toBe(true);
      await expect(page.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Apply Dither violet", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Applied Dither violet", exact: true }),
      ).toBeVisible();
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
        await expect
          .poll(() =>
            page.locator("html").evaluate((el) => el.style.getPropertyValue("--action-focal")),
          )
          .toContain("305");
      }
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(hue).toHaveValue("305");
      await page.setViewportSize({ width: 1440, height: 960 });
      await expect(page.locator('iframe[aria-busy="true"]')).toHaveCount(0);
      await expect(page.getByTestId("theme-preview")).toHaveCSS("opacity", "1");
      await page
        .getByRole("region", { name: "Accent hue", exact: true })
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      for (const control of [
        hue,
        page.getByRole("slider", { name: "Accent hue" }),
        page.getByRole("button", { name: "Choose Canvas color", exact: true }),
      ]) {
        const box = await control.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole("button", { name: "Choose Canvas color", exact: true }).click();
      await expect(hex).toBeVisible();
      await page.keyboard.press("Escape");
    });
  });
});
