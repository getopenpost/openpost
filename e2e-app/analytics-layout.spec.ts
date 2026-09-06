import { expect, test } from "@playwright/test";
import builtins from "../backend/internal/services/themes/builtins.v1.json" with { type: "json" };
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const platforms = ["x", "threads", "bluesky", "mastodon", "linkedin"];
const content = platforms.map((platform, index) => ({
  reference: {
    type: "openpost",
    publication_id: `publication-${index}`,
    rendition_id: `rendition-${index}`,
  },
  source: "openpost",
  platform,
  account_id: `account-${index}`,
  username: "@rodrgds",
  title: [
    "Just started using a US VPN for normal day-to-day work",
    "This felt SOOOO good.",
    "Approval prompts FEEL safe because they ask a human.",
    "Looking clean ay?",
    "Lately, I'm more surprised when GitHub works than when it doesn't",
  ][index],
  published_at: "2026-09-04T12:00:00Z",
  status: "ok",
  metric_availability: "available",
  metrics: { likes: 8 - index, views: 1200 },
  measurements: {},
  engagement: 8 - index,
}));
const trend = Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 7, 8 + index)).toISOString().slice(0, 10),
  value: 10 + index,
  items: [
    {
      key: `post-${index}`,
      label: content[index % 5].title,
      platform: platforms[index % 5],
      value: 10 + index,
    },
  ],
}));

for (const [themeID, scheme] of [
  ["workshop", "light"],
  ["workshop", "dark"],
  ["studio", "light"],
  ["midnight", "dark"],
] as const) {
  for (const width of [1440, 1200, 390, 320]) {
    test.describe(`${themeID} ${scheme} ${width}`, () => {
      test.use({ colorScheme: scheme, hasTouch: width < 768 });
      test(`analytics actions remain inside their rows at ${width}px`, async ({
        page,
        request,
      }, testInfo) => {
        const { token } = await registerUser(
          request,
          `analytics-layout-${width}-${Date.now()}@example.com`,
        );
        const workspace = await createWorkspace(request, token, "Analytics layout");
        await authenticatePage(page, token);
        await page.setViewportSize({ width, height: 1000 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
        await page.route("**/api/v1/analytics?**", (route) =>
          route.fulfill({
            json: {
              range_days: 30,
              source: "all",
              content_total: content.length,
              summary: {
                followers: { value: 100, measured: 5 },
                engagement: { value: 30, measured: 5 },
                views: { value: 6000, measured: 5 },
                impressions: { value: 0, measured: 0 },
                reach: { value: 0, measured: 0 },
                published: 5,
              },
              accounts: platforms.map((platform, index) => ({
                id: `account-${index}`,
                platform,
                username: "@rodrgds",
                status: "ok",
                account_supported: true,
                content_supported: true,
                metrics: { followers: 20 },
              })),
              content,
              trends: { views: trend, engagement: trend, followers: trend },
              insights: [],
            },
          }),
        );
        const family = builtins.find((theme) => theme.id === themeID)!;
        if (themeID !== "workshop")
          await page.route("**/api/v1/themes/resolved?**", (route) =>
            route.fulfill({
              json: {
                id: family.id,
                revision: family.revision,
                name: family.name,
                iconPack: family.iconPack,
                source: "builtin",
                requestedScheme: scheme,
                scheme,
                manifest: family.schemes[scheme as keyof typeof family.schemes],
                fonts: [],
                assets: [],
              },
            }),
          );
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(`/analytics?workspace=${workspace.id}`);
        const section = page.locator('section[aria-labelledby="analytics-content-heading"]');
        const row = page.getByTestId("analytics-content-row").first();
        await expect(row).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme-id", themeID);
        await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
        await page.getByRole("img", { name: "Daily views" }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("chart.png") });
        await section
          .locator("h2")
          .evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: testInfo.outputPath("results.png") });
        for (const action of await row.getByRole("button").all()) {
          const bounds = await action.boundingBox();
          const rowBounds = await row.boundingBox();
          if (width < 768) expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.x).toBeGreaterThanOrEqual(rowBounds!.x);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(rowBounds!.x + rowBounds!.width);
        }
        const details = row.locator("button[aria-expanded]");
        await details.focus();
        await page.keyboard.press("Enter");
        await expect(details).toHaveAttribute("aria-expanded", "true");
        await expect(
          page.locator(`[id="${await details.getAttribute("aria-controls")}"]`),
        ).toBeVisible();
        await details.click();
        await expect(details).toHaveAttribute("aria-expanded", "false");
        const source = page.getByRole("group", { name: "Content source" });
        const filtered = page.waitForRequest(
          (req) =>
            req.url().includes("/analytics?") &&
            new URL(req.url()).searchParams.get("source") === "external",
        );
        await source.getByRole("button", { name: "Elsewhere", exact: true }).click();
        await filtered;
        await expect(
          source.getByRole("button", { name: "Elsewhere", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
      });
    });
  }
}

test("Developer shortcut uses the theme chevron and opens from the keyboard", async ({
  page,
  request,
}, testInfo) => {
  const { token } = await registerUser(request, `account-chevron-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, token, "Account disclosure");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authenticatePage(page, token);
  await page.route("**/api/v1/accounts?**", (route) =>
    route.fulfill({
      json: [
        {
          id: "account-x",
          workspace_id: workspace.id,
          platform: "x",
          account_username: "rodrgds",
          account_name: "Rodrigo",
          slug: "main-x",
          disabled: false,
          created_at: "2026-09-01T12:00:00Z",
        },
      ],
    }),
  );
  await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
  await page.goto("/settings?tab=accounts");
  await page.getByTestId("account-card-account-x").getByRole("button").click();
  await page.getByRole("menuitem", { name: "Account details", exact: true }).click();
  const summary = page.locator("summary").filter({ hasText: "Developer shortcut" });
  await summary.scrollIntoViewIfNeeded();
  await page
    .getByTestId("account-settings-drawer")
    .screenshot({ path: testInfo.outputPath("shortcut-closed.png") });
  await expect(summary.locator('svg[data-theme-icon="chevron-down"]')).toBeVisible();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#account-slug")).toBeVisible();
  await page
    .getByTestId("account-settings-drawer")
    .screenshot({ path: testInfo.outputPath("shortcut-open.png") });
  await page.keyboard.press("Enter");
  await expect(page.locator("#account-slug")).not.toBeVisible();
});
