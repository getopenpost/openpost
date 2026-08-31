import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  composerDeliveryAction,
  createPublication,
  createWorkspace,
  registerUser,
} from "./helpers";

test("authenticated navigation keeps the app shell mounted", async ({ page, request }) => {
  const unique = Date.now().toString(36);
  const email = `app-shell-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Persistent Shell E2E");
  await authenticatePage(page, auth.token);
  const shellApiRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/")) {
      shellApiRequests.push(url.pathname);
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.waitForTimeout(250);
  expect(shellApiRequests.filter((path) => path === "/api/v1/notifications")).toHaveLength(1);

  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByRole("menuitem", { name: "Watch product demo" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="app-sidebar"]');
    if (!shell) throw new Error("App sidebar was not mounted");
    (window as Window & { __openpostShellRemoved?: boolean }).__openpostShellRemoved = false;
    new MutationObserver(() => {
      if (!shell.isConnected) {
        (window as Window & { __openpostShellRemoved?: boolean }).__openpostShellRemoved = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  const activityRequestStart = shellApiRequests.length;
  await page.getByRole("button", { name: "Publications", exact: true }).click();
  await expect(page).toHaveURL(/\/publications$/);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("desktop-sidebar-planner")).toBeVisible();
  await expect(page.getByTestId("sidebar-new-post")).toBeVisible();
  await page.waitForTimeout(250);
  const activityRequests = shellApiRequests.slice(activityRequestStart);
  expect(activityRequests.filter((path) => path === "/api/v1/publications")).toHaveLength(1);
  expect(activityRequests.filter((path) => path === "/api/v1/accounts")).toHaveLength(1);
  expect(activityRequests.filter((path) => path === "/api/v1/jobs")).toHaveLength(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __openpostShellRemoved?: boolean }).__openpostShellRemoved ?? false,
      ),
    )
    .toBe(false);

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("first autosave establishes the draft URL and keeps draft actions in one composer", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `composer-draft-${unique}@example.com`;
  const link = "https://example.com/openpost-draft";
  const content = `Keep this draft attached to its own URL: ${link}`;

  const auth = await registerUser(request, email);
  const workspace = (await createWorkspace(request, auth.token, "Draft URL E2E")) as { id: string };
  await authenticatePage(page, auth.token);
  await page.goto("/");

  const sidebarHeader = page.getByTestId("app-sidebar");
  const homeBrand = sidebarHeader.locator('a[aria-label="OpenPost home"]');
  const newPostAction = sidebarHeader.locator('a[aria-label="New post"]');

  await expect(page.getByTestId("sidebar-home-brand")).toBeVisible();
  await expect(page.getByTestId("sidebar-new-post")).toBeVisible();
  await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);
  await expect(homeBrand).toBeVisible();
  await expect(newPostAction).toBeVisible();
  await expect(page.getByTestId("sidebar-notifications")).toBeVisible();
  await expect(page.getByTestId("workspace-menu-trigger")).toBeVisible();

  await page.getByLabel("Post text").fill(content);
  await expect(page).toHaveURL(/\/publications\/[a-zA-Z0-9-]+$/, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("composer-save-indicator")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("composer-context-status")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-new-post")).toBeVisible();
  await expect(homeBrand).toBeVisible();
  await expect(newPostAction).toBeVisible();
  await expect(page.getByTestId("composer-primary-delivery-action")).toBeVisible();
  await expect(await composerDeliveryAction(page, "Schedule")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await expect(page.getByText("Editing draft post")).toHaveCount(0);

  const publicationId = new URL(page.url()).pathname.split("/").pop();
  expect(publicationId).toBeTruthy();
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "draft-navigation-account",
          workspace_id: workspace.id,
          platform: "bluesky",
          account_id: "did:plc:draft-navigation-account",
          account_username: "draft_navigation",
          is_active: true,
        },
      ],
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { accounts: [] },
    });
  });
  await page.reload();
  await expect(page.getByLabel("Post text")).toHaveValue(content);
  await expect(page.getByTestId("composer-account-control")).toBeVisible();
  await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Link URL" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("composer-primary-delivery-action")).toBeVisible();
  await expect(await composerDeliveryAction(page, "Schedule")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Post settings", exact: true }).click();
  const composerSettings = page.getByTestId("composer-settings-sheet");
  await expect(composerSettings).toBeVisible();
  await composerSettings.getByRole("button", { name: "Version history", exact: true }).click();
  const historyDrawer = page.getByTestId("publication-history-drawer");
  const historyScroll = page.getByTestId("publication-history-scroll");
  await expect(historyDrawer).toBeVisible();
  await expect(
    historyDrawer.getByRole("heading", {
      name: "Version history",
      exact: true,
    }),
  ).toBeVisible();
  const historySpacing = await historyScroll.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      overflowY: style.overflowY,
    };
  });
  expect(historySpacing).toEqual({
    paddingTop: "16px",
    paddingRight: "16px",
    paddingBottom: "16px",
    paddingLeft: "16px",
    overflowY: "auto",
  });
  await historyDrawer.getByRole("button", { name: "Close" }).click();
  await expect(historyDrawer).toBeHidden();

  await newPostAction.click();
  await expect(page).toHaveURL(/\/$/);
  await newPostAction.click();
  await expect(page.getByTestId("composer-account-control")).toBeVisible();
  await expect(page.getByTestId("composer-account-loading")).toHaveCount(0);

  const publicationDetail = await request.get(`/api/v1/publications/${publicationId}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(publicationDetail.ok()).toBeTruthy();
  const publicationDetailBody = (await publicationDetail.json()) as {
    id: string;
    source_url: string;
  };
  expect(publicationDetailBody.id).toBe(publicationId);
  expect(publicationDetailBody.source_url).toBe(link);

  const draftLoadRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/")) {
      draftLoadRequests.push(new URL(request.url()).pathname);
    }
  });
  await page.goto(`/publications/${publicationId}`);
  await expect(page).toHaveURL(new RegExp(`/publications/${publicationId}$`));
  await expect(page.getByLabel("Post text")).toHaveValue(content);
  await expect(page.getByRole("button", { name: "Link URL" })).toHaveCount(0);
  await expect(page.getByTestId("focused-composer")).toHaveCount(0);
  await expect(page.getByTestId("desktop-sidebar-planner")).toBeVisible();
  expect(
    draftLoadRequests.filter((path) => path === `/api/v1/publications/${publicationId}`),
  ).toHaveLength(1);
  expect(draftLoadRequests.filter((path) => path.startsWith("/api/v1/posts/"))).toHaveLength(0);
  expect(draftLoadRequests.filter((path) => path.endsWith("/variants"))).toHaveLength(0);
  await page.goto("/calendar");
  await expect(page.getByTestId("sidebar-draft-list").locator("li")).toHaveCount(1);
});

