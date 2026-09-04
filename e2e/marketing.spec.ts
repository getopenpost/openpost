import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { parseChangelog } from "../packages/changelog/src/index.js";

test("marketing index links to the app and documentation @desktop", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("OpenPost - The all-in-one content team for solo founders");
  await expect(
    page.getByRole("link", { name: "Get started", exact: true }).first(),
  ).toHaveAttribute("href", "https://app.openpo.st/register?plan=founder&billing_period=monthly");
  await expect(page.getByRole("link", { name: "User docs" }).first()).toHaveAttribute(
    "href",
    "https://docs.openpo.st/usage/",
  );
  await expect(page.getByRole("link", { name: "Developer docs" }).first()).toHaveAttribute(
    "href",
    "https://docs.openpo.st/development/",
  );
});
test("free tools directory links every working tool @desktop", async ({ page }) => {
  const toolSlugs = [
    "social-media-video-editor",
    "social-media-image-editor",
    "multi-platform-character-counter",
    "post-preview-generator",
    "thread-splitter",
    "fediverse-handle-checker",
    "linkedin-text-formatter",
    "best-time-to-post-calculator",
    "utm-link-builder",
  ] as const;

  await page.goto("/tools");
  await expect(
    page.getByRole("heading", { name: "Finish the post before you sign up.", level: 1 }),
  ).toBeVisible();
  const main = page.getByRole("main");
  for (const slug of toolSlugs) {
    await expect(main.locator(`a[href="/tools/${slug}"]`)).toHaveCount(1);
  }

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("retired marketing pages and compatibility redirects stay removed", async ({ request }) => {
  for (const retiredPath of [
    "/self-hosted",
    "/open-source",
    "/compare",
    "/docs",
    "/docs/usage/accounts",
  ]) {
    expect((await request.get(retiredPath)).status(), retiredPath).toBe(404);
  }
});

test("pricing makes every plan selectable for monthly and annual billing", async ({ page }) => {
  const planCases = [
    { id: "starter", name: "Starter", monthly: "$15", annual: "$150" },
    { id: "founder", name: "Founder", monthly: "$25", annual: "$250" },
    { id: "pro", name: "Pro", monthly: "$49", annual: "$490" },
    { id: "team", name: "Team", monthly: "$99", annual: "$990" },
    { id: "agency", name: "Agency", monthly: "$199", annual: "$1,990" },
  ] as const;

  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.setViewportSize({ width: 390, height: 844 });
  }

  await page.goto("/pricing");

  const selfHosted = page.locator('section[aria-label="Self-hosted deployment"]');
  await expect(selfHosted).toContainText("no software fee");
  await expect(selfHosted).toContainText("not a hosted plan and not a free tier of one");
  await expect(selfHosted.getByRole("link", { name: "Review self-hosting" })).toHaveAttribute(
    "href",
    "/self-hosting",
  );

  await page.getByText("Trial and billing details").click();
  await expect(page.getByText("Paddle is the Merchant of Record")).toBeVisible();
  await expect(page.getByRole("link", { name: "Refund policy" })).toHaveAttribute(
    "href",
    "/refunds",
  );
  await expect(page.getByRole("link", { name: "Billing settings" })).toHaveAttribute(
    "href",
    "https://app.openpo.st/settings?tab=billing#billing",
  );
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveCount(1);

  await expect(page.getByRole("article")).toHaveCount(5);
  for (const plan of planCases) {
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: plan.name }) });
    await expect(card.locator(".animated-price")).toHaveAttribute("aria-label", plan.monthly);
    await expect(card.getByRole("link", { name: `Start ${plan.name}` })).toHaveAttribute(
      "href",
      `https://app.openpo.st/register?plan=${plan.id}&billing_period=monthly`,
    );
    await expect(card).toContainText(`Then ${plan.monthly} per month until canceled.`);
  }

  const yearly = page.getByRole("button", { name: /^Yearly/ });
  await yearly.focus();
  await yearly.click();
  await expect(yearly).toBeFocused();
  await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText(
    "Yearly billing selected",
  );
  for (const plan of planCases) {
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: plan.name }) });
    await expect(card).toContainText(`Billed ${plan.annual} yearly`);
    await expect(card.getByRole("link", { name: `Start ${plan.name}` })).toHaveAttribute(
      "href",
      `https://app.openpo.st/register?plan=${plan.id}&billing_period=annual`,
    );
    await expect(card).toContainText(`Then ${plan.annual} per year until canceled.`);
  }

  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const comparison = page.locator(".desktop-limits");
    for (const plan of planCases) {
      await expect(comparison.getByRole("columnheader", { name: plan.name })).toContainText(
        `${plan.annual}/year`,
      );
    }
  } else {
    const comparison = page.locator(".mobile-limits");
    for (const plan of planCases) {
      await expect(comparison.locator(`[data-plan-id="${plan.id}"]`)).toContainText(
        `${plan.annual}/year`,
      );
    }
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("article")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("self-hosting path states the complete operator boundary without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto("/self-hosting");
  await expect(
    page.getByRole("heading", {
      name: "Your server. Your data. The same OpenPost.",
    }),
  ).toBeVisible();
  await expect(page.getByText("No software fee", { exact: true })).toBeVisible();
  for (const heading of [
    "Infrastructure and data",
    "Upgrades and backups",
    "Provider projects",
    "Support boundary",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Open the deployment guide" })).toHaveAttribute(
    "href",
    "https://docs.openpo.st/self-hosting/",
  );
  await expect(page.getByRole("link", { name: "View source on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/getopenpost/openpost",
  );
  await expect(page.getByRole("link", { name: "Review the production checklist" })).toHaveAttribute(
    "href",
    "https://docs.openpo.st/configuration/production-checklist",
  );

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Support boundary" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await context.close();
});

test("free marketing tools produce useful output @desktop", async ({ page }) => {
  await page.goto("/tools/multi-platform-character-counter");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Post text" }).fill("hello");
  await expect(page.getByRole("progressbar", { name: "X character use" })).toHaveAttribute(
    "aria-valuenow",
    "5",
  );
  await expect(page.getByRole("progressbar", { name: "Discord character use" })).toHaveAttribute(
    "aria-valuenow",
    "5",
  );

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
  await expect(page.locator('[aria-label="Mastodon post preview"]')).toContainText(
    "@alice@hachyderm.io",
  );

  await page.goto("/tools/thread-splitter");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Text to split into a thread" }).fill("x".repeat(300));
  await page.getByRole("button", { name: "Social network" }).click();
  await page.getByRole("option", { name: /Bluesky/ }).click();
  await expect(page.getByRole("button", { name: "Copy part 2" })).toBeVisible();

  await page.goto("/tools/fediverse-handle-checker");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Fediverse or Bluesky handle").fill("@alice@hachyderm.io");
  await expect(page.getByText("@alice@hachyderm.io", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check live" })).toBeEnabled();

  await page.goto("/tools/linkedin-text-formatter");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("textbox", { name: "LinkedIn post draft" })
    .fill("First sentence. Second sentence.");
  await page.getByRole("button", { name: "Paragraph length" }).click();
  await page.getByRole("option", { name: "One sentence" }).click();
  await page.getByRole("checkbox", { name: "Use the same bullet style" }).click();
  await expect(page.getByRole("textbox", { name: "Formatted LinkedIn post" })).toHaveValue(
    /First sentence/,
  );

  await page.goto("/tools/best-time-to-post-calculator");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Posts per week").fill("2");
  await expect(
    page.getByRole("region", { name: "Your local schedule" }).getByRole("listitem"),
  ).toHaveCount(2);

  await page.goto("/tools/utm-link-builder");
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("Page link")
    .fill("https://example.com/launch?ref=homepage&utm_term=founders&utm_content=demo#details");
  await page.getByLabel("Source").fill("linkedin");
  await page.getByRole("textbox", { name: "Campaign", exact: true }).fill("summer-launch");
  await expect(page.getByTestId("utm-result")).toHaveText(
    "https://example.com/launch?ref=homepage&utm_term=founders&utm_content=demo&utm_source=linkedin&utm_medium=social&utm_campaign=summer-launch#details",
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Campaign", exact: true }).fill("autumn-launch");
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
});

test("public changelog is generated from the canonical release record @desktop", async ({
  page,
}) => {
  const canonicalSection = parseChangelog(
    readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
  ).find((section) => section.groups.some((group) => group.items.length > 0));
  const canonicalItem = canonicalSection?.groups.find((group) => group.items.length > 0)?.items[0];
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
  await expect(page.getByRole("link", { name: "Full changelog" })).toHaveAttribute(
    "href",
    "https://github.com/getopenpost/openpost/blob/main/CHANGELOG.md",
  );
});
