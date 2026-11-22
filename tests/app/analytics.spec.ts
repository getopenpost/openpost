import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.describe("analytics date range", () => {
  test.describe(`analytics dates light 1280`, () => {
    test.use({ colorScheme: "light", hasTouch: false });
    test("presets and custom dates apply complete ranges and cancel safely", async ({
      page,
      request,
    }) => {
      const { token } = await registerUser(request, `dates-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, token, "Analytics dates");
      await authenticatePage(page, token);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const ranges: { days: string | null; from: string | null; to: string | null }[] = [];
      await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
      await page.route("**/api/v1/analytics?**", (route) => {
        const q = new URL(route.request().url()).searchParams;
        ranges.push({ days: q.get("days"), from: q.get("from"), to: q.get("to") });
        return route.fulfill({
          json: {
            range_days: Number(q.get("days")),
            accounts: [],
            content: [],
            insights: [],
            trends: {},
            summary: {
              followers: { value: 0, measured: 0 },
              engagement: { value: 0, measured: 0 },
              views: { value: 0, measured: 0 },
              impressions: { value: 0, measured: 0 },
              reach: { value: 0, measured: 0 },
              published: 0,
            },
          },
        });
      });
      await page.goto(`/analytics?workspace=${workspace.id}`);
      const trigger = page.getByRole("button", { name: /^Reporting window:/ });
      await expect(trigger).toContainText("30 days");
      await trigger.click();
      await page.getByRole("button", { name: "Last year", exact: true }).click();
      await expect.poll(() => ranges.at(-1)).toEqual({ days: "365", from: null, to: null });
      await trigger.click();
      await page.getByRole("button", { name: "All time", exact: true }).click();
      await expect.poll(() => ranges.at(-1)).toEqual({ days: "0", from: null, to: null });
      await trigger.focus();
      await trigger.press("Enter");
      await page.getByRole("button", { name: "Custom range", exact: true }).click();
      await page.getByLabel("From", { exact: true }).fill("2026-07-21");
      await page.getByLabel("To", { exact: true }).fill("2026-07-22");
      expect(ranges.at(-1)).toEqual({ days: "0", from: null, to: null });
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect
        .poll(() => ranges.at(-1))
        .toEqual({ days: "30", from: "2026-07-21", to: "2026-07-22" });
      await trigger.click();
      await page.getByLabel("To", { exact: true }).fill("2026-07-20");
      await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(trigger).toBeFocused();
      expect(ranges.at(-1)).toEqual({ days: "30", from: "2026-07-21", to: "2026-07-22" });
      expect(errors).toEqual([]);
    });
  });
});

test.describe("analytics layout", () => {
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
  test.describe(`account filter light 390`, () => {
    test.use({ colorScheme: "light", hasTouch: true });
    test("account filter keeps reset reachable after selecting the last account", async ({
      page,
      request,
    }) => {
      const { token } = await registerUser(request, `analytics-filter-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, token, "Analytics filter");
      await authenticatePage(page, token);
      await page.setViewportSize({ width: 390, height: 600 });
      await page.emulateMedia({
        colorScheme: "light",
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
      expect((await reset.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
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

  test("Developer shortcut uses the theme chevron and opens from the keyboard", async ({
    page,
    request,
  }) => {
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
    await expect(summary.locator('svg[data-theme-icon="chevron-down"]')).toBeVisible();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#account-slug")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#account-slug")).not.toBeVisible();
  });
});