test("text-and-thread editor keeps its canvas-owned field treatment", async ({ page, request }) => {
  const unique = Date.now().toString(36);
  const email = `composer-chrome-${unique}@example.com`;
  const longContent = Array.from(
    { length: 18 },
    (_, index) => `Paragraph ${index + 1} stays visible in the expanding editor.`,
  ).join("\n\n");

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Composer Chrome E2E");
  await authenticatePage(page, auth.token);
  await page.goto("/");

  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((nextMode) => {
      localStorage.setItem("mode-watcher-mode", nextMode);
    }, mode);
    await page.reload();

    const editor = page.getByLabel("Post text").first();
    await expect(editor).toBeVisible();
    const restingChrome = await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        borderWidths: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ],
      };
    });
    expect(restingChrome).toEqual({
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderRadius: "0px",
      borderWidths: ["0px", "0px", "0px", "0px"],
    });

    await editor.focus();
    const focusedShadow = await editor.evaluate((element) => getComputedStyle(element).boxShadow);
    expect(focusedShadow).not.toMatch(/\b[1-9]\d*(?:\.\d+)?px\b/);

    await editor.fill(longContent);
    await expect
      .poll(() =>
        editor.evaluate((element) => ({
          overflowY: getComputedStyle(element).overflowY,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        })),
      )
      .toMatchObject({
        overflowY: "hidden",
        clientHeight: expect.any(Number),
        scrollHeight: expect.any(Number),
      });
    const editorMetrics = await editor.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(editorMetrics.clientHeight).toBeGreaterThanOrEqual(editorMetrics.scrollHeight);
  }
});

