import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("navigation separates work, workspace management, and personal preferences", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `navigation-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Navigation workspace");
  await authenticatePage(page, auth.token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/publications");
  const workNavigation = page.getByTestId("sidebar-workspace-navigation");
  for (const name of ["Posts", "Inbox", "Analytics", "Media"]) {
    await expect(workNavigation.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId("sidebar-new-post-menu")).toHaveAccessibleName("Editors");
  await page.screenshot({ path: testInfo.outputPath("navigation-before.png") });
  await page.getByTestId("sidebar-new-post-menu").click();
  await expect(page.getByRole("menuitem", { name: "New image", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "New video", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("creation-menu.png") });
  await page.keyboard.press("Escape");
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Profile & security", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("menuitem", { name: "Preferences", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Send feedback", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Help & feedback", exact: true })).toBeVisible();
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
  await expect(page).toHaveURL(/settings\?tab=accounts/);
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
  const collapse = page.getByRole("button", { name: "Toggle sidebar", exact: true });
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

for (const width of [1440, 1280, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`navigation and preferences fit at ${width}px in ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      const auth = await registerUser(request, `nav-${width}-${randomUUID()}@example.com`);
      await createWorkspace(request, auth.token, "Navigation workspace");
      await authenticatePage(page, auth.token);
      await page.setViewportSize({ width, height: width === 1280 ? 600 : 900 });
      await page.goto("/publications");
      if (width < 768) {
        await page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("button", { name: "More", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Profile", exact: true }).click();
      } else {
        await page.getByTestId("profile-menu-trigger").click();
      }
      await page.getByRole("menuitem", { name: "Preferences", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "Preferences",
        exact: true,
      });
      await dialog
        .getByRole("button", {
          name: scheme === "light" ? "Light" : "Dark",
          exact: true,
        })
        .click();
      await expect(dialog).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await expect(dialog).toHaveCSS("opacity", "1");
      await dialog.evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(accessibility.violations).toEqual([]);
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`preferences-${scheme}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      if (width >= 768) {
        const workNavigation = page.getByTestId("sidebar-workspace-navigation");
        for (const name of ["Posts", "Inbox", "Analytics", "Media"]) {
          await expect(workNavigation.getByRole("button", { name, exact: true })).toBeVisible();
        }
        const media = workNavigation.getByRole("button", { name: "Media", exact: true });
        await expect(media).toBeVisible();
        const idle = await media.evaluate((element) => getComputedStyle(element).backgroundColor);
        await media.hover();
        await expect
          .poll(() => media.evaluate((element) => getComputedStyle(element).backgroundColor))
          .not.toBe(idle);
        await media.focus();
        await expect(media).toBeFocused();
      }
      await page.screenshot({
        path: testInfo.outputPath(`navigation-${scheme}.png`),
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}

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
  await nav.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New image", exact: true }).click();
  await expect(page).toHaveURL(/\/image-editor$/);
});

for (const width of [390, 1440]) {
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
        : page.getByRole("button", { name: "Switch workspace: Keyboard workspace", exact: true });
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
}, testInfo) => {
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
  await page.goto("/");
  const planner = page.getByTestId("desktop-sidebar-planner");
  const viewAll = planner.getByRole("button", { name: "View all", exact: true });
  await expect(viewAll).toBeInViewport();
  const draft = planner.getByRole("link", {
    name: "Resume draft: A recent thought to resume",
    exact: true,
  });
  await expect(draft).toBeVisible();
  const draftBounds = await draft.boundingBox();
  const contentBounds = await page.locator('[data-sidebar="content"]').boundingBox();
  expect(draftBounds!.y).toBeGreaterThanOrEqual(contentBounds!.y);
  expect(draftBounds!.y + draftBounds!.height).toBeLessThanOrEqual(
    contentBounds!.y + contentBounds!.height,
  );
  await expect(page.getByTestId("sidebar-calendar-month")).toBeVisible();
  for (const name of ["Posts", "Inbox", "Analytics", "Media"])
    await expect(
      page.getByTestId("sidebar-workspace-navigation").getByRole("button", { name, exact: true }),
    ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("short-draft-resume.png"),
    animations: "disabled",
  });
  await viewAll.click();
  await expect(page).toHaveURL(/publications\?tab=drafts$/);
  await expect(page.getByTestId("publication-list")).toBeVisible();
  await expect(planner).toBeVisible();
});

test("sidebar calendar is optional and remembers its visibility", async ({
  page,
  request,
  browser,
}, info) => {
  const auth = await registerUser(request, `sidebar-calendar-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Calendar preference");
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/publications?tab=drafts");
  const calendar = page.getByTestId("sidebar-rolling-calendar");
  await expect(calendar).toBeVisible();
  const openPreferences = async () => {
    await page.getByTestId("profile-menu-trigger").click();
    await page.getByRole("menuitem", { name: "Preferences", exact: true }).click();
  };
  await openPreferences();
  const toggle = page.getByRole("checkbox", { name: "Sidebar calendar", exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await page.reload();
  await expect(calendar).toHaveCount(0);
  await openPreferences();
  await toggle.check();
  await page.keyboard.press("Escape");
  await expect(calendar).toBeVisible();
  await page.reload();
  await expect(calendar).toBeVisible();
  const touch = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1440, height: 900 },
    storageState: await page.context().storageState(),
  });
  try {
    const touchPage = await touch.newPage();
    await touchPage.goto(page.url());
    await expect(touchPage.getByTestId("sidebar-rolling-calendar")).toBeHidden();
    const shortcut = touchPage
      .getByRole("region", { name: "Calendar", exact: true })
      .getByRole("link", { name: "Calendar", exact: true });
    await expect(shortcut).toBeVisible();
    expect((await shortcut.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shortcut.click();
    await expect(touchPage).toHaveURL(/\/calendar$/);
  } finally {
    await touch.close();
  }
  for (const width of [1440, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      if (width === 1440) await expect(calendar).toBeVisible();
      else await expect(calendar).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.screenshot({
        path: info.outputPath(`sidebar-calendar-${width}-${scheme}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 600 });
  for (const name of ["Posts", "Inbox", "Analytics", "Media"])
    await expect(
      page.getByTestId("sidebar-workspace-navigation").getByRole("button", { name, exact: true }),
    ).toBeInViewport();
  const today = calendar.locator('button[aria-current="date"]');
  await today.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await openPreferences();
  await toggle.uncheck();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await page.reload();
  await expect(calendar).toHaveCount(0);
});

for (const calendar of [true, false]) {
  test(`drafts fill the sidebar on every workspace page with calendar ${calendar}`, async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `nav-drafts-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Draft navigation");
    for (let index = 1; index <= 12; index++) {
      await createPublication(request, auth.token, workspace.id, `Sidebar draft ${index}`);
    }
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/publications");
    await expect(page.getByTestId("sidebar-draft-list").getByRole("link")).toHaveCount(12);
    await page.getByTestId("profile-menu-trigger").click();
    await page.getByRole("menuitem", { name: "Preferences", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Preferences", exact: true });
    const preference = dialog.getByRole("checkbox", { name: "Sidebar calendar" });
    await expect(preference).toBeChecked();
    if (!calendar) await preference.click();
    await page.keyboard.press("Escape");
    await page.reload();
    const drafts = page.getByTestId("sidebar-draft-list");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of ["/", "/publications", "/inbox/engagement", "/analytics", "/media"]) {
      await page.goto(route);
      await expect(page.getByTestId("sidebar-rolling-calendar")).toHaveCount(calendar ? 1 : 0);
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
    await page.screenshot({ path: testInfo.outputPath(`sidebar-calendar-${calendar}.png`) });
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
}
