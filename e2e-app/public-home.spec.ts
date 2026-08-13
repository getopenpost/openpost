import { expect, test } from "@playwright/test";

async function exposeManagedEdition(page: import("@playwright/test").Page) {
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "<head>",
      '<head><meta name="openpost-edition" content="cloud">',
    );
    await route.fulfill({ response, body });
  });
}

test("managed public home explains the product, pricing, and policies", async ({
  page,
}) => {
  await exposeManagedEdition(page);
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", {
      name: "Your content operation, together in one workspace.",
    }),
  ).toBeVisible();
  await expect(page.getByText("$15/month").first()).toBeVisible();
  await expect(page.getByText("$199/month")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Terms of service" }),
  ).toHaveAttribute("href", "https://openpost.social/terms");
  await expect(
    page.getByRole("link", { name: "Privacy policy" }),
  ).toHaveAttribute("href", "https://openpost.social/privacy");
  await expect(
    page.getByRole("link", { name: "Refund policy" }),
  ).toHaveAttribute("href", "https://openpost.social/refunds");
});

test("managed public home remains usable at 320px", async ({ page }) => {
  await exposeManagedEdition(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Your content operation, together in one workspace.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});