test("thread remove buttons stay above the textareas and delete the selected segment", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `thread-remove-${unique}@example.com`);
  await createWorkspace(request, auth.token, "Thread Remove E2E");
  await authenticatePage(page, auth.token);
  await page.goto("/");

  await page.getByRole("button", { name: "Add post", exact: true }).click();
  const removeButtons = page.getByRole("button", {
    name: "Remove post",
    exact: true,
  });
  await expect(removeButtons).toHaveCount(2);
  await removeButtons.last().click();

  await expect(page.getByLabel("Post text")).toHaveCount(1);
  await expect(removeButtons).toHaveCount(0);
});

test("collapsed sidebar keeps the OpenPost mark without overflowing text", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `sidebar-logo-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Sidebar Logo E2E");
  await authenticatePage(page, auth.token);
  await page.goto("/");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  const home = page.getByRole("link", { name: "OpenPost home" });
  await expect(home.locator("svg")).toBeVisible();
  await expect(home.getByText("OpenPost", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("desktop-sidebar-planner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publications", exact: true })).toBeVisible();
});

test("desktop planning sidebar resumes drafts and stays out of mobile navigation", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `sidebar-planner-${unique}@example.com`;
  const auth = await registerUser(request, email);
  const workspace = (await createWorkspace(request, auth.token, "Planning Sidebar E2E")) as {
    id: string;
  };
  const firstDraft = await createPublication(
    request,
    auth.token,
    workspace.id,
    "Resume the launch announcement",
  );
  for (let index = 2; index <= 6; index += 1) {
    await createPublication(request, auth.token, workspace.id, `Sidebar draft ${index}`);
  }

  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 720 });
  const publicationListRequests: URL[] = [];
  const calendarPublicationRequests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/publications" && url.searchParams.get("status") === "draft") {
      publicationListRequests.push(url);
    }
    if (url.pathname === "/api/v1/publications" && url.searchParams.has("calendar_from")) {
      calendarPublicationRequests.push(url);
    }
  });
  await page.goto("/");

  const planner = page.getByTestId("desktop-sidebar-planner");
  await expect(planner).toBeVisible();
  const rollingCalendar = planner.getByTestId("sidebar-rolling-calendar");
  await expect(rollingCalendar).toBeVisible();
  const calendarMonth = planner.getByTestId("sidebar-calendar-month");
  const initialCalendarMonth = await calendarMonth.textContent();
  expect(initialCalendarMonth?.trim()).toBeTruthy();
  const today = rollingCalendar.locator('[aria-current="date"]');
  await expect(today).toBeVisible();
  await today.focus();
  await today.press("ArrowRight");
  await expect(rollingCalendar.locator("button:focus")).not.toHaveAttribute("aria-current", "date");
  const pastDaysInWeek = await today.evaluate((element) => {
    const cell = element.closest('[role="gridcell"]');
    return cell?.parentElement ? Array.from(cell.parentElement.children).indexOf(cell) : 0;
  });
  await expect(rollingCalendar.getByRole("button", { disabled: true })).toHaveCount(pastDaysInWeek);
  const initialCalendarRows = await rollingCalendar.locator('[role="row"]').count();
  const initialCalendarMetrics = await rollingCalendar.evaluate((element) => ({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
  }));
  expect(initialCalendarMetrics.scrollTop).toBe(0);
  expect(initialCalendarMetrics.scrollHeight).toBeGreaterThan(initialCalendarMetrics.clientHeight);
  expect(initialCalendarMetrics.scrollbarWidth).toBe("thin");
  await rollingCalendar.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => rollingCalendar.locator('[role="row"]').count())
    .toBeGreaterThan(initialCalendarRows);
  const weekdayHeader = rollingCalendar.getByTestId("sidebar-calendar-weekdays");
  const [calendarBox, weekdayHeaderBox, weekdayHeaderBackground] = await Promise.all([
    rollingCalendar.boundingBox(),
    weekdayHeader.boundingBox(),
    weekdayHeader.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(calendarBox).not.toBeNull();
  expect(weekdayHeaderBox).not.toBeNull();
  expect(weekdayHeaderBox!.y).toBeCloseTo(calendarBox!.y, 0);
  expect(weekdayHeaderBackground).not.toBe("rgba(0, 0, 0, 0)");
  await expect(calendarMonth).not.toHaveText(initialCalendarMonth!);
  await rollingCalendar.evaluate((element) => {
    element.scrollTop = -100;
  });
  await expect.poll(() => rollingCalendar.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.getByText("Resume the launch announcement")).toBeVisible();
  await expect(page.getByRole("button", { name: "Media", exact: true })).toBeVisible();
  const workspaceNavigation = page.getByTestId("sidebar-workspace-navigation");
  await expect(workspaceNavigation.getByRole("button")).toHaveCount(7);
  await expect(
    workspaceNavigation.getByRole("button", {
      name: "Editors",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    workspaceNavigation.getByRole("button", {
      name: "Accounts",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    workspaceNavigation.getByRole("button", {
      name: "Settings",
      exact: true,
    }),
  ).toHaveCount(0);
  const navigationToggle = page.getByRole("button", {
    name: "Collapse workspace navigation",
  });
  await navigationToggle.click();
  await expect(workspaceNavigation).toHaveAttribute("aria-hidden", "true");
  await expect(workspaceNavigation.getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand workspace navigation" }).click();
  await expect(workspaceNavigation).toHaveAttribute("aria-hidden", "false");
  await expect(workspaceNavigation.getByRole("button")).toHaveCount(7);
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByRole("menuitem", { name: "Editors" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Administration", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const draftList = page.getByTestId("sidebar-draft-list");
  await expect(draftList.locator("li")).toHaveCount(6);
  await page.waitForTimeout(250);
  expect(publicationListRequests).toHaveLength(1);
  expect(publicationListRequests.map((url) => url.searchParams.get("status"))).toEqual(["draft"]);
  expect(publicationListRequests.map((url) => url.searchParams.get("limit"))).toEqual(["50"]);
  expect(calendarPublicationRequests.length).toBeGreaterThan(0);
  const draftListMetrics = await draftList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(draftListMetrics.scrollHeight).toBeGreaterThan(draftListMetrics.clientHeight);
  const draftListBox = await draftList.boundingBox();
  const workspaceFooterBox = await page.getByTestId("sidebar-workspace-footer").boundingBox();
  expect(draftListBox).not.toBeNull();
  expect(workspaceFooterBox).not.toBeNull();
  expect(workspaceFooterBox!.y - (draftListBox!.y + draftListBox!.height)).toBeLessThanOrEqual(1);
  await draftList.locator("li").last().scrollIntoViewIfNeeded();
  await expect(draftList.locator("li").last()).toBeVisible();

  const draftToDelete = page.getByRole("link", {
    name: "Resume draft: Sidebar draft 2",
  });
  await draftToDelete.scrollIntoViewIfNeeded();
  await planner.getByRole("button", { name: "View all" }).hover();
  await expect(draftList.getByRole("button", { name: /^Delete draft:/ })).toHaveCount(0);

  await draftToDelete.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Resume draft", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Resume draft:/ })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Delete this draft?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(draftList.locator("li")).toHaveCount(5);

  await page
    .getByRole("link", {
      name: "Resume draft: Resume the launch announcement",
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/publications/${encodeURIComponent(firstDraft.id)}$`));
  const activeDraft = page.getByRole("link", {
    name: "Resume draft: Resume the launch announcement",
  });
  await expect(activeDraft).toHaveAttribute("aria-current", "page");
  const [activeDraftBackground, inactiveDraftBackground] = await Promise.all([
    activeDraft.evaluate((element) => getComputedStyle(element).backgroundColor),
    page
      .getByRole("link", { name: "Resume draft: Sidebar draft 3" })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(activeDraftBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(activeDraftBackground).not.toBe(inactiveDraftBackground);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(planner).toHaveCount(0);
  const mobileNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(mobileNavigation).toBeVisible();
  for (const label of ["Calendar", "Publications", "New", "Media", "More"]) {
    const visibleLabel = mobileNavigation.getByText(label, { exact: true });
    await expect(visibleLabel).toBeVisible();
    await expect(visibleLabel).not.toHaveClass(/sr-only/);
  }
});
