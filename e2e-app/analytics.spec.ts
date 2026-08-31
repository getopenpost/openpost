import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("analytics keeps provider metrics distinct across desktop and phone layouts", async ({
  page,
  request,
}, testInfo) => {
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
    requestedRanges.push(requestURL.searchParams.get("days") ?? "");
    await route.fulfill({
      contentType: "application/json",
      json: {
        generated_at: "2026-07-26T12:00:00Z",
        last_synced_at: "2026-07-26T11:55:00Z",
        range_days: Number(requestURL.searchParams.get("days") ?? "30"),
        content_total: 2,
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
  const launch = page.getByRole("article").filter({ hasText: "Launch notes" });
  const walkthrough = page.getByRole("article").filter({ hasText: "Product walkthrough" });
  await page.screenshot({ path: testInfo.outputPath("analytics-1280-overview.png") });
  await expect(launch.getByText("58", { exact: true })).toBeVisible();
  await expect(walkthrough.getByText("5.1K")).toBeVisible();
  await expect(walkthrough.getByText("—", { exact: true })).toBeVisible();
  await walkthrough.getByRole("button", { name: "Show platform details" }).click();
  await expect(walkthrough.getByText("OpenPost")).toBeVisible();
  await expect(walkthrough.getByRole("button", { name: "Hide platform details" })).toBeVisible();
  const youtubeNativePost = walkthrough.getByRole("link", {
    name: "Open post on platform",
  });
  await expect(youtubeNativePost).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=video-1",
  );
  await expect(youtubeNativePost).toHaveAttribute("target", "_blank");
  await expect(youtubeNativePost).toHaveCSS("width", "28px");
  await launch.getByRole("button", { name: "Show platform details" }).click();
  await expect(launch.getByText(/Impressions: 8\.8K/u)).toBeVisible();
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
    page.getByText("@video: Reconnect this account to grant: user.info.stats."),
  ).toBeVisible();
  const reconnectNotice = page
    .locator('[data-slot="inline-notice"]')
    .filter({ hasText: "@video: Reconnect this account to grant: user.info.stats." });
  const [reconnectMessageBox, reconnectActionBox] = await Promise.all([
    reconnectNotice
      .getByText("@video: Reconnect this account to grant: user.info.stats.", { exact: true })
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
  }
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Analytics", exact: true })).toBeVisible();
  expect({ consoleErrors, unauthorizedResponses }).toEqual({
    consoleErrors: [],
    unauthorizedResponses: [],
  });
});
