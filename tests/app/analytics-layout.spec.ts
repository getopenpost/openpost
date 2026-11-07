import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import builtins from "../../apps/server/internal/services/themes/builtins.v1.json" with { type: "json" };
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const platforms = ["x", "threads", "bluesky", "mastodon", "linkedin"];

test("native repurpose restores its authorized Workspace before resolving the source", async ({
  page,
  request,
}) => {
  const { token } = await registerUser(request, `analytics-handoff-${randomUUID()}@example.com`);
  const first = await createWorkspace(request, token, "Browser workspace");
  const target = await createWorkspace(request, token, "Native workspace");
  await authenticatePage(page, token);
  await page.addInitScript((workspace) => {
    localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
  }, first);
  const reads: string[] = [];
  await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/analytics?**", (route) => {
    reads.push(new URL(route.request().url()).searchParams.get("workspace_id") ?? "");
    return route.fulfill({
      json: {
        range_days: 30,
        publication_total: 0,
        content_total: 0,
        accounts: [],
        content: [],
        publications: [],
        insights: [],
        takeaways: [],
        performance: [],
        highlights: [],
        visibility_breakdown: [],
        follower_series: [],
        trends: { followers: [], engagement: [], views: [], visibility: [] },
        summary: {
          followers: { value: 0, measured: 0 },
          engagement: { value: 0, measured: 0 },
          views: { value: 0, measured: 0 },
          visibility: { value: 0, measured: 0 },
          impressions: { value: 0, measured: 0 },
          reach: { value: 0, measured: 0 },
          published: 0,
        },
      },
    });
  });
  let resolved: Record<string, unknown> | undefined;
  await page.route("**/api/v1/analytics/repurpose", (route) => {
    resolved = route.request().postDataJSON();
    return route.fulfill({ status: 422, json: { detail: "Source fixture reached" } });
  });
  const source = { type: "openpost", publication_id: randomUUID(), rendition_id: randomUUID() };
  const query = new URLSearchParams({
    workspace: target.id,
    repurpose_type: source.type,
    repurpose_publication_id: source.publication_id,
    repurpose_rendition_id: source.rendition_id,
    days: "30",
  });
  await page.goto(`/analytics?${query}`);
  await expect
    .poll(() => resolved, { timeout: 15_000 })
    .toEqual({
      workspace_id: target.id,
      reference: source,
      range: { days: 30 },
    });
  expect(reads).toContain(target.id);
  expect(page.url()).not.toContain("repurpose_type");
});
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
          requests.push(new URL(route.request().url()).searchParams.get("account_ids") ?? "all");
          return route.fulfill({
            json: {
              range_days: 30,
              content_total: 0,
              summary: {
                followers: { value: 0, measured: 0 },
                engagement: { value: 0, measured: 0 },
                views: { value: 0, measured: 0 },
                impressions: { value: 774, measured: 16 },
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
        await page.route("**/api/v1/social-sets?**", (route) =>
          route.fulfill({
            json: [
              {
                id: "historical-set",
                workspace_id: workspace.id,
                name: "Historical set",
                is_default: false,
                accounts: [
                  { social_account_id: "inactive-account", platform: "linkedin", display_order: 0 },
                ],
                created_at: "2026-09-01T00:00:00Z",
                updated_at: "2026-09-01T00:00:00Z",
              },
            ],
          }),
        );
        await page.goto(`/analytics?workspace=${workspace.id}`);
        const filter = page.getByRole("button", { name: /^Account filter/ });
        await filter.click();
        const menu = page
          .locator('[data-slot="popover-content"]')
          .filter({ hasText: "Account filter" });
        await menu.getByRole("searchbox").fill("account8");
        await menu.getByRole("checkbox", { name: /account8/ }).click();
        await expect.poll(() => requests.at(-1)).toBe("account-8");
        await menu.getByRole("searchbox").fill("account2");
        await menu.getByRole("checkbox", { name: /account2/ }).click();
        await expect.poll(() => requests.at(-1)).toBe("account-2,account-8");
        await expect(filter).toContainText("2 accounts");
        await expect(page.getByText(/^Impressions/)).toHaveCount(0);
        const reset = menu.getByRole("checkbox", { name: "All accounts", exact: true });
        await expect(reset).toBeInViewport();
        if (width < 768)
          expect((await reset.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: testInfo.outputPath("account-reset-menu.png") });
        await reset.click();
        await expect(filter).toContainText("All accounts");
        await page.keyboard.press("Escape");
        await expect(filter).toBeFocused();
        await page.getByRole("button", { name: /^Reporting window:/ }).click();
        await page.getByRole("button", { name: "7 days", exact: true }).click();
        await expect.poll(() => requests.at(-1)).toBe("all");
        await filter.click();
        await menu.getByRole("button", { name: "Historical set", exact: true }).click();
        await expect.poll(() => requests.at(-1)).toBe("inactive-account");
        await expect(filter).toContainText("Historical set");
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
              publication_total: content.length,
              highlights: content.slice(0, 2),
              summary: {
                followers: {
                  value:
                    new URL(route.request().url()).searchParams.get("days") === "7" ? 200 : 100,
                  measured: 5,
                },
                engagement: { value: 30, measured: 5 },
                visibility: { value: 6000, measured: 5 },
                views: { value: 6000, measured: 5 },
                impressions: { value: 774, measured: 16 },
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
              trends: { views: trend, visibility: trend, engagement: trend, followers: trend },
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
        await expect(page.getByRole("heading", { name: "What to do next" })).toHaveCount(0);
        await expect(page.locator("summary").filter({ hasText: "Data notes" })).toHaveCount(0);
        const section = page.locator('section[aria-labelledby="analytics-content-heading"]');
        const row = page.getByTestId("analytics-content-row").first();
        await expect(row).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page
          .getByRole("heading", { name: "Analytics", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("overview.png") });
        // The shell owns scrolling: the document must not grow past the viewport
        // while the page content is taller than it.
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight))
          .toBe(true);
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
        const audience = page.locator('section[aria-labelledby="analytics-composition-heading"]');
        const highlights = page.getByRole("heading", { name: "Top posts", exact: true });
        expect((await audience.boundingBox())!.y).toBeLessThan((await highlights.boundingBox())!.y);
        const exportButton = page.getByTestId("analytics-export");
        expect((await exportButton.boundingBox())!.width).toBeLessThanOrEqual(44);
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
        const metricGroup = page.getByRole("group", { name: "Chart metric", exact: true });
        await expect(metricGroup).toContainText("100");
        await page.getByRole("button", { name: /^Reporting window:/ }).click();
        await page.getByRole("button", { name: "7 days", exact: true }).click();
        await expect(metricGroup).toContainText("200");
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
        expect(
          await metrics.evaluate(
            (group) =>
              group.getBoundingClientRect().right <=
              group.closest("section")!.getBoundingClientRect().right,
          ),
        ).toBe(true);
        for (const metric of await metrics.getByRole("button").all()) {
          const bounds = await metric.evaluate((button) => {
            // Measure the visible text only; decorative dither surfaces run edge to edge.
            const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
            let left = Infinity;
            let right = -Infinity;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!node.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              const rect = range.getBoundingClientRect();
              if (rect.width === 0) continue;
              left = Math.min(left, rect.left);
              right = Math.max(right, rect.right);
            }
            const control = button.getBoundingClientRect();
            return {
              leftInset: left - control.left,
              rightInset: control.right - right,
              height: control.height,
            };
          });
          expect(bounds.leftInset).toBeGreaterThanOrEqual(4);
          expect(bounds.rightInset).toBeGreaterThanOrEqual(4);
          if (width < 768) expect(bounds.height).toBeGreaterThanOrEqual(44);
        }
        const engagement = metrics.getByRole("button", { name: /^Engagement/ });
        await engagement.focus();
        await engagement.press("Enter");
        await expect(engagement).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByRole("group", { name: "Daily engagement", exact: true }),
        ).toBeVisible();
        const views = metrics.getByRole("button", { name: /^Visibility/ });
        await views.focus();
        await views.press("Enter");
        await expect(views).toHaveAttribute("aria-pressed", "true");
        await metrics.screenshot({ path: testInfo.outputPath("metric-controls.png") });
        await page.getByRole("group", { name: "Visibility", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("chart.png") });
        if (themeID === "dither") {
          // Keyboard scrubbing shows a readout that stays inside the chart at every width.
          const chart = page.getByRole("group", { name: "Visibility", exact: true });
          await chart.focus();
          await chart.press("End");
          const readout = chart.locator('[data-slot="chart-readout"]');
          await expect(readout).toHaveCSS("opacity", "1");
          const bounds = (await readout.boundingBox())!;
          const frame = (await chart.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(frame.x - 1);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
          await chart.press("Home");
          // The first day is announced with every network's value.
          await expect(chart.locator("xpath=..").locator('[aria-live="polite"]')).toHaveText(
            /^\S+ \d+: .+ \d/,
          );
          await chart.press("Escape");
          await expect(readout).toHaveCSS("opacity", "0");
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
