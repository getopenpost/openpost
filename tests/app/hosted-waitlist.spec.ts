import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ hasTouch: colorScheme === "dark" });
    test(`Hosted waitlist handles retries and signup at phone and desktop widths in ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.route("**/api/v1/auth/config", (route) =>
        route.fulfill({
          json: {
            waitlist_enabled: true,
            registration_enabled: false,
            purchase_choice_required: true,
            legal_acceptance_required: true,
            email_verification_required: true,
            privacy_url: "https://openpo.st/privacy",
          },
        }),
      );
      // The waitlist must still work when optional identity providers are unavailable.
      await page.route("**/api/v1/auth/oidc/providers", (route) =>
        route.fulfill({ status: 503, json: {} }),
      );
      let attempts = 0;
      const unexpected: string[] = [];
      page.on("request", (request) => {
        if (
          /\/api\/v1\/(billing\/purchase-choice|auth\/(register|email-verification))/.test(
            request.url(),
          )
        ) {
          unexpected.push(request.url());
        }
      });
      await page.route("**/api/v1/auth/waitlist", (route) => {
        expect(route.request().postDataJSON()).toEqual({ email: "waitlist@example.com" });
        attempts += 1;
        return route.fulfill(
          attempts === 1
            ? { status: 503, json: { detail: "unavailable" } }
            : { json: { joined: true } },
        );
      });

      await page.goto("/register?plan=founder&billing_period=monthly&redirect=%2Fimage-editor");
      await expect(
        page.getByRole("heading", { name: "OpenPost Cloud is almost ready" }),
      ).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);

      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByRole("button", { name: "Join the waitlist" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (colorScheme === "dark") {
          const emailBounds = await page
            .getByRole("textbox", { name: "Email", exact: true })
            .boundingBox();
          const buttonBounds = await page
            .getByRole("button", { name: "Join the waitlist" })
            .boundingBox();
          expect(emailBounds?.height).toBeGreaterThanOrEqual(44);
          expect(buttonBounds?.height).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({
          path: testInfo.outputPath(`waitlist-${colorScheme}-${width}.png`),
          fullPage: true,
        });
      }
      const accessibility = await new AxeBuilder({ page }).include("main").analyze();
      expect(accessibility.violations).toEqual([]);

      const email = page.getByRole("textbox", { name: "Email", exact: true });
      await email.fill("invalid");
      await email.press("Enter");
      expect(attempts).toBe(0);
      await email.fill("waitlist@example.com");
      await email.press("Tab");
      await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Join the waitlist" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toContainText("We couldn't save your email");
      await expect(email).toHaveValue("waitlist@example.com");
      await page.getByRole("button", { name: "Join the waitlist" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "You're on the list" }),
      ).toBeVisible();
      await expect(email).toHaveCount(0);
      expect(attempts).toBe(2);
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`waitlist-${colorScheme}-success.png`),
        fullPage: true,
      });
      await page.getByRole("link", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/login\?redirect=%2Fimage-editor$/);
      await expect(page.getByRole("link", { name: "Join the waitlist" })).toBeVisible();
    });
  });
}
