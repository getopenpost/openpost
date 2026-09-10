import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("publications keeps the main workflow clear across list, search, and calendar", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `publications-ux-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Publication workspace");
  const created = await createPublication(
    request,
    auth.token,
    workspace.id,
    "A clear launch note for the publication workspace",
  );
  await authenticatePage(page, auth.token);

  await page.goto("/publications?tab=drafts");
  await expect(page.getByRole("heading", { name: "Publications" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search posts" })).toBeVisible();
  const selectedTab = page.getByRole("tab", { name: "Drafts", exact: true });
  await expect(selectedTab).toHaveCSS("border-radius", "0px");
  await expect(selectedTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("publication-list")).toContainText("A clear launch note");

  for (const [width, scheme] of [
    [1440, "light"],
    [390, "dark"],
    [320, "light"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.impeccable/review/dither-migration/publications-${width}-${scheme}.png`,
      fullPage: true,
    });
  }

  await page.getByRole("textbox", { name: "Search posts" }).fill("does not exist");
  await expect(page.getByTestId("publication-list")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search posts" }).fill("launch note");
  await expect(page.getByTestId("publication-list")).toContainText("A clear launch note");

  await page.getByRole("button", { name: /Edit A clear launch note/ }).click();
  await expect(page).toHaveURL(new RegExp(`/publications/${created.id}$`));

  await page.goto("/publications?tab=drafts");
  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("heading", { name: "Publications" })).toBeVisible();
  for (const [width, scheme] of [
    [1440, "light"],
    [390, "dark"],
    [320, "light"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.impeccable/review/dither-migration/calendar-${width}-${scheme}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "List" }).click();
  await expect(page).toHaveURL(/\/publications(?:\?.*)?$/);
  await expect(page.getByRole("tab", { name: "Drafts" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Published", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Published", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "View all", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Drafts", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("publication delivery details keep distinct targets for the same account", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `publication-targets-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Multiple targets");
  const publication = await createPublication(
    request,
    auth.token,
    workspace.id,
    "One account, two destinations",
  );
  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/publications?**", async (route) => {
    const response = await route.fetch();
    const publications = await response.json();
    await route.fulfill({
      response,
      json: publications.map((item: { id: string }) =>
        item.id === publication.id
          ? {
              ...item,
              renditions: ["first-channel", "second-channel"].map((target, index) => ({
                id: `rendition-${index}`,
                social_account_id: "same-account",
                platform: "telegram",
                target_key: target,
                status: "draft",
                segments: [],
                metadata: {},
              })),
            }
          : item,
      ),
    });
  });
  await page.goto("/publications?tab=drafts");
  const list = page.getByTestId("publication-list");
  await expect(list).toContainText("One account, two destinations");
  await list.locator("summary").click();
  await expect(list.getByText("Target first-channel", { exact: true })).toBeVisible();
  await expect(list.getByText("Target second-channel", { exact: true })).toBeVisible();
});
