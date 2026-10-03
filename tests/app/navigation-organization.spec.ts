import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Profile & security", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("menuitem", { name: "Preferences", exact: true })).toBeVisible();
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
  await page.getByRole("menuitem", { name: "OpenPost Image Editor", exact: true }).click();
  await expect(page).toHaveURL(/\/image-editor$/);
});

test("mobile menu preserves a keyboard choice made during opening", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 900 });
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
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await nav.getByRole("button", { name: "More", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole("menuitem", { name: "Profile", exact: true })).toBeFocused();
});

test("short desktop planner keeps drafts reachable without scrolling the navigation", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `nav-short-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Short navigation workspace");
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/publications");
  const planner = page.getByTestId("desktop-sidebar-planner");
  const viewAll = planner.getByRole("button", { name: "View all", exact: true });
  const month = page.getByTestId("sidebar-calendar-month");
  await expect(month).toBeVisible();
  const monthBounds = await month.boundingBox();
  await page.mouse.move(monthBounds!.x + 5, monthBounds!.y + 5);
  await page.mouse.wheel(0, 350);
  await expect
    .poll(async () => {
      const control = await viewAll.boundingBox();
      const viewport = await page.locator('[data-sidebar="content"]').boundingBox();
      return (
        control !== null &&
        viewport !== null &&
        control.y >= viewport.y &&
        control.y + control.height <= viewport.y + viewport.height
      );
    })
    .toBe(true);
  for (const name of ["Posts", "Inbox", "Analytics", "Media"]) {
    await expect(
      page.getByTestId("sidebar-workspace-navigation").getByRole("button", { name, exact: true }),
    ).toBeInViewport();
  }
  await page.screenshot({
    path: testInfo.outputPath("short-planner-reachable.png"),
    animations: "disabled",
  });
  await viewAll.click();
  await expect(page).toHaveURL(/publications\?tab=drafts$/);
});
