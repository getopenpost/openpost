import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import builtins from "../../apps/server/internal/services/themes/builtins.v1.json" with { type: "json" };
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
    "A long post with enough detail to wrap across many lines. ".repeat(12),
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

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1280, 390, 320]) {
    test.describe(`account filter ${scheme} ${width}`, () => {
      test.use({ colorScheme: scheme, hasTouch: width < 768 });
      test("account filter keeps reset reachable after selecting the last account", async ({
        page,
        request,
      }, testInfo) => {
        const { token } = await registerUser(
          request,
          `analytics-filter-${randomUUID()}@example.com`,
        );
        const workspace = await createWorkspace(request, token, "Analytics filter");
        await authenticatePage(page, token);
        await page.setViewportSize({ width, height: 600 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const requests: string[] = [];
        await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
        await page.route("**/api/v1/analytics?**", (route) => {
          requests.push(new URL(route.request().url()).searchParams.get("account_id") ?? "all");
          return route.fulfill({
            json: {
              range_days: 30,
              content_total: 0,
              summary: {
                followers: { value: 0, measured: 0 },
                engagement: { value: 0, measured: 0 },
                views: { value: 0, measured: 0 },
                impressions: { value: 0, measured: 0 },
                reach: { value: 0, measured: 0 },
                published: 0,
              },
              accounts: Array.from({ length: 9 }, (_, index) => ({
                id: `account-${index}`,
                platform: platforms[index % platforms.length],
                username: `account${index}`,
                status: "ok",
                account_supported: true,
                content_supported: true,
                metrics: {},
              })),
              content: [],
              trends: {},
              insights: [],
            },
          });
        });
        await page.goto(`/analytics?workspace=${workspace.id}`);
        const filter = page.getByRole("button", { name: /^Account filter/ });
        await filter.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await filter.focus();
        await filter.press("Enter");
        await filter.press("End");
        await filter.press("Enter");
        await expect(filter).toContainText("account8");
        await expect.poll(() => requests.at(-1)).toBe("account-8");
        await filter.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await filter.click();
        const menu = page.getByRole("listbox");
        await expect(menu).toBeVisible();
        await expect.poll(async () => (await menu.boundingBox())!.y).toBeGreaterThanOrEqual(0);
        await expect
          .poll(async () => {
            const bounds = (await menu.boundingBox())!;
            return bounds.y + bounds.height;
          })
          .toBeLessThanOrEqual(600);
        await menu.hover();
        await page.mouse.wheel(0, -2000);
        await page.mouse.move(1, 1);
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        const reset = menu.getByRole("option", { name: "All accounts", exact: true });
        await expect(reset).toBeInViewport();
        await expect
          .poll(async () => {
            const bounds = (await reset.boundingBox())!;
            const menuBounds = (await menu.boundingBox())!;
            return (
              bounds.y >= menuBounds.y &&
              bounds.y + bounds.height <= menuBounds.y + menuBounds.height
            );
          })
          .toBe(true);
        if (width < 768) expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: testInfo.outputPath("account-reset-menu.png") });
        if (width < 768) await reset.tap();
        else await reset.click();
        await expect(filter).toContainText("All accounts");
        await filter.focus();
        await filter.press("Enter");
        await filter.press("Escape");
        await expect(filter).toBeFocused();
        expect(errors).toEqual([]);
      });
    });
  }
}

