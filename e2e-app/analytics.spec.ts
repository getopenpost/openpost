import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("analytics keeps provider metrics distinct across desktop and phone layouts", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  const unauthorizedResponses: string[] = [];
  const requestedRanges: string[] = [];
  let refreshRequests = 0;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() === 401) unauthorizedResponses.push(response.url());
  });
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `analytics-${unique}@example.com`);
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Analytics E2E",
  )) as { id: string };
  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/analytics**", async (route) => {
    const requestURL = new URL(route.request().url());
    if (
      route.request().method() === "POST" &&
      requestURL.pathname.endsWith("/analytics/refresh")
    ) {
      refreshRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        json: { queued: 4, message: "Analytics refresh queued." },
      });
      return;
    }
    requestedRanges.push(requestURL.searchParams.get("days") ?? "");
    await route.fulfill({
      contentType: "application/json",
      json: {
        generated_at: "2026-07-26T12:00:00Z",
        last_synced_at: "2026-07-26T11:55:00Z",
        range_days: Number(requestURL.searchParams.get("days") ?? "30"),
        summary: {
          followers: { value: 1240, delta: 40, measured: 1 },
          engagement: { value: 58, measured: 1 },
          views: { value: 5100, measured: 1 },
          impressions: { value: 8800, measured: 1 },
          reach: { value: 0, measured: 0 },
          published: 2,
        },
        follower_series: [
          { date: "2026-07-01", value: 1200 },
          { date: "2026-07-14", value: 1222 },
          { date: "2026-07-26", value: 1240 },
        ],
        accounts: [
          {
            id: "account-x",
            platform: "x",
            username: "@openpost",
            status: "ok",
            account_supported: true,
            content_supported: true,
            missing_account_scopes: [],
            missing_content_scopes: [],
            metrics: { followers: 1240, posts: 80 },
            follower_delta: 40,
            follower_series: [
              { date: "2026-07-01", value: 1200 },
              { date: "2026-07-14", value: 1222 },
              { date: "2026-07-26", value: 1240 },
            ],
            last_synced_at: "2026-07-26T11:55:00Z",
          },
          {
            id: "account-tiktok",
            platform: "tiktok",
            username: "@video",
            status: "permission_required",
            error_code: "missing_scope",
            error_message: "Reconnect this account to grant: user.info.stats.",
            account_supported: true,
            content_supported: true,
            missing_account_scopes: ["user.info.stats"],
            missing_content_scopes: ["video.list"],
            metrics: {},
            follower_series: [],
          },
          ...Array.from({ length: 7 }, (_, index) => ({
            id: `account-mastodon-${index}`,
            platform: "mastodon",
            username: `@community-${index}`,
            status: "ok",
            account_supported: true,
            content_supported: true,
            missing_account_scopes: [],
            missing_content_scopes: [],
            metrics: { followers: 80 + index },
            follower_delta: index,
            follower_series: [],
            last_synced_at: "2026-07-26T11:55:00Z",
          })),
        ],
        content: [
          {
            publication_id: "publication-1",
            rendition_id: "rendition-x",
            title: "Launch notes",
            platform: "x",
            account_id: "account-x",
            username: "@openpost",
            published_at: "2026-07-25T09:00:00Z",
            status: "ok",
            metrics: {
              likes: 40,
              comments: 10,
              reposts: 8,
              impressions: 8800,
            },
            engagement: 58,
            last_synced_at: "2026-07-26T11:55:00Z",
          },
          {
            publication_id: "publication-2",
            rendition_id: "rendition-youtube",
            title: "Product walkthrough",
            platform: "youtube",
            account_id: "account-x",
            username: "OpenPost",
            published_at: "2026-07-24T09:00:00Z",
            status: "ok",
            metrics: { views: 5100 },
            engagement: 0,
            last_synced_at: "2026-07-26T11:54:00Z",
          },
        ],
        publications: [
          {
            publication_id: "publication-1",
            title: "Launch notes",
            excerpt: "OpenPost now keeps one result across destinations.",
            published_at: "2026-07-25T09:00:00Z",
            metrics: {
              likes: 40,
              comments: 10,
              reposts: 8,
              impressions: 8800,
            },
            measured: {
              likes: 1,
              comments: 1,
              reposts: 1,
              impressions: 1,
            },
            engagement: 58,
            engagement_measured: 1,
            renditions: [
              {
                publication_id: "publication-1",
                rendition_id: "rendition-x",
                title: "Launch notes",
                excerpt: "OpenPost now keeps one result across destinations.",
                platform: "x",
                account_id: "account-x",
                username: "@openpost",
                external_url: "https://x.com/openpost/status/1",
                published_at: "2026-07-25T09:00:00Z",
                status: "ok",
                metrics: {
                  likes: 40,
                  comments: 10,
                  reposts: 8,
                  impressions: 8800,
                },
                engagement: 58,
                last_synced_at: "2026-07-26T11:55:00Z",
              },
            ],
          },
          {
            publication_id: "publication-2",
            title: "Product walkthrough",
            excerpt: "A complete product walkthrough.",
            published_at: "2026-07-24T09:00:00Z",
            metrics: { views: 5100 },
            measured: { views: 1 },
            engagement: 0,
            engagement_measured: 0,
            renditions: [
              {
                publication_id: "publication-2",
                rendition_id: "rendition-youtube",
                title: "Product walkthrough",
                excerpt: "A complete product walkthrough.",
                platform: "youtube",
                account_id: "account-x",
                username: "OpenPost",
                published_at: "2026-07-24T09:00:00Z",
                status: "ok",
                metrics: { views: 5100 },
                engagement: 0,
                last_synced_at: "2026-07-26T11:54:00Z",
              },
            ],
          },
        ],
      },
    });
  });

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/analytics?workspace=${workspace.id}`);

  await expect
    .poll(
      async () => ({
        headingCount: await page
          .getByRole("heading", { name: "Analytics" })
          .count(),
        consoleErrors,
        unauthorizedResponses,
        url: page.url(),
      }),
      { timeout: 10_000 },
    )
    .toEqual({
      headingCount: 1,
      consoleErrors: [],
      unauthorizedResponses: [],
      url: expect.stringContaining("/analytics"),
    });
  const launch = page.getByRole("article").filter({ hasText: "Launch notes" });
  const walkthrough = page
    .getByRole("article")
    .filter({ hasText: "Product walkthrough" });
  await expect(launch.getByText("8.8K")).toBeVisible();
  await expect(walkthrough.getByText("5.1K")).toBeVisible();
  await expect(walkthrough.getByText("—", { exact: true })).toBeVisible();
  await walkthrough
    .getByRole("button", { name: "Show platform details" })
    .click();
  await expect(walkthrough.getByText("OpenPost")).toBeVisible();
  await expect(
    walkthrough.getByRole("button", { name: "Hide platform details" }),
  ).toBeVisible();
  await expect(
    page.getByText("Two measurements are needed to show a trend."),
  ).toHaveCount(0);
  await expect(page.locator('[data-slot="chart"]')).toBeVisible();
  await expect(page.locator('[data-slot="chart"]')).toHaveAttribute(
    "data-chart",
    /^chart-/,
  );
  await expect(
    page.getByText(
      "Views are provider-counted plays or opens. Impressions are times content was shown.",
      { exact: false },
    ),
  ).toBeVisible();
  const accountList = page
    .locator('section[aria-labelledby="analytics-accounts-heading"]')
    .locator('[class*="overflow-y-auto"]');
  await expect(accountList).toBeVisible();
  await expect
    .poll(() =>
      accountList.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: /All accounts/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("@video: Reconnect this account to grant: user.info.stats."),
  ).toBeVisible();
  await page.getByRole("button", { name: /7 days/ }).click();
  await expect.poll(() => requestedRanges.at(-1)).toBe("7");

  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(page.getByText("4 analytics checks queued.")).toBeVisible();
  expect(refreshRequests).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("link", { name: /Product walkthrough/ }),
  ).toBeVisible();
  await expect(
    page.locator('section[aria-labelledby="analytics-content-heading"] table'),
  ).toBeHidden();
  await page.getByRole("button", { name: "More" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Analytics", exact: true }),
  ).toBeVisible();
  expect({ consoleErrors, unauthorizedResponses }).toEqual({
    consoleErrors: [],
    unauthorizedResponses: [],
  });
});
