import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
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
    return route.fulfill({
      status: 422,
      json: { detail: "Source fixture reached" },
    });
  });
  const source = {
    type: "openpost",
    publication_id: randomUUID(),
    rendition_id: randomUUID(),
  };
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
for (const scheme of ["light"] as const) {
  for (const width of [390]) {
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
        await page.emulateMedia({
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
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
                  {
                    social_account_id: "inactive-account",
                    platform: "linkedin",
                    display_order: 0,
                  },
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
        const reset = menu.getByRole("checkbox", {
          name: "All accounts",
          exact: true,
        });
        await expect(reset).toBeInViewport();
        if (width < 768)
          expect((await reset.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: testInfo.outputPath("account-reset-menu.png"),
        });
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
