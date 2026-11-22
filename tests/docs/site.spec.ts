import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Site-level documentation behavior: consent, recovery, and retained routes.
// Analytics stays local; a real collector must never receive test traffic.
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
});

test.describe("cookie choices", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("docs cookie choices work from the keyboard and persist", async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/docs/");
    const banner = page.getByTestId("telemetry-consent");
    await expect(banner).toBeVisible();
    const accessibility = await new AxeBuilder({ page })
      .include('[data-testid="telemetry-consent"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await banner.getByText("More options", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await banner.getByRole("button", { name: "Use cookie-free analytics" }).click();
    await expect(banner).toBeHidden();
    expect(
      (await context.cookies()).find((cookie) => cookie.name === "openpost_analytics")?.value,
    ).toBe("v1%3Acookieless");
    const preferences = page.getByRole("button", { name: "Cookie preferences" });
    await preferences.click();
    await banner.getByRole("button", { name: "Close", exact: true }).click();
    await expect(preferences).toBeFocused();
    await page.keyboard.press("Enter");
    await banner.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(async () => {
      await preferences.click();
      await expect(banner).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await expect(banner.getByRole("button", { name: "Decline", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await banner.getByRole("button", { name: "Accept", exact: true }).click();
    expect(
      (await context.cookies()).find((cookie) => cookie.name === "openpost_analytics")?.value,
    ).toBe("v1%3Apersistent");
    await page.reload();
    await expect(banner).toBeHidden();
  });

  test("the cookie banner fits a 320px phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/docs/");
    const banner = page.getByTestId("telemetry-consent");
    await expect(banner).toBeVisible();
    const bounds = await banner.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(await banner.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
});

test("documentation recovery retains its mounted assets and home action", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/docs/a-missing-section/a-missing-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
  const artwork = page.locator(".op-recovery-art img");
  expect(
    await artwork.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
  ).toBe(true);
  await expect(artwork).toHaveAttribute("src", /^\/docs\/assets\//);
  const home = page.getByRole("link", { name: "Back to docs", exact: true });
  await expect(home).toHaveAttribute("href", /^\/docs\/?$/);
  const rest = await home.evaluate((link) => getComputedStyle(link, "::before").maskImage);
  await home.focus();
  expect(await home.evaluate((link) => getComputedStyle(link, "::before").maskImage)).not.toBe(
    rest,
  );
  await home.click();
  await expect(page).toHaveURL(/\/docs\/?$/);
});

test.describe("retained routes", () => {
  const socialNetworks = [
    "bluesky",
    "mastodon",
    "pixelfed",
    "peertube",
    "lemmy",
    "piefed",
    "discord",
    "telegram",
    "linkedin",
    "x",
    "facebook",
    "instagram",
    "threads",
    "youtube",
    "tiktok",
    "pinterest",
  ];

  test("moved guides keep their public routes", async ({ request }) => {
    for (const [oldPath, replacement] of [
      ["/guides/video-editor", "/video-editor"],
      ["/guides/image-editor", "/image-editor"],
      ["/guides/quick-cut", "/video-editor/quick-cut-and-recorder"],
      ["/guides/recording", "/video-editor/quick-cut-and-recorder"],
      ["/guides/automation", "/automate"],
      ["/guides/sdk", "/automate/sdk"],
      ["/guides/cli", "/automate/cli"],
      ["/mcp/tools", "/mcp/mcp-guide"],
    ] as const) {
      const response = await request.get(`/docs${oldPath}`);
      expect(response.ok(), oldPath).toBe(true);
      expect(new URL(response.url()).pathname).toBe(`/docs${replacement}`);
    }
  });

  test("moved Markdown guides keep their agent-readable routes", async ({ request }) => {
    for (const [oldPath, replacement] of [
      ["/guides/sdk.md", "/automate/sdk/index.md"],
      ["/guides/cli.md", "/automate/cli/index.md"],
      ["/automate/sdk.md", "/automate/sdk/index.md"],
      ["/automate/api.md", "/automate/api/index.md"],
      ["/automate/cli.md", "/automate/cli/index.md"],
      ["/automate/n8n.md", "/automate/n8n/index.md"],
    ] as const) {
      const response = await request.get(`/docs${oldPath}`);
      expect(response.ok(), oldPath).toBe(true);
      expect(new URL(response.url()).pathname).toBe(`/docs${replacement}`);
    }
  });

  test("old workflow HTML and Markdown URLs reach the new guides", async ({ request }) => {
    for (const [oldPath, target] of [
      ["workflows", "/workflows"],
      ["workflows/", "/workflows"],
      ["workflows.md", "/workflows/index.md"],
      ["workflow-examples", "/workflows#examples"],
      ["workflow-examples/", "/workflows#examples"],
      ["workflow-examples.md", "/workflows/index.md#examples"],
    ]) {
      const response = await request.get(`/docs/automate/${oldPath}`, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      expect(response.headers().location).toBe(`/docs${target}`);
      expect((await request.get(`/docs${target}`)).ok()).toBe(true);
    }
  });

  test("older provider URLs resolve to the individual guides", async ({ request }) => {
    for (const network of socialNetworks) {
      const response = await request.get(`/docs/providers/${network}`);
      expect(response.ok()).toBe(true);
      expect(new URL(response.url()).pathname).toBe(`/docs/self-hosting/integrations/${network}`);
    }
    for (const group of ["meta-platforms", "bluesky-mastodon", "discord-telegram"]) {
      const response = await request.get(`/docs/self-hosting/integrations/${group}`);
      expect(response.ok()).toBe(true);
      expect(new URL(response.url()).pathname).toBe("/docs/self-hosting/integrations");
    }
  });

  test("older workspace URL reaches the current guide", async ({ request }) => {
    const response = await request.get("/docs/usage/workspaces");
    expect(response.ok()).toBe(true);
    expect(new URL(response.url()).pathname).toBe("/docs/guides/workspaces");
  });

  test("retired self-hosting guide URL opens the current guide without a hydration error", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/self-hosting/integrations/instagram");
    await expect(page).toHaveURL(/\/docs\/self-hosting\/integrations\/instagram$/);
    await expect(page.getByRole("heading", { name: "Instagram", level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
