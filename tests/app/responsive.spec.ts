import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

// One phone-width sweep owns horizontal-overflow coverage for the app, so the
// journey specs test behavior at their natural size instead of width matrices.
const phone = { width: 320, height: 800 };

const publicRoutes = ["/login", "/register", "/forgot-password"];

const workspaceRoutes = [
  "/",
  "/calendar",
  "/publications",
  "/publications?tab=drafts",
  "/publications/:publication",
  "/analytics",
  "/ideate",
  "/prompts",
  "/templates",
  "/media",
  "/inbox/engagement",
  "/inbox/messages",
  "/inbox/notifications",
  "/workflows",
  "/workflows/reposts",
  "/workflows/connections",
  "/accounts",
  "/settings",
  "/settings?tab=schedule",
  "/settings?tab=security",
  "/video-editor",
  "/image-editor",
  "/quick-cut",
];

async function expectNoHorizontalOverflow(page: Page, route: string) {
  await expect(page.locator("main").first(), route).toBeVisible();
  await expect(page.getByTestId("page-loading"), route).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), {
      message: `${route} scrolls horizontally`,
    })
    .toBeLessThanOrEqual(0);
}

for (const colorScheme of ["light"] as const) {
  test.describe(`${colorScheme} phone layout`, () => {
    test.use({ colorScheme, viewport: phone, hasTouch: true, reducedMotion: "reduce" });

    test("public entry pages fit a 320px phone", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const route of publicRoutes) {
        await page.goto(route);
        await expectNoHorizontalOverflow(page, route);
      }
      expect(errors).toEqual([]);
    });

    test("workspace pages fit a 320px phone", async ({ page, request }) => {
      test.setTimeout(180_000);
      const { token } = await registerUser(request, `responsive-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, token, "Responsive sweep");
      const publication = await createPublication(
        request,
        token,
        workspace.id,
        "A launch note that should read well on a phone.",
      );
      await authenticatePage(page, token);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const template of workspaceRoutes) {
        const route = template.replace(":publication", publication.id);
        const separator = route.includes("?") ? "&" : "?";
        await page.goto(`${route}${separator}workspace=${workspace.id}`);
        await expectNoHorizontalOverflow(page, route);
      }
      expect(errors).toEqual([]);
    });
  });
}
