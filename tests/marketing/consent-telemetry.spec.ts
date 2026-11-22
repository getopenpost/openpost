import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gunzipSync } from "node:zlib";

test.describe("cookie consent", () => {
  for (const [label, preference] of [
    ["Decline", "off"],
    ["Accept", "persistent"],
    ["Use cookie-free analytics", "cookieless"],
  ] as const) {
    test(`cookie choice ${label} persists and can be changed`, async ({ page, context }) => {
      await page.goto("/");
      const banner = page.getByTestId("telemetry-consent");
      await expect(banner).toBeVisible();
      if (preference === "cookieless")
        await banner.getByText("More options", { exact: true }).click();
      await banner.getByRole("button", { name: label, exact: true }).click();
      await expect(banner).toBeHidden();
      expect(
        (await context.cookies()).find((cookie) => cookie.name === "openpost_analytics")?.value,
      ).toBe(`v1%3A${preference}`);
      await page.getByRole("button", { name: "Cookie preferences", exact: true }).click();
      await expect(banner).toBeVisible();
      await banner.getByRole("button", { name: "Close", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Cookie preferences", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      if (preference === "cookieless")
        await banner.getByText("More options", { exact: true }).click();
      await expect(banner.getByRole("button", { name: label, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await banner
        .getByRole("button", { name: preference === "off" ? "Accept" : "Decline", exact: true })
        .click();
      await expect(banner).toBeHidden();
      expect(
        (await context.cookies()).find((cookie) => cookie.name === "openpost_analytics")?.value,
      ).toBe(`v1%3A${preference === "off" ? "persistent" : "off"}`);
      await page.reload();
      await expect(banner).toBeHidden();
    });
  }

  test(`cookie banner fits 320px in light`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    const banner = page.getByTestId("telemetry-consent");
    await expect(banner).toBeVisible();
    const bounds = await banner.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await banner.getByText("More options", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(banner.getByRole("button", { name: "Use cookie-free analytics" })).toBeVisible();
    expect(await banner.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    for (const button of await banner.getByRole("button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const accessibility = await new AxeBuilder({ page })
      .include('[data-testid="telemetry-consent"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("telemetry pages", () => {
  for (const path of ["/", "/pricing", "/platforms/bluesky"]) {
    test(`analytics records a direct visit and reload of ${path}`, async ({ page }) => {
      // PostHog filters automation. Exercise a consenting human visitor while
      // keeping the production bot filter enabled.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        Object.defineProperty(navigator, "userAgentData", {
          get: () => undefined,
        });
      });
      await page.route("**/flags/**", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            featureFlags: {},
            errorsWhileComputingFlags: false,
          }),
        }),
      );
      const views: Array<{ path?: string; $current_url?: string }> = [];
      await page.route(/\/(?:e|batch)(?:\/|\?|$)/, async (route) => {
        const body = route.request().postDataBuffer();
        if (body) {
          const bytes = body[0] === 31 && body[1] === 139 ? gunzipSync(body) : body;
          const text = bytes.toString();
          const payload = JSON.parse(
            text.startsWith("data=")
              ? Buffer.from(new URLSearchParams(text).get("data")!, "base64").toString()
              : text,
          );
          const events = Array.isArray(payload) ? payload : (payload.batch ?? [payload]);
          for (const event of events) {
            if (event.event === "$pageview") views.push(event.properties);
          }
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: '{"status":1}',
        });
      });
      await page.route("**/array/*/config.js", (route) =>
        route.fulfill({ contentType: "application/javascript", body: "void 0;" }),
      );
      await page.route("**/static/**/web-vitals.js*", (route) =>
        route.fulfill({ contentType: "application/javascript", body: "void 0;" }),
      );
      // Consent is explicit in this fixture. No production ingestion is reachable.
      await page.goto(`${path}?token=must-not-be-collected#private-fragment`);
      const banner = page.getByTestId("telemetry-consent");
      await expect(banner).toBeVisible();
      await banner.getByRole("button", { name: "Accept", exact: true }).click();
      await expect.poll(() => views.length, { timeout: 20000 }).toBe(1);
      expect(views[0].path).toBe(path);
      expect(new URL(views[0].$current_url!).pathname).toBe(path);
      expect(views[0].$current_url).not.toContain("must-not-be-collected");
      await page.reload();
      await expect.poll(() => views.length, { timeout: 20000 }).toBe(2);
      expect(views[1].path).toBe(path);
    });
  }
});
