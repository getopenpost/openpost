import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("analytics keeps provider metrics distinct across desktop and phone layouts", async ({
  page,
  request,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const unauthorizedResponses: string[] = [];
  const requestedRanges: string[] = [];
  const requestedSources: string[] = [];
  let refreshRequests = 0;
  let repurposeRequests = 0;
  let automaticBuilderRequests = 0;
  let automaticDraftRequests = 0;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() === 401) unauthorizedResponses.push(response.url());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      (url.pathname.includes("/post-builder") || url.pathname.includes("/publication-builds"))
    ) {
      automaticBuilderRequests += 1;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/publications")) {
      automaticDraftRequests += 1;
    }
  });
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `analytics-${unique}@example.com`);
  // SAFETY: createWorkspace throws unless the API returns a workspace object with its required ID.
  const workspace = (await createWorkspace(request, auth.token, "Analytics E2E")) as { id: string };
  await authenticatePage(page, auth.token);
  await page.route("https://cdn.openpost.test/account-avatar.svg", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#ea580c"/><text x="32" y="39" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700" fill="white">OP</text></svg>',
    });
  });
  await page.route("**/api/v1/account-features**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });
  await page.route("**/api/v1/analytics**", async (route) => {
    const requestURL = new URL(route.request().url());
    if (route.request().method() === "POST" && requestURL.pathname.endsWith("/analytics/refresh")) {
      refreshRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        json: { queued: 4, message: "Analytics refresh queued." },
      });
      return;
    }
    if (
      route.request().method() === "POST" &&
      requestURL.pathname.endsWith("/analytics/repurpose")
    ) {
      repurposeRequests += 1;
      const body = route.request().postDataJSON() as {
        workspace_id: string;
        reference: { type: string; publication_id?: string; rendition_id?: string };
        range: { days: number };
      };
      expect(body).toEqual({
        workspace_id: workspace.id,
        reference: {
          type: "openpost",
          publication_id: "publication-1",
          rendition_id: "rendition-x",
        },
        range: { days: 30 },
      });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      await route.fulfill({
        contentType: "application/json",
        json: {
          handoff_id: "handoff-1",
          workspace_id: workspace.id,
          title: "Launch notes",
          source_text: "Bounded stored launch lesson.",
          content_profile: "short_text",
          destination_account_ids: ["account-x"],
          range: { days: 30 },
          provenance: {
            origin: "openpost",
            platform: "x",
            published_at: "2026-07-25T09:00:00Z",
            reference: body.reference,
          },
          evidence: [
            {
              metric: "impressions",
              value: 8800,
              collected_at: "2026-07-26T11:55:00Z",
              metadata: { unit: "count", aggregation: "lifetime_total", source: "x" },
            },
          ],
        },
      });
      return;
    }
    requestedRanges.push(requestURL.searchParams.get("days") ?? "");
    requestedSources.push(requestURL.searchParams.get("source") ?? "");
    await route.fulfill({
      contentType: "application/json",
      json: {
        generated_at: "2026-07-26T12:00:00Z",
        last_synced_at: "2026-07-26T11:55:00Z",
        range_days: Number(requestURL.searchParams.get("days") ?? "30"),
        source: "all",
        account_growth_scope: "account_wide",
        content_total: 4,
        content_next_cursor: requestURL.searchParams.has("cursor") ? undefined : "page-2",
        summary: {
          followers: { value: 1240, delta: 40, measured: 1 },
          engagement: { value: 62, measured: 2 },
          views: { value: 5100, measured: 1 },
          impressions: { value: 8800, measured: 1 },
          reach: { value: 0, measured: 0 },
          follower_scope: "account_wide",
          published: 3,
        },
        follower_series: [
          { date: "2026-07-01", value: 1200 },
          { date: "2026-07-14", value: 1222 },
          { date: "2026-07-26", value: 1240 },
        ],
        trends: {
          followers: [
            {
              date: "2026-07-14",
              value: 22,
              items: [
                {
                  key: "account-x",
                  label: "@openpost",
                  platform: "x",
                  value: 22,
                },
              ],
            },
            {
              date: "2026-07-26",
              value: 18,
              items: [
                {
                  key: "account-x",
                  label: "@openpost",
                  platform: "x",
                  value: 18,
                },
              ],
            },
          ],
          engagement: [
            {
              date: "2026-07-25",
              value: 58,
              items: [
                {
                  key: "rendition-x",
                  label: "Launch notes",
                  platform: "x",
                  publication_id: "publication-1",
                  value: 58,
                },
              ],
            },
          ],
          views: [
            {
              date: "2026-07-20",
              value: 420,
              items: [
                {
                  key: "rendition-youtube",
                  label: "Product walkthrough",
                  platform: "youtube",
                  publication_id: "publication-2",
                  value: 420,
                },
              ],
            },
            {
              date: "2026-07-21",
              value: 690,
              items: [
                {
                  key: "rendition-youtube",
                  label: "Product walkthrough",
                  platform: "youtube",
                  publication_id: "publication-2",
                  value: 690,
                },
              ],
            },
            {
              date: "2026-07-22",
              value: 540,
              items: [
                {
                  key: "rendition-x",
                  label: "Launch notes",
                  platform: "x",
                  publication_id: "publication-1",
                  value: 540,
                },
              ],
            },
            {
              date: "2026-07-23",
              value: 980,
              items: [
                {
                  key: "rendition-youtube",
                  label: "Product walkthrough",
                  platform: "youtube",
                  publication_id: "publication-2",
                  value: 980,
                },
              ],
            },
            {
              date: "2026-07-24",
              value: 1210,
              items: [
                {
                  key: "rendition-youtube",
                  label: "Product walkthrough",
                  platform: "youtube",
                  publication_id: "publication-2",
                  value: 640,
                },
                {
                  key: "rendition-x",
                  label: "Launch notes",
                  platform: "x",
                  publication_id: "publication-1",
                  value: 570,
                },
              ],
            },
            {
              date: "2026-07-25",
              value: 760,
              items: [
                {
                  key: "rendition-x",
                  label: "Launch notes",
                  platform: "x",
                  publication_id: "publication-1",
                  value: 760,
                },
              ],
            },
            {
              date: "2026-07-26",
              value: 500,
              items: [
                {
                  key: "rendition-youtube",
                  label: "Product walkthrough",
                  platform: "youtube",
                  publication_id: "publication-2",
                  value: 500,
                },
              ],
            },
          ],
        },
        accounts: [
          {
            id: "account-x",
            platform: "x",
            username: "openpost",
            avatar_url: "https://cdn.openpost.test/account-avatar.svg",
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
            username: "video",
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
            username: `community-${index}`,
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
        coverage: [
          {
            account_id: "account-x",
            platform: "x",
            status: "partial",
            description: "Initial discovery stopped after the 250-item account history limit.",
            backfill_watermark: "2026-04-27T12:00:00Z",
            initial_items_discovered: 250,
            initial_completed_at: "2026-07-26T11:55:00Z",
            last_success_at: "2026-07-26T11:55:00Z",
          },
          {
            account_id: "account-tiktok",
            platform: "tiktok",
            status: "unsupported",
            description: "Account content discovery is not available for this provider.",
            initial_items_discovered: 0,
          },
          {
            account_id: "account-mastodon-0",
            platform: "mastodon",
            status: "partial",
            description: "Building account history for up to the last 90 days and 250 items.",
            backfill_watermark: "2026-04-27T12:00:00Z",
            initial_items_discovered: 12,
            last_success_at: "2026-07-26T11:50:00Z",
          },
        ],
        content: requestURL.searchParams.has("cursor")
          ? [
              {
                reference: { type: "external", account_content_id: "external-2" },
                source: "external",
                title: "Earlier account update",
                excerpt: "An older stored account result.",
                content_profile: "short_text",
                platform: "x",
                account_id: "account-x",
                username: "@openpost",
                external_url: "https://x.com/openpost/status/2",
                published_at: "2026-07-22T09:00:00Z",
                status: "ok",
                metric_availability: "available",
                collected_at: "2026-07-26T11:52:00Z",
                metrics: { likes: 2 },
                metric_metadata: {
                  likes: { unit: "count", aggregation: "lifetime_total", source: "x" },
                },
                measurements: {},
                engagement: 2,
                last_synced_at: "2026-07-26T11:52:00Z",
                stale: false,
              },
            ]
          : [
              {
                reference: {
                  type: "openpost",
                  publication_id: "publication-1",
                  rendition_id: "rendition-x",
                },
                source: "openpost",
                publication_id: "publication-1",
                rendition_id: "rendition-x",
                title: "Launch notes",
                excerpt: "OpenPost now keeps one result across destinations.",
                content_profile: "short_text",
                platform: "x",
                account_id: "account-x",
                username: "@openpost",
                external_url: "https://x.com/openpost/status/1",
                published_at: "2026-07-25T09:00:00Z",
                status: "ok",
                metric_availability: "available",
                collected_at: "2026-07-26T11:55:00Z",
                metrics: {
                  likes: 40,
                  comments: 10,
                  reposts: 8,
                  impressions: 8800,
                },
                metric_metadata: {
                  likes: { unit: "count", aggregation: "lifetime_total", source: "x" },
                  comments: { unit: "count", aggregation: "lifetime_total", source: "x" },
                  reposts: { unit: "count", aggregation: "lifetime_total", source: "x" },
                  impressions: { unit: "count", aggregation: "lifetime_total", source: "x" },
                },
                measurements: {},
                engagement: 58,
                last_synced_at: "2026-07-26T11:55:00Z",
                stale: false,
              },
              {
                reference: {
                  type: "openpost",
                  publication_id: "publication-2",
                  rendition_id: "rendition-youtube",
                },
                source: "openpost",
                publication_id: "publication-2",
                rendition_id: "rendition-youtube",
                title: "Product walkthrough",
                excerpt: "A complete product walkthrough.",
                content_profile: "long_video",
                platform: "youtube",
                account_id: "account-x",
                username: "OpenPost",
                external_url: "https://www.youtube.com/watch?v=video-1",
                published_at: "2026-07-24T09:00:00Z",
                status: "ok",
                metric_availability: "available",
                collected_at: "2026-07-26T11:54:00Z",
                metrics: { views: 5100 },
                metric_metadata: {
                  views: { unit: "count", aggregation: "lifetime_total", source: "youtube" },
                },
                measurements: {},
                engagement: 0,
                last_synced_at: "2026-07-26T11:54:00Z",
                stale: false,
              },
              {
                reference: { type: "external", account_content_id: "external-1" },
                source: "external",
                title: "Published elsewhere update",
                excerpt: "An update published directly on YouTube.",
                content_profile: "long_video",
                platform: "youtube",
                account_id: "account-x",
                username: "OpenPost",
                external_url: "https://www.youtube.com/watch?v=external-1",
                published_at: "2026-07-23T09:00:00Z",
                status: "ok",
                metric_availability: "available",
                collected_at: "2026-07-26T11:53:00Z",
                metrics: { likes: 4 },
                metric_metadata: {
                  likes: { unit: "count", aggregation: "lifetime_total", source: "youtube" },
                },
                measurements: {},
                engagement: 4,
                last_synced_at: "2026-07-26T11:53:00Z",
                stale: false,
              },
            ],
        insights: [
          {
            kind: "most_engagement_actions",
            status: "available",
            period: {
              filter_start: "2026-06-26T12:00:00Z",
              filter_end: "2026-07-26T12:00:00Z",
              aggregation: "lifetime_total",
            },
            metric: "engagement_actions",
            value: requestURL.searchParams.has("cursor") ? 999 : 58,
            measured_count: 2,
            comparison_sample: 3,
            account_id: "account-x",
            platform: "x",
            username: "@openpost",
            caveat: "filtered_content_lifetime_totals",
            content: {
              reference: {
                type: "openpost",
                publication_id: "publication-1",
                rendition_id: "rendition-x",
              },
              source: "openpost",
              title: "Launch notes",
              excerpt: "OpenPost now keeps one result across destinations.",
              platform: "x",
              account_id: "account-x",
              username: "@openpost",
              published_at: "2026-07-25T09:00:00Z",
              collected_at: "2026-07-26T11:55:00Z",
            },
          },
          {
            kind: "strongest_measured_destination",
            status: "insufficient_data",
            reason: "low_sample",
            period: {
              filter_start: "2026-06-26T12:00:00Z",
              filter_end: "2026-07-26T12:00:00Z",
              aggregation: "lifetime_total",
            },
            metric: "engagement_actions",
            measured_count: 2,
            comparison_sample: 3,
            destination_count: 1,
          },
          {
            kind: "follower_decline",
            status: "insufficient_data",
            reason: "no_decline",
            period: {
              filter_start: "2026-06-26T12:00:00Z",
              filter_end: "2026-07-26T12:00:00Z",
              aggregation: "current_snapshot",
            },
            metric: "followers",
            caveat: "account_wide",
            measured_count: 1,
            comparison_sample: 9,
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
                reference: {
                  type: "openpost",
                  publication_id: "publication-1",
                  rendition_id: "rendition-x",
                },
                source: "openpost",
                content_profile: "short_text",
                measurements: {},
                metric_metadata: {},
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
                reference: {
                  type: "openpost",
                  publication_id: "publication-2",
                  rendition_id: "rendition-youtube",
                },
                source: "openpost",
                content_profile: "long_video",
                measurements: {},
                metric_metadata: {},
                title: "Product walkthrough",
                excerpt: "A complete product walkthrough.",
                platform: "youtube",
                account_id: "account-x",
                username: "OpenPost",
                external_url: "https://www.youtube.com/watch?v=video-1",
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
  await page.route("**/api/v1/publications/*/events?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false", "X-Total-Count": "0" },
      json: [],
    });
  });
  await page.route("**/api/v1/publications/publication-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: "publication-1",
        workspace_id: workspace.id,
        created_by: "user-1",
        status: "published",
        intent: "post",
        content_profile: "text",
        creation_preset: "manual",
        title: "Launch notes",
        source_text: "Launch notes are live.",
        metadata: {},
        segments: [],
        media: [],
        renditions: [
          {
            id: "rendition-1",
            publication_id: "publication-1",
            social_account_id: "account-x",
            platform: "x",
            profile: "text",
            output_profile: "text",
            status: "published",
            title: "",
            body: "Launch notes are live.",
            description: "",
            settings: {},
            segments: [],
            media: [],
            format_locked: false,
            error_retryable: false,
            external_url: "https://x.com/openpost/status/1",
          },
        ],
        repost_override: {},
        revision: 1,
        actual_run_at: "2026-07-25T09:00:00Z",
        created_at: "2026-07-25T08:00:00Z",
        updated_at: "2026-07-25T09:00:00Z",
      },
    });
  });

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/analytics?workspace=${workspace.id}`);

  await expect
    .poll(
      async () => ({
        headingCount: await page.getByRole("heading", { name: "Analytics" }).count(),
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
  const contentRows = page.getByTestId("analytics-content-row");
  const launch = contentRows.filter({ hasText: "Launch notes" });
  const walkthrough = contentRows.filter({ hasText: "Product walkthrough" });
  const externalUpdate = contentRows.filter({ hasText: "Published elsewhere update" });
  const tableHeader = page.getByTestId("analytics-content-table-header");
  await expect(tableHeader).toBeVisible();
  const [postHeader, destinationsHeader, engagementHeader, viewsHeader, publishedHeader] =
    await Promise.all(
      [
        tableHeader.getByText("Post", { exact: true }),
        tableHeader.getByText("Destinations", { exact: true }),
        tableHeader.getByText("Engagement", { exact: true }),
        tableHeader.getByText("Views", { exact: true }),
        tableHeader.getByText("Published", { exact: true }),
      ].map((locator) => locator.boundingBox()),
    );
  const [postValue, destinationsValue, engagementValue, viewsValue, publishedValue] =
    await Promise.all(
      [
        launch.getByRole("link", { name: "Launch notes" }),
        launch.getByTestId("analytics-row-destinations"),
        launch.getByText("58", { exact: true }),
        launch.getByText("—", { exact: true }),
        launch.locator(".analytics-published"),
      ].map((locator) => locator.boundingBox()),
    );
  for (const box of [
    postHeader,
    destinationsHeader,
    engagementHeader,
    viewsHeader,
    publishedHeader,
    postValue,
    destinationsValue,
    engagementValue,
    viewsValue,
    publishedValue,
  ]) {
    expect(box).not.toBeNull();
  }
  expect(Math.abs(postHeader!.x - postValue!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(destinationsHeader!.x - destinationsValue!.x)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      engagementHeader!.x + engagementHeader!.width - engagementValue!.x - engagementValue!.width,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(viewsHeader!.x + viewsHeader!.width - viewsValue!.x - viewsValue!.width),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(publishedHeader!.x - publishedValue!.x)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("analytics-1280-overview.png") });
  await page.getByRole("heading", { name: "Post results" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("analytics-1280-results.png") });
  await page.getByRole("heading", { name: "Analytics" }).scrollIntoViewIfNeeded();
  await expect(launch.getByText("58", { exact: true })).toBeVisible();
  await expect(walkthrough.getByText("5.1K")).toBeVisible();
  await expect(walkthrough.getByText("—", { exact: true })).toBeVisible();
  await expect(launch.getByText("Published with OpenPost", { exact: true })).toBeVisible();
  await expect(externalUpdate.getByText("Published elsewhere", { exact: true })).toBeVisible();
  for (const forbiddenAction of ["Edit", "Schedule", "Retry", "Delivery"]) {
    await expect(
      externalUpdate.getByRole("button", { name: forbiddenAction, exact: true }),
    ).toHaveCount(0);
    await expect(
      externalUpdate.getByRole("link", { name: forbiddenAction, exact: true }),
    ).toHaveCount(0);
  }
  await expect(
    page.getByText("Showing 3 of 4 stored results for this selection", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Showing 3 of 4 results", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Building account history" })).toBeVisible();
  await expect(page.getByTestId("analytics-coverage-account-x")).toContainText("Partial coverage");
  await expect(page.getByTestId("analytics-coverage-account-x")).toContainText("250-item");
  await expect(page.getByTestId("analytics-coverage-account-x")).toContainText(
    "Stored results may not include the whole account.",
  );
  await expect(page.getByTestId("analytics-coverage-account-tiktok")).toContainText(
    "History unavailable",
  );
  const mostEngagementInsight = page.getByTestId("analytics-insight-most_engagement_actions");
  await mostEngagementInsight.getByText("Evidence details").click();
  await expect(mostEngagementInsight).toContainText("Published with OpenPost");
  await expect(mostEngagementInsight).toContainText("Metric: Engagement actions");
  await expect(mostEngagementInsight).toContainText("Unit: Count");
  await expect(mostEngagementInsight).toContainText("Aggregation: Lifetime total");
  await expect(mostEngagementInsight).toContainText("Collection time: Jul 26, 11:55 AM");
  await expect(mostEngagementInsight).toContainText(
    "Launch notes: 58 measured engagement actions.",
  );
  await page.getByRole("button", { name: "Load more results" }).click();
  await expect(contentRows.filter({ hasText: "Earlier account update" })).toBeVisible();
  await expect(page.getByText("Showing 4 of 4 stored results for this selection")).toBeVisible();
  await expect(mostEngagementInsight).toContainText(
    "Launch notes: 58 measured engagement actions.",
  );
  await expect(mostEngagementInsight).not.toContainText("999");
  await expect(page.getByTestId("analytics-insight-strongest_measured_destination")).toContainText(
    "At least two measured destinations are needed for a ranking.",
  );
  await page.getByRole("heading", { name: "Measured insights" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("analytics-1280-insights.png") });
  await page.getByRole("button", { name: "Published elsewhere", exact: true }).click();
  await expect.poll(() => requestedSources.at(-1)).toBe("external");
  await expect(
    page.getByRole("button", { name: "Published elsewhere", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const requestsBeforeCachedSelection = requestedSources.length;
  await page.getByRole("button", { name: "All content", exact: true }).click();
  await expect(page.getByRole("button", { name: "All content", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(requestedSources).toHaveLength(requestsBeforeCachedSelection);
  await walkthrough.getByRole("button", { name: "Show destination details" }).click();
  await expect(walkthrough.getByText("Published with OpenPost", { exact: true })).toBeVisible();
  await expect(walkthrough.getByRole("button", { name: "Hide destination details" })).toBeVisible();
  const youtubeNativePost = walkthrough.getByRole("link", {
    name: "Open post on platform",
  });
  await expect(youtubeNativePost).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=video-1",
  );
  await expect(youtubeNativePost).toHaveAttribute("target", "_blank");
  await launch.getByRole("button", { name: "Show destination details" }).click();
  await expect(launch.getByText("Impressions", { exact: true })).toBeVisible();
  await expect(launch.getByText("8.8K", { exact: true })).toBeVisible();
  await expect(launch.getByText("Availability: Available", { exact: true }).first()).toBeVisible();
  await expect(launch.getByText("Unit: Count", { exact: true }).first()).toBeVisible();
  await expect(
    launch.getByText("Aggregation: Lifetime total", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    launch.getByText("Reporting period: No reporting period supplied", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    launch.getByText("Collection time: Jul 26, 11:55 AM", { exact: true }).first(),
  ).toBeVisible();
  await expect(launch.getByRole("link", { name: "Open post on platform" })).toHaveAttribute(
    "href",
    "https://x.com/openpost/status/1",
  );
  await expect(page.getByRole("img", { name: "Daily views" })).toBeVisible();
  const dailyViews = page.getByRole("button", { name: /Jul 24, 1.2K Daily views/u });
  await dailyViews.focus();
  await expect(page.getByText("Product walkthrough").last()).toBeVisible();
  await expect(
    page.getByTestId("analytics-tooltip-platform").filter({ hasText: "Youtube" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Views are plays or opens reported by the platform. Impressions count how often it showed the post.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Account filter")).toContainText("All accounts");
  await page.getByLabel("Account filter").click();
  const openPostAccount = page.getByRole("option", { name: /@openpost.*X/u });
  await expect(openPostAccount).toBeVisible();
  await expect(openPostAccount.locator('[data-slot="avatar-image"]')).toHaveAttribute(
    "src",
    "https://cdn.openpost.test/account-avatar.svg",
  );
  await expect
    .poll(() =>
      openPostAccount
        .locator('[data-slot="avatar-image"]')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await expect(page.getByRole("option", { name: /@video.*TikTok/u })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("analytics-1280-account-filter.png"),
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("@video · TikTok: Reconnect this account to grant: user.info.stats."),
  ).toBeVisible();
  const reconnectNotice = page
    .locator('[data-slot="inline-notice"]')
    .filter({ hasText: "@video · TikTok: Reconnect this account to grant: user.info.stats." });
  const [reconnectMessageBox, reconnectActionBox] = await Promise.all([
    reconnectNotice
      .getByText("@video · TikTok: Reconnect this account to grant: user.info.stats.", {
        exact: true,
      })
      .boundingBox(),
    reconnectNotice.getByRole("link", { name: "Manage accounts" }).boundingBox(),
  ]);
  expect(reconnectMessageBox).not.toBeNull();
  expect(reconnectActionBox).not.toBeNull();
  expect(
    Math.abs(
      reconnectMessageBox!.y +
        reconnectMessageBox!.height / 2 -
        (reconnectActionBox!.y + reconnectActionBox!.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("analytics-1280-chart.png"),
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: testInfo.outputPath("analytics-1280-chart-dark.png"),
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: /7 days/ }).click();
  await expect.poll(() => requestedRanges.at(-1)).toBe("7");

  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(page.getByText("Updating analytics for 4 items.")).toBeVisible();
  expect(refreshRequests).toBe(1);

  await launch.getByRole("link", { name: "Launch notes" }).click();
  await expect(page.getByRole("heading", { name: "Launch notes" })).toBeVisible();
  await expect(
    page.getByText(
      "This post has already been sent to its destinations. OpenPost cannot change the copies on social networks.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await expect(page.getByRole("link", { name: /Product walkthrough/ })).toBeVisible();
    await expect(page.getByTestId("analytics-content-table-header")).toBeHidden();
    await page.getByRole("heading", { name: "Analytics" }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`analytics-${viewport.width}-overview.png`),
    });
    await page.getByRole("region", { name: "Daily views" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`analytics-${viewport.width}-chart.png`) });
    await page.getByRole("heading", { name: "Post results" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`analytics-${viewport.width}-results.png`) });
    for (const filterName of ["All content", "Published with OpenPost", "Published elsewhere"]) {
      const filterBox = await page
        .getByRole("button", { name: filterName, exact: true })
        .boundingBox();
      expect(filterBox?.height).toBeGreaterThanOrEqual(44);
    }
    const [repurposeBox, detailBox] = await Promise.all([
      launch.getByRole("button", { name: "Repurpose" }).boundingBox(),
      page.getByTestId("analytics-details-openpost:rendition-x").boundingBox(),
    ]);
    expect(repurposeBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    expect(repurposeBox!.x).toBeGreaterThanOrEqual(0);
    expect(detailBox!.x + detailBox!.width).toBeLessThanOrEqual(viewport.width);
    await launch.getByRole("button", { name: "Repurpose" }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`analytics-${viewport.width}-actions.png`),
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.screenshot({
      path: testInfo.outputPath(`analytics-${viewport.width}-actions-dark.png`),
    });
    await page.screenshot({
      path: testInfo.outputPath(`analytics-${viewport.width}-results-dark.png`),
    });
    await page.getByRole("heading", { name: "Analytics" }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`analytics-${viewport.width}-overview-dark.png`),
    });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  }
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Analytics", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const repurposeButton = page.getByTestId("analytics-repurpose-openpost:rendition-x");
  await repurposeButton.dblclick();
  await expect(page.getByRole("heading", { name: "Review repurpose direction" })).toBeVisible();
  await expect(page.locator("textarea").first()).toHaveValue("Bounded stored launch lesson.");
  await expect(page).toHaveURL(/\/$/u);
  expect(page.url()).not.toContain("Bounded");
  expect(page.url()).not.toContain("handoff");
  expect(repurposeRequests).toBe(1);
  expect(automaticBuilderRequests).toBe(0);
  expect(automaticDraftRequests).toBe(0);
  expect({ consoleErrors, unauthorizedResponses }).toEqual({
    consoleErrors: [],
    unauthorizedResponses: [],
  });
});
