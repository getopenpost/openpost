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
  await expect(page.getByRole("link", { name: "Posts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Media" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Documentation" })).toHaveAttribute(
    "href",
    "https://docs.openpost.social/usage/",
  );
  await expect(page.getByRole("link", { name: "Contact support" })).toHaveCount(0);

  const reload = await page.reload();
  expect(reload?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeFocused();

  expect((await request.get("/publications/example")).status()).toBe(200);
  expect((await request.get("/calendar-export")).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("client navigation preserves localized recovery at supported phone presentations", async ({
  page,
}) => {
  const errors = captureBrowserErrors(page);
  const scenarios = [
    { width: 390, height: 844, locale: "en", theme: "dark", heading: "Page not found" },
    { width: 320, height: 800, locale: "pt", theme: "light", heading: "Página não encontrada" },
  ] as const;

  for (const scenario of scenarios) {
    await page.setViewportSize(scenario);
    await page.context().addCookies([
      {
        name: "PARAGLIDE_LOCALE",
        value: scenario.locale,
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await page.goto("/login");
    await page.evaluate(
      (theme) => localStorage.setItem("mode-watcher-mode", theme),
      scenario.theme,
    );
    await page.reload();
    await page.evaluate((target) => {
      const link = document.createElement("a");
      link.href = target;
      link.textContent = "Open missing route";
      link.dataset.testid = "client-missing-route";
      document.body.append(link);
    }, missingPath);
    await page.getByTestId("client-missing-route").click();

    await expect(page).toHaveURL(new RegExp(`${missingPath}$`));
    await expect(page.getByRole("heading", { name: scenario.heading })).toBeFocused();
    if (scenario.theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const backBox = await page
      .getByRole("button", { name: scenario.locale === "pt" ? "Voltar" : "Back" })
      .boundingBox();
    expect(backBox?.height).toBeGreaterThanOrEqual(44);
    await expectNoSeriousAccessibilityViolations(page);
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

test("an unauthenticated standalone page retains its context while offline", async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });

  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("You are offline.");
  await expect(page.getByText("Reconnect to continue using OpenPost.")).toBeVisible();
  expect(errors).toEqual([]);
});
