import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const missingPath = "/route-that-openpost-does-not-have";

function isExpectedMissingRouteError(
  message: string,
  locationURL = "",
): boolean {
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

test("unknown documents return 404 with a complete recovery page", async ({
  page,
  request,
}) => {
  const errors = captureBrowserErrors(page);
  const response = await page.goto(missingPath);

  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("app-error-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await expect(page.getByText("HTTP 404")).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenPost home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New post" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Posts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Media" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Documentation" }),
  ).toHaveAttribute("href", "https://docs.openpost.social/usage/");
  await expect(
    page.getByRole("link", { name: "Contact support" }),
  ).toHaveAttribute("href", "mailto:openpost@rgo.pt");

  expect((await request.get("/publications/example")).status()).toBe(200);
  expect((await request.get("/calendar-export")).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("client navigation and a 320px viewport preserve the same recovery path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const errors = captureBrowserErrors(page);
  await page.goto("/login");
  await page.evaluate((target) => {
    const link = document.createElement("a");
    link.href = target;
    link.textContent = "Open missing route";
    link.dataset.testid = "client-missing-route";
    document.body.append(link);
  }, missingPath);
  await page.getByTestId("client-missing-route").click();

  await expect(page).toHaveURL(new RegExp(`${missingPath}$`));
  await expect(page.getByTestId("app-error-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
