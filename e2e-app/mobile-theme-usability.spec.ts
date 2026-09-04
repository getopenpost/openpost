import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const screenshotDirectory = "/tmp/mobile-theme-usability";

test.beforeAll(async () => {
  const { mkdir, rm } = await import("node:fs/promises");
  await rm(screenshotDirectory, { force: true, recursive: true });
  await mkdir(screenshotDirectory, { recursive: true });
});

async function login(request: APIRequestContext, page: Page) {
  const { token } = await registerUser(request, "mobile-theme-usability@example.com");
  await createWorkspace(request, token, "Mobile theme usability");
  await authenticatePage(page, token);
}

test("phone theme testing, assignment, appearance, and chrome stay usable", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(request, page);
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("heading", { name: "Appearance" }).first()).toBeVisible();

  const midnightCard = page.locator('[data-theme-library-card="midnight"]');
  await midnightCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshotDirectory}/theme-card-actions.png` });
  await midnightCard.getByRole("button", { name: "Test", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);
  await expect
    .poll(() =>
      page
        .getByTestId("theme-preview")
        .evaluate((frame) => frame.contentDocument?.documentElement.getAttribute("data-theme-id")),
    )
    .toBe("midnight");

  await midnightCard.scrollIntoViewIfNeeded();
  await midnightCard.getByRole("button", { name: "Apply Midnight", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme-id")))
    .toBe("midnight");

  const navigation = page.locator('[data-slot="mobile-bottom-nav"]');
  const newAction = navigation.getByRole("button", { name: "New" });
  await expect(newAction).toBeVisible();
  expect((await newAction.textContent())?.trim()).toBe("");

  await navigation.getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  const menuBackground = await menu.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(menuBackground).not.toMatch(/\/\s*(?:0\.\d+|\d+%)\s*\)?$/);

  await menu.getByRole("menuitem", { name: /Appearance/ }).click();
  const darkOption = page.getByRole("menuitem", { name: "Dark", exact: true });
  await expect(darkOption).toBeVisible();
  const optionBounds = await darkOption.boundingBox();
  expect(optionBounds).not.toBeNull();
  expect(optionBounds!.x).toBeGreaterThanOrEqual(0);
  expect(optionBounds!.x + optionBounds!.width).toBeLessThanOrEqual(390);

  await page.screenshot({ path: `${screenshotDirectory}/appearance-menu-dark.png` });

  await menu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(menu.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/more-menu-scrolled.png` });

  await page.goto("/publications");
  const pageGap = await page
    .locator('[data-slot="page-container"]')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).gap));
  expect(pageGap).toBeLessThanOrEqual(32);
  await page.screenshot({ path: `${screenshotDirectory}/publications-dark.png` });
});
