import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("authenticated navigation keeps the app shell mounted", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `app-shell-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Persistent Shell E2E");
  await authenticatePage(page, auth.token);
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await page.getByTestId("profile-menu-trigger").click();
  await expect(
    page.getByRole("menuitem", { name: "Watch product demo" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="app-sidebar"]');
    if (!shell) throw new Error("App sidebar was not mounted");
    (
      window as Window & { __openpostShellRemoved?: boolean }
    ).__openpostShellRemoved = false;
    new MutationObserver(() => {
      if (!shell.isConnected) {
        (
          window as Window & { __openpostShellRemoved?: boolean }
        ).__openpostShellRemoved = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page.getByRole("button", { name: "Posts", exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("sidebar-new-post")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __openpostShellRemoved?: boolean })
            .__openpostShellRemoved ?? false,
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
  const content = "Keep this draft attached to its own URL.";
  const link = "https://example.com/openpost-draft";

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Draft URL E2E");
  await authenticatePage(page, auth.token);
  await page.goto("/");

  const sidebarHeader = page.getByTestId("app-sidebar");
  const homeBrand = sidebarHeader.locator('a[aria-label="OpenPost home"]');
  const newPostAction = sidebarHeader.locator('a[aria-label="New post"]');

  await expect(page.getByTestId("sidebar-home-brand")).toBeVisible();
  await expect(page.getByTestId("sidebar-new-post")).toHaveCount(0);
  await expect(homeBrand).toHaveAttribute("data-swap-position", "active");
  await expect(newPostAction).toHaveAttribute("data-swap-position", "after");
  await expect(newPostAction).toHaveAttribute("inert", "");
  await expect(homeBrand).toHaveCSS("transition-duration", "0.26s, 0.2s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      homeBrand.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).transitionDuration),
      ),
    )
    .toBeLessThanOrEqual(0.001);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.getByRole("button", { name: "Link URL", exact: true }).click();
  await page.getByRole("textbox", { name: "Link URL", exact: true }).fill(link);
  await page.getByLabel("Post text").fill(content);
  await expect(page).toHaveURL(/\/posts\/[a-zA-Z0-9-]+$/, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("composer-save-indicator")).toHaveAttribute(
    "data-state",
    "saved",
  );
  await expect(page.getByTestId("composer-context-status")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-new-post")).toBeVisible();
  await expect(homeBrand).toHaveAttribute("data-swap-position", "before");
  await expect(homeBrand).toHaveAttribute("inert", "");
  await expect(newPostAction).toHaveAttribute("data-swap-position", "active");
  await expect(newPostAction).not.toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", { name: "Schedule", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Editing draft post")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Post text")).toHaveValue(content);
  await expect(
    page.getByRole("textbox", { name: "Link URL", exact: true }),
  ).toHaveValue(link);
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Schedule", exact: true }).first(),
  ).toBeVisible();

  const textPostId = new URL(page.url()).pathname.split("/").pop();
  expect(textPostId).toBeTruthy();
  const postDetail = await request.get(`/api/v1/posts/${textPostId}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(postDetail.ok()).toBeTruthy();
  const postDetailBody = (await postDetail.json()) as {
    publication_id: string;
  };
  expect(postDetailBody.publication_id).toBeTruthy();

  await page.goto(`/publications/${postDetailBody.publication_id}`);
  await expect(page).toHaveURL(new RegExp(`/posts/${textPostId}$`));
  await expect(page.getByLabel("Post text")).toHaveValue(content);
  await expect(
    page.getByRole("textbox", { name: "Link URL", exact: true }),
  ).toHaveValue(link);
  await expect(page.getByTestId("focused-composer")).toHaveCount(0);
  await expect(
    page.getByTestId("sidebar-draft-list").locator("li"),
  ).toHaveCount(1);
});

test("text-and-thread editor keeps its canvas-owned field treatment", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `composer-chrome-${unique}@example.com`;
  const longContent = Array.from(
    { length: 18 },
    (_, index) =>
      `Paragraph ${index + 1} stays visible in the expanding editor.`,
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
    await expect(page.locator("html")).toHaveClass(
      mode === "dark" ? /dark/ : /^(?!.*\bdark\b)/,
    );

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
    const focusedShadow = await editor.evaluate(
      (element) => getComputedStyle(element).boxShadow,
    );
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
    expect(editorMetrics.clientHeight).toBeGreaterThanOrEqual(
      editorMetrics.scrollHeight,
    );
  }
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
  await expect(
    page.getByRole("button", { name: "Posts", exact: true }),
  ).toBeVisible();
});

