import { expect, test } from "@playwright/test";

test("marketing index links to the app and documentation", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(
    /OpenPost - Publishing for humans and AI agents/,
  );
  await expect(
    page.getByRole("heading", {
      name: "The publishing workspace between your AI agent and your social accounts.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Testimonials", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Run the same publishing boundary on your own server.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Try the managed app" }).first(),
  ).toHaveAttribute(
    "href",
    "https://app.openpost.social/register?plan=starter",
  );
  await expect(
    page.getByRole("link", { name: "Self-host OpenPost" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/self-hosting/");
  await expect(
    page.getByText(
      "Create an account and one workspace before checkout. Connecting social accounts and publishing on the managed app require an active plan, starting at €6/month. There is no hosted free plan.",
      { exact: true },
    ).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "One brief in. Five reviewable destinations out.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/AI can draft the campaign. It still should not publish blind/),
  ).toBeVisible();
  await expect(
    page.getByText(/The useful boundary is not AI versus no AI/),
  ).toBeVisible();
  const readiness = page.getByRole("table", {
    name: "Launch provider readiness",
  }).first();
  await expect(readiness.getByRole("row")).toHaveCount(6);
  await expect(readiness).toContainText("Available");
  await expect(readiness).toContainText("Verify before a launch demo");
  await expect(
    page.getByRole("link", { name: "User docs" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/usage/");
  await expect(
    page.getByRole("link", { name: "Self-hosting docs" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/self-hosting/");
  await expect(
    page.getByRole("link", { name: "Developer docs" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/development/");
  await expect(
    page.getByRole("link", { name: "GitHub source" }),
  ).toHaveAttribute("href", "https://github.com/rodrgds/openpost");

  const demoButton = page.getByRole("button", {
    name: "Play OpenPost product video",
  });
  await expect(demoButton.locator("img")).toHaveAttribute(
    "src",
    "/assets/screenshots/main-dark.png",
  );
  const demoElement = page.locator(
    'dialog[aria-label="OpenPost product video"]',
  );
  await expect(demoElement.locator("iframe")).toHaveCount(0);
  await demoButton.click();
  const demoDialog = page.getByRole("dialog", {
    name: "OpenPost product video",
  });
  const closeDemo = demoDialog.getByRole("button", { name: "Close video" });
  await expect(demoDialog.locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/_mZf3HzQaN8?autoplay=1&rel=0",
  );
  await expect(closeDemo).toBeFocused();
  await closeDemo.press("Shift+Tab");
  expect(
    await page.evaluate(() =>
      document.querySelector("dialog")?.contains(document.activeElement),
    ),
  ).toBe(true);
  await closeDemo.focus();
  await page.keyboard.press("Escape");
  await expect(demoDialog).not.toBeVisible();
  await expect(demoElement.locator("iframe")).toHaveCount(0);
  await expect(demoButton).toBeFocused();
});

test("security page states the agent permission boundary accurately", async ({
  page,
}) => {
  await page.goto("/security");

  await expect(
    page.getByRole("heading", {
      name: "Let agents use the publishing system without handing over provider credentials.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "mcp:full remains real mutation permission",
    }),
  ).toBeVisible();
  const humanReviewBoundary = page
    .getByRole("heading", { name: "Human review is a workflow choice" })
    .locator("..");
  await expect(humanReviewBoundary).toContainText(
    "OpenPost does not currently claim a universal approval gate",
  );
});

test("marketing index has no horizontal overflow", async ({ page }) => {
  await page.goto("/");

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("marketing SEO routes expose the current public index", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBeTruthy();
  const robotsText = await robots.text();
  expect(robotsText).toContain("Sitemap: https://openpost.social/sitemap.xml");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBeTruthy();
  const xml = await sitemap.text();
  expect(xml).toContain("<loc>https://openpost.social/</loc>");
  expect(xml).toContain("<loc>https://openpost.social/platforms</loc>");
  expect(xml).toContain("<loc>https://openpost.social/platforms/x</loc>");
  expect(xml).toContain("<loc>https://openpost.social/compare</loc>");
  expect(xml).toContain("<loc>https://openpost.social/compare/buffer</loc>");
  expect(xml).toContain("<loc>https://openpost.social/tools</loc>");
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/multi-platform-character-counter</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/post-preview-generator</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/thread-splitter</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/fediverse-handle-checker</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/linkedin-text-formatter</loc>",
  );
  expect(xml).toContain(
    "<loc>https://openpost.social/tools/best-time-to-post-calculator</loc>",
  );
  expect(xml).toContain("<loc>https://openpost.social/security</loc>");
  expect(xml).toContain("<loc>https://openpost.social/privacy</loc>");
  expect(xml).toContain("<loc>https://openpost.social/terms</loc>");
  expect(xml).not.toContain("<loc>https://openpost.social/blog</loc>");
  expect(xml).not.toContain("<loc>https://openpost.social/tips/");

  const publicPaths = [
    ...xml.matchAll(/<loc>(https:\/\/openpost\.social[^<]+)<\/loc>/g),
  ].map(([, url]) => new URL(url).pathname);
  expect(publicPaths.length).toBeGreaterThan(20);
  for (const path of publicPaths) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be publicly reachable`).toBeTruthy();
  }
});

test("free marketing tools produce useful output", async ({ page }) => {
  await page.goto("/tools/multi-platform-character-counter");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Post text" }).fill("hello");
  await expect(
    page.getByRole("progressbar", { name: "X character use" }),
  ).toHaveAttribute("aria-valuenow", "5");

  await page.goto("/tools/post-preview-generator");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Platform").selectOption({ value: "mastodon" });
  await page.getByLabel("Handle").fill("@alice@hachyderm.io");
  await expect(
    page.getByRole("article", { name: "Mastodon post preview" }),
  ).toContainText("@alice@hachyderm.io");

  await page.goto("/tools/thread-splitter");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("textbox", { name: "Text to split into a thread" })
    .fill("x".repeat(300));
  await expect(page.getByRole("button", { name: "Copy part 2" })).toBeVisible();

  await page.goto("/tools/fediverse-handle-checker");
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("Fediverse or Bluesky handle")
    .fill("@alice@hachyderm.io");
  await expect(
    page.getByText("@alice@hachyderm.io", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check live" })).toBeEnabled();

  await page.goto("/tools/linkedin-text-formatter");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("textbox", { name: "LinkedIn post draft" })
    .fill("First sentence. Second sentence.");
  await expect(
    page.getByRole("textbox", { name: "Formatted LinkedIn post" }),
  ).toHaveValue(/First sentence/);

  await page.goto("/tools/best-time-to-post-calculator");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Posts per week").fill("2");
  await expect(
    page
      .getByRole("region", { name: "Your local schedule" })
      .getByRole("listitem"),
  ).toHaveCount(2);
});
