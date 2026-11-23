import { randomUUID } from "node:crypto";
import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser, expectPostText } from "./helpers";
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
});

test.describe("chunk recovery navigation", () => {
  test.use({ serviceWorkers: "block" });

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
});

test.describe("locale", () => {
  test.use({ locale: "ru-RU" });

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
});

test.describe("diagnostics isolation", () => {
  test("browser test servers disable external diagnostics", async ({ request }) => {
    const response = await request.get("/api/v1/diagnostics/public-config");
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ enabled: false });
  });
});
