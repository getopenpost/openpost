import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { parseChangelog } from "../packages/changelog/src/index.js";

test("marketing index links to the app and documentation", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(
    "OpenPost - The all-in-one content team for solo founders",
  );
  await expect(
    page.getByRole("heading", {
      name: "Turn what you’re building into content. Publish it everywhere.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Testimonials", { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("link", { name: "Start your 14-day trial", exact: true })
      .first(),
  ).toHaveAttribute(
    "href",
    "https://app.openpost.social/register?plan=creator",
  );
  await expect(
    page
      .getByText(
        "Start with a 14-day free trial. A card is required, and you can cancel before the first charge.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "From company update to content on every channel.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Your ideas, assets, calendar, and results in one system.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Each platform gets the version it needs.",
    }),
  ).toBeVisible();
  await expect(page.getByAltText("OpenPost social accounts page")).toHaveCount(
    0,
  );
  await expect(
    page.getByAltText("OpenPost connected social accounts page"),
  ).toHaveAttribute("src", "/assets/screenshots/accounts-dark.png");
  await expect(
    page.getByRole("heading", {
      name: "Everything you build deserves an audience.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Start with the work")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Self-host", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "User docs" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/usage/");
  await expect(
    page.getByRole("link", { name: "Self-hosting" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/self-hosting/");
  await expect(
    page.getByRole("link", { name: "Developer docs" }).first(),
  ).toHaveAttribute("href", "https://docs.openpost.social/development/");
  await expect(
    page.getByRole("link", { name: "GitHub source" }),
  ).toHaveAttribute("href", "https://github.com/rodrgds/openpost");
  await expect(
    page.getByRole("link", { name: "Discord", exact: true }).last(),
  ).toHaveAttribute("href", "https://discord.gg/u2QwukmY4W");
});

test("security page states AI tool access accurately", async ({ page }) => {
  await page.goto("/security");

  await expect(
    page.getByRole("heading", {
      name: "Keep social credentials inside the publishing system.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "mcp:full can make changes",
    }),
  ).toBeVisible();
  const humanReview = page
    .getByRole("heading", { name: "You choose when to review" })
    .locator("..");
  await expect(humanReview).toContainText(
    "OpenPost does not add a separate approval step",
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

test("marketing navigation uses the shared responsive menu patterns", async ({
  page,
}) => {
  await page.goto("/");

  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const navigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    await expect(navigation).toHaveAttribute("data-slot", "navigation-menu");
    await navigation.getByRole("button", { name: "Resources" }).click();
    await expect(
      navigation.getByRole("link", { name: "Changelog", exact: true }),
    ).toHaveAttribute("href", "/changelog");
    await expect(
      navigation.getByRole("link", {
        name: "Discord community",
        exact: true,
      }),
    ).toHaveAttribute("href", "https://discord.gg/u2QwukmY4W");
    await page.keyboard.press("Escape");
    return;
  }

  await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Changelog", exact: true }),
  ).toHaveAttribute("href", "/changelog");
  await expect(
    navigation.getByRole("link", {
      name: "Discord community",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://discord.gg/u2QwukmY4W");
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
  expect(xml).toContain("<loc>https://openpost.social/platforms/discord</loc>");
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
  await expect(
    page.getByRole("progressbar", { name: "Discord character use" }),
  ).toHaveAttribute("aria-valuenow", "5");

  await page.goto("/tools/post-preview-generator");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Platform", exact: true }).click();
  await page.getByRole("option", { name: "Mastodon", exact: true }).click();
  await expect(page.locator("select")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: /Account, links, polls, and media/,
    })
    .click();
  await page.getByLabel("Handle").fill("@alice@hachyderm.io");
  await expect(
    page.locator('[aria-label="Mastodon post preview"]'),
  ).toContainText("@alice@hachyderm.io");

  await page.goto("/tools/thread-splitter");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("textbox", { name: "Text to split into a thread" })
    .fill("x".repeat(300));
  await page.getByRole("button", { name: "Social network" }).click();
  await page.getByRole("option", { name: /Bluesky/ }).click();
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
  await page.getByRole("button", { name: "Paragraph length" }).click();
  await page.getByRole("option", { name: "One sentence" }).click();
  await page
    .getByRole("checkbox", { name: "Use the same bullet style" })
    .click();
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

test("public changelog is generated from the canonical release record", async ({
  page,
}) => {
  const canonicalSection = parseChangelog(
    readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
  ).find((section) => section.groups.some((group) => group.items.length > 0));
  const canonicalItem = canonicalSection?.groups.find(
    (group) => group.items.length > 0,
  )?.items[0];
  if (!canonicalItem) {
    throw new Error("The canonical changelog has no visible entries");
  }

  await page.goto("/changelog");

  await expect(
    page
      .getByRole("heading", {
        name: /^(?:Unreleased|v\d+\.\d+\.\d+)$/,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(canonicalItem, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Full changelog" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/rodrgds/openpost/blob/main/CHANGELOG.md",
  );
});