test("desktop planning sidebar resumes drafts and stays out of mobile navigation", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `sidebar-planner-${unique}@example.com`;
  const auth = await registerUser(request, email);
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Planning Sidebar E2E",
  )) as { id: string };
  const draft = await request.post("/api/v1/posts", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      workspace_id: workspace.id,
      content: "Resume the launch announcement",
      social_account_ids: [],
      media_ids: [],
    },
  });
  expect(draft.ok()).toBeTruthy();
  const draftBody = (await draft.json()) as { id: string };
  for (let index = 2; index <= 8; index += 1) {
    const extraDraft = await request.post("/api/v1/posts", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        workspace_id: workspace.id,
        content: `Sidebar draft ${index}`,
        social_account_ids: [],
        media_ids: [],
      },
    });
    expect(extraDraft.ok()).toBeTruthy();
  }

  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 720 });
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
  await expect(rollingCalendar.locator("button:focus")).not.toHaveAttribute(
    "aria-current",
    "date",
  );
  await expect(
    rollingCalendar.getByRole("button", { disabled: true }),
  ).not.toHaveCount(0);
  const initialCalendarRows = await rollingCalendar
    .locator('[role="row"]')
    .count();
  const initialCalendarMetrics = await rollingCalendar.evaluate((element) => ({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
  }));
  expect(initialCalendarMetrics.scrollTop).toBe(0);
  expect(initialCalendarMetrics.scrollHeight).toBeGreaterThan(
    initialCalendarMetrics.clientHeight,
  );
  expect(initialCalendarMetrics.scrollbarWidth).toBe("thin");
  await rollingCalendar.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => rollingCalendar.locator('[role="row"]').count())
    .toBeGreaterThan(initialCalendarRows);
  const weekdayHeader = rollingCalendar.getByTestId(
    "sidebar-calendar-weekdays",
  );
  const [calendarBox, weekdayHeaderBox, weekdayHeaderBackground] =
    await Promise.all([
      rollingCalendar.boundingBox(),
      weekdayHeader.boundingBox(),
      weekdayHeader.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ]);
  expect(calendarBox).not.toBeNull();
  expect(weekdayHeaderBox).not.toBeNull();
  expect(weekdayHeaderBox!.y).toBeCloseTo(calendarBox!.y, 0);
  expect(weekdayHeaderBackground).not.toBe("rgba(0, 0, 0, 0)");
  await expect(calendarMonth).not.toHaveText(initialCalendarMonth!);
  await rollingCalendar.evaluate((element) => {
    element.scrollTop = -100;
  });
  await expect
    .poll(() => rollingCalendar.evaluate((element) => element.scrollTop))
    .toBe(0);
  await expect(page.getByText("Resume the launch announcement")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Media", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  const draftList = page.getByTestId("sidebar-draft-list");
  await expect(draftList.locator("li")).toHaveCount(8);
  const draftListMetrics = await draftList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(draftListMetrics.scrollHeight).toBeGreaterThan(
    draftListMetrics.clientHeight,
  );
  const draftListBox = await draftList.boundingBox();
  const workspaceFooterBox = await page
    .getByTestId("sidebar-workspace-footer")
    .boundingBox();
  expect(draftListBox).not.toBeNull();
  expect(workspaceFooterBox).not.toBeNull();
  expect(
    workspaceFooterBox!.y - (draftListBox!.y + draftListBox!.height),
  ).toBeLessThanOrEqual(32);
  await draftList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(draftList.locator("li").last()).toBeVisible();

  const draftToDelete = page.getByRole("button", {
    name: "Resume draft: Sidebar draft 2",
  });
  await draftToDelete.scrollIntoViewIfNeeded();
  const draftDocumentIcons = draftList.locator(".lucide-file-text");
  const draftDocumentColors = await draftDocumentIcons.evaluateAll((icons) =>
    icons.map((icon) => getComputedStyle(icon).color),
  );
  await planner.getByRole("button", { name: "View all" }).hover();
  await expect(
    draftList.getByRole("button", { name: /^Delete draft:/ }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      draftDocumentIcons.evaluateAll((icons) =>
        icons.map((icon) => getComputedStyle(icon).color),
      ),
    )
    .toEqual(draftDocumentColors);

  await draftToDelete.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Resume draft", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Resume draft:/ }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("Delete this draft?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(draftList.locator("li")).toHaveCount(7);

  await page
    .getByRole("button", {
      name: "Resume draft: Resume the launch announcement",
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/posts/${draftBody.id}$`));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(planner).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
});
