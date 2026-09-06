import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "./accessibility";

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
  await expect(page.getByRole("link", { name: "Publications" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Media" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Documentation" })).toHaveAttribute(
    "href",
    "https://docs.openpo.st/usage/",
  );
  await expect(page.getByRole("link", { name: "Contact support" })).toHaveCount(0);

  const reload = await page.reload();
  expect(reload?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeFocused();

  expect((await request.get("/publications/example")).status()).toBe(200);
  expect((await request.get("/calendar-export")).status()).toBe(404);
  for (const retiredPath of [
    "/accounts",
    "/accounts/setup",
    "/activity",
    "/posts",
    "/engagement",
    "/messages",
    "/notifications",
    "/studio",
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
