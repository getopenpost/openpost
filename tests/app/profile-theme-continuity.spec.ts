import { expect, test } from "@playwright/test";
import { assignBuiltInTheme, authenticatePage, createWorkspace, registerUser } from "./helpers";

test.use({ serviceWorkers: "block" });

test("public profiles retain the viewer's theme on direct entry and reload", async ({
  page,
  request,
}) => {
  const { token } = await registerUser(request, `profile-theme-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, token, "Profile theme");
  const response = await request.patch("/api/v1/auth/profile", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      display_name: "Publishing record",
      public_profile_enabled: true,
      public_profile_visible_fields: ["display_name", "activity"],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const me = await request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const identity = await me.json();
  await assignBuiltInTheme(request, token, workspace.id, "dither-moss");
  await authenticatePage(page, token);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(`/u/${identity.username}`);
    await expect(
      page.getByRole("heading", { name: "Publishing record", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `.impeccable/review/dither-migration/profile-entry-${scheme}.png`,
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither-moss");
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither-moss");
      const colors = await page.locator(".profile-canvas").evaluate((element) => {
        const sample = document.createElement("span");
        element.append(sample);
        sample.style.color = "var(--activity-4)";
        const activity = getComputedStyle(sample).color;
        sample.style.color = "var(--primary)";
        const primary = getComputedStyle(sample).color;
        sample.remove();
        return { activity, primary };
      });
      expect(colors.activity).toBe(colors.primary);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.impeccable/review/dither-migration/profile-${width}-${scheme}.png`,
      });
    }
  }
  await page.context().clearCookies();
  await page.goto(`/u/${identity.username}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither");
  await expect(page.getByRole("heading", { name: "Publishing record", exact: true })).toBeVisible();
});

test("page headers stay compact and use theme icons", async ({ page, request }) => {
  const { token } = await registerUser(request, `compact-headers-${Date.now()}@example.com`);
  await createWorkspace(request, token, "Compact headers");
  await authenticatePage(page, token);
  for (const path of ["/media", "/settings?tab=profile", "/prompts", "/analytics"]) {
    await page.goto(path);
    const heading = page.locator('[data-slot="page-header"] h1');
    await expect(heading).toBeVisible();
    expect(
      await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeLessThanOrEqual(20);
    await expect(page.locator('img[src*="/brand/features/"]')).toHaveCount(0);
  }
});

test("anonymous app entry uses the default Dither theme", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither");
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  }
});