for (const [themeID, scheme] of [
  ["dither", "light"],
  ["dither", "dark"],
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
          `analytics-layout-${width}-${randomUUID()}@example.com`,
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
              content_total: content.length,
              summary: {
                followers: {
                  value:
                    new URL(route.request().url()).searchParams.get("days") === "7" ? 200 : 100,
                  measured: 5,
                },
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
                status: index === 4 ? "permission_required" : "ok",
                error_message: index === 4 ? "Reconnect LinkedIn to collect analytics." : undefined,
                last_synced_at: "2026-09-04T12:00:00Z",
                account_supported: true,
                content_supported: true,
                metrics: { followers: 20 },
              })),
              content,
              trends: { views: trend, engagement: trend, followers: trend },
              insights: [
                {
                  kind: "most_engagement_actions",
                  status: "available",
                  value: 1500,
                  metric: "engagement",
                  content: content[0],
                },
                {
                  kind: "strongest_measured_destination",
                  status: "available",
                  value: 1600,
                  metric: "engagement",
                  account_id: "account-1",
                  platform: "threads",
                  username: "rodrgds",
                },
                {
                  kind: "follower_decline",
                  status: "insufficient_data",
                  reason: "incompatible_semantics",
                  value: 0,
                  metric: "followers",
                },
              ].map((insight) => ({
                ...insight,
                measured_count: 5,
                comparison_sample: 5,
                period: {
                  filter_start: "2026-09-01T00:00:00Z",
                  filter_end: "2026-09-30T00:00:00Z",
                  aggregation: "lifetime_total",
                },
              })),
            },
          }),
        );
        const family = builtins.find((theme) => theme.id === themeID)!;
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
              // SAFETY: Each test case pairs a built-in family with a scheme it declares.
              manifest: family.schemes[scheme as keyof typeof family.schemes],
              fonts: [],
              assets: [],
            },
          }),
        );
        await page.emulateMedia({
          colorScheme: scheme,
          reducedMotion: width === 320 ? "reduce" : "no-preference",
        });
        await page.goto(`/analytics?workspace=${workspace.id}`);
        const section = page.locator('section[aria-labelledby="analytics-content-heading"]');
        const row = page.getByTestId("analytics-content-row").first();
        await expect(row).toBeVisible();
        if (width >= 1200) {
          await expect(page.getByTestId("analytics-content-table-header")).toBeVisible();
        }
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(width < 768 ? 180 : 100);
        const insights = page.locator('section[aria-labelledby="analytics-insights-heading"]');
        expect((await insights.boundingBox())!.height).toBeLessThanOrEqual(width < 768 ? 650 : 330);
        await insights.screenshot({ path: testInfo.outputPath("insights.png") });
        const warning = page.getByText("Reconnect LinkedIn to collect analytics.", {
          exact: false,
        });
        await expect(warning).not.toBeVisible();
        const warnings = page.getByRole("button", { name: /Warnings/ });
        await warnings.focus();
        await warnings.press("Enter");
        await expect(warning).toBeVisible();
        await expect(
          page.getByText("Views are plays or opens reported by the platform.", { exact: false }),
        ).toBeVisible();
        await page
          .locator('[data-slot="popover-content"][aria-label="Data notes"]')
          .screenshot({ path: testInfo.outputPath("warnings.png") });
        await page.keyboard.press("Escape");
        await expect(warnings).toBeFocused();
        await expect(warning).not.toBeVisible();
        await expect(page.getByRole("img", { name: "100", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "7 days", exact: true }).click();
        await expect(page.getByRole("img", { name: "200", exact: true })).toBeVisible();
        let finishRefresh!: () => void;
        const refreshFinished = new Promise<void>((resolve) => {
          finishRefresh = resolve;
        });
        await page.route("**/api/v1/analytics/refresh", async (route) => {
          await refreshFinished;
          await route.fulfill({ json: { queued: 5 } });
        });
        const refresh = page.getByTestId("analytics-refresh");
        await page.evaluate(() => document.fonts.ready);
        const refreshWidth = (await refresh.boundingBox())!.width;
        await refresh.focus();
        await refresh.press("Enter");
        await expect(refresh).toHaveAttribute("aria-busy", "true");
        await expect(refresh).toBeFocused();
        expect((await refresh.boundingBox())!.width).toBe(refreshWidth);
        await expect
          .poll(() =>
            refresh.evaluate((button) =>
              button
                .getAnimations({ subtree: true })
                .every(
                  (animation) =>
                    animation.effect?.getTiming().iterations === Infinity ||
                    animation.playState !== "running",
                ),
            ),
          )
          .toBe(true);
        await page.screenshot({ path: testInfo.outputPath("summary-refreshing.png") });
        finishRefresh();
        await expect(refresh).toHaveAttribute("aria-busy", "false");
        await expect(refresh).toBeFocused();
        expect((await refresh.boundingBox())!.width).toBe(refreshWidth);
        await expect(page.locator("html")).toHaveAttribute("data-theme-id", themeID);
        await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
        const metrics = page.getByRole("group", { name: "Chart metric", exact: true });
        await metrics.scrollIntoViewIfNeeded();
        for (const metric of await metrics.getByRole("button").all()) {
          const bounds = await metric.evaluate((button) => {
            const range = document.createRange();
            range.selectNodeContents(button);
            const label = range.getBoundingClientRect();
            const control = button.getBoundingClientRect();
            return {
              leftInset: label.left - control.left,
              rightInset: control.right - label.right,
              height: control.height,
            };
          });
          expect(bounds.leftInset).toBeGreaterThanOrEqual(4);
          expect(bounds.rightInset).toBeGreaterThanOrEqual(4);
          if (width < 768) expect(bounds.height).toBeGreaterThanOrEqual(44);
        }
        const engagement = metrics.getByRole("button", { name: "Engagement", exact: true });
        await engagement.focus();
        await engagement.press("Enter");
        await expect(engagement).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByRole("img", { name: "Daily engagement", exact: true }),
        ).toBeVisible();
        const views = metrics.getByRole("button", { name: "Views", exact: true });
        await views.focus();
        await views.press("Enter");
        await expect(views).toHaveAttribute("aria-pressed", "true");
        await metrics.screenshot({ path: testInfo.outputPath("metric-controls.png") });
        await page.getByRole("img", { name: "Daily views" }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("chart.png") });
        if (themeID === "dither") {
          const figure = page.getByRole("figure", { name: "Daily views" });
          const day = figure.getByRole("button").nth(width < 768 ? 6 : 15);
          const bar = day.locator("[data-chart-fill]").first();
          const before = await bar.evaluate((el: SVGRectElement) => ({
            x: el.x.baseVal.value,
            y: el.y.baseVal.value,
            height: el.height.baseVal.value,
          }));
          await day.focus();
          await expect(day).toHaveAttribute("data-chart-active", "true");
          const tooltip = figure.getByRole("status");
          await expect(tooltip).toBeVisible();
          const bounds = (await tooltip.boundingBox())!;
          const viewport = (await figure.getByTestId("analytics-chart-scroll").boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(viewport.x);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.x + viewport.width);
          expect(
            await bar.evaluate((el: SVGRectElement) => ({
              x: el.x.baseVal.value,
              y: el.y.baseVal.value,
              height: el.height.baseVal.value,
            })),
          ).toEqual(before);
          await figure.screenshot({
            path: `.impeccable/review/dither-polish/analytics-${width}-${scheme}.png`,
          });
        }
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
        await expect(page.getByRole("group", { name: "Content source" })).toHaveCount(0);
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
  const { token } = await registerUser(request, `account-chevron-${randomUUID()}@example.com`);
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
