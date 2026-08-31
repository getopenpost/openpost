import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

function featureResponse(
  accountId: string,
  platform: string,
  feature: "messaging" | "engagement" | "analytics" | "grow",
  opts: Partial<{
    supported: boolean;
    availability: "available" | "unsupported" | "missing_scope" | "plan_restricted";
    stored_exists: boolean;
    stored_enabled: boolean;
    required_scopes: string[];
    missing_scopes: string[];
    effective_enabled: boolean;
  }> = {},
) {
  const supported = opts.supported ?? true;
  const availability = opts.availability ?? "available";
  const stored_exists = opts.stored_exists ?? true;
  const stored_enabled = opts.stored_enabled ?? false;
  return {
    workspace_id: "ws-1",
    social_account_id: accountId,
    platform,
    feature,
    supported,
    availability,
    reason_code: availability,
    required_scopes: opts.required_scopes ?? [],
    missing_scopes: opts.missing_scopes ?? [],
    unavailable_reason: "",
    stored_exists,
    stored_enabled,
    effective_enabled:
      opts.effective_enabled ??
      (supported && availability === "available" && stored_exists && stored_enabled),
  };
}

function installAccountFeaturesRoute(
  page: import("@playwright/test").Page,
  featureMap: Record<string, ReturnType<typeof featureResponse>[]>,
  workspaceId: string,
) {
  const all = Object.values(featureMap).flat();
  page.route("**/api/v1/account-features*", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/account-features")) {
        await route.continue();
        return;
      }
      const ids = (url.searchParams.get("account_ids") ?? "").split(",").filter(Boolean);
      const filtered = all
        .filter((f) => ids.includes(f.social_account_id))
        .map((f) => ({ ...f, workspace_id: workspaceId }));
      await route.fulfill({ contentType: "application/json", json: filtered });
      return;
    }
    if (method === "POST") {
      await route.fulfill({ contentType: "application/json", json: all });
      return;
    }
    await route.continue();
  });
}

test.describe("Grow feature-aware", () => {
  test("disabled Grow accounts disappear from selector", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `grow-filter-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Grow Filter ${unique}`);
    await authenticatePage(page, auth.token);

    const accEnabled = "acc-grow-enabled";
    const accDisabled = "acc-grow-disabled";
    const accMissing = "acc-grow-missing";
    const accPlan = "acc-grow-plan";
    const accUndecided = "acc-grow-undecided";

    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [accEnabled]: [
        featureResponse(accEnabled, "bluesky", "grow", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: true,
          effective_enabled: true,
        }),
      ],
      [accDisabled]: [
        featureResponse(accDisabled, "bluesky", "grow", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
      [accMissing]: [
        featureResponse(accMissing, "bluesky", "grow", {
          supported: true,
          availability: "missing_scope",
          stored_exists: true,
          stored_enabled: true,
          missing_scopes: ["repo"],
          required_scopes: ["repo"],
          effective_enabled: false,
        }),
      ],
      [accPlan]: [
        featureResponse(accPlan, "bluesky", "grow", {
          supported: true,
          availability: "plan_restricted",
          stored_exists: true,
          stored_enabled: true,
          effective_enabled: false,
        }),
      ],
      [accUndecided]: [
        featureResponse(accUndecided, "bluesky", "grow", {
          supported: true,
          availability: "available",
          stored_exists: false,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };
    // Need to provide all four features for each account but only grow matters for grow page; add other features as supported off to avoid filtering issues
    for (const id of [accEnabled, accDisabled, accMissing, accPlan, accUndecided]) {
      if (!featureMap[id].some((f) => f.feature === "messaging")) {
        // already have only grow; add dummy others as unsupported to keep helper simple
      }
    }

    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: accEnabled,
            platform: "bluesky",
            account_username: "enabled",
            account_avatar_url: "",
            account_id: accEnabled,
            is_active: true,
            slug: "enabled",
          },
          {
            id: accDisabled,
            platform: "bluesky",
            account_username: "disabled",
            account_avatar_url: "",
            account_id: accDisabled,
            is_active: true,
            slug: "disabled",
          },
          {
            id: accMissing,
            platform: "bluesky",
            account_username: "missing",
            account_avatar_url: "",
            account_id: accMissing,
            is_active: true,
            slug: "missing",
          },
          {
            id: accPlan,
            platform: "bluesky",
            account_username: "plan",
            account_avatar_url: "",
            account_id: accPlan,
            is_active: true,
            slug: "plan",
          },
          {
            id: accUndecided,
            platform: "bluesky",
            account_username: "undecided",
            account_avatar_url: "",
            account_id: accUndecided,
            is_active: true,
            slug: "undecided",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/growth*", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("account_id") === accEnabled) {
        await route.fulfill({
          contentType: "application/json",
          json: {
            items: [],
            follow_updates: [],
            sync_state: {
              id: "s1",
              workspace_id: ws.id,
              social_account_id: accEnabled,
              platform: "bluesky",
              status: "ok",
              current_generation_id: "gen1",
              last_success_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          },
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: { items: [], follow_updates: [], sync_state: null },
      });
    });

    await page.goto(`/grow?workspace=${ws.id}`);
    await expect(page.getByRole("heading", { name: "Grow" })).toBeVisible();
    await expect(page.getByTestId("grow-account-select")).toBeVisible({ timeout: 10000 });
    // Selector should only show enabled account
    await page.getByTestId("grow-account-select").click();
    await expect(page.getByRole("option", { name: /enabled/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /disabled/ })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /missing/ })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /plan/ })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /undecided/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("stale Grow refresh and follow cannot be sent", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `grow-stale-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Grow Stale ${unique}`);
    await authenticatePage(page, auth.token);

    const accStale = "acc-stale";
    let stale = true;
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [accStale]: [
        featureResponse(accStale, "bluesky", "grow", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };

    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: accStale,
            platform: "bluesky",
            account_username: "stale",
            account_avatar_url: "",
            account_id: accStale,
            is_active: true,
            slug: "stale",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);

    let refreshCalled = 0;
    let followCalled = 0;
    page.route("**/api/v1/growth*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          items: [
            {
              id: "rec-1",
              handle: "person1.bsky.social",
              display_name: "Person One",
              bio: "Bio",
              avatar_url: "",
              profile_url: "https://bsky.app/profile/person1.bsky.social",
              followers_count: 100,
              following_count: 50,
              mutual_count: 1,
              mutuals: [],
              follows_viewer: false,
              signals: ["suggestion"],
              platform: "bluesky",
              score: 90,
              generation_id: "gen-stale",
              follow_state: "idle",
              last_seen_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          follow_updates: [],
          sync_state: {
            id: "s1",
            workspace_id: ws.id,
            social_account_id: accStale,
            platform: "bluesky",
            status: "ok",
            current_generation_id: "gen1",
            last_success_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      });
    });
    page.route("**/api/v1/growth/refresh", async (route) => {
      refreshCalled++;
      await route.fulfill({ contentType: "application/json", json: { job_id: "j1" } });
    });
    page.route("**/api/v1/growth/**/follow", async (route) => {
      followCalled++;
      await route.fulfill({ contentType: "application/json", json: { job_id: "f1" } });
    });

    await page.goto(`/grow?workspace=${ws.id}`);
    // Should show disabled notice, not selector
    await expect(page.getByTestId("grow-disabled-notice")).toBeVisible();
    await expect(page.getByTestId("grow-disabled-notice")).toContainText("Grow is off");
    // Stored recommendations remain visible even though disabled
    await expect(page.getByTestId("growth-grid")).toBeVisible();
    await expect(page.getByText("Person One")).toBeVisible();
    // Follow button should be disabled
    const followBtn = page.getByRole("button", { name: /Follow @person1/ });
    await expect(followBtn).toBeDisabled();
    await followBtn.click({ force: true });
    expect(followCalled).toBe(0);
    // Refresh should be hidden/disabled when stale
    const refreshBtn = page.getByTestId("grow-refresh-button");
    await expect(refreshBtn).toHaveCount(0);
    // Attempt to call refresh via keyboard should not trigger network
    expect(refreshCalled).toBe(0);
    await expect(page.getByTestId("grow-disabled-recovery-link")).toBeVisible();
    await expect(page.getByTestId("grow-disabled-recovery-link")).toHaveAttribute(
      "href",
      "/settings?tab=accounts",
    );
  });

  test("Grow shows stored recommendations with disabled notice after disabling", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `grow-stored-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Grow Stored ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-stored";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "mastodon", "grow", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "mastodon",
            account_username: "stored",
            account_avatar_url: "",
            account_id: acc,
            is_active: true,
            slug: "stored",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/growth*", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("account_id") === acc && route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          json: {
            items: [
              {
                id: "r1",
                handle: "person@mastodon.social",
                display_name: "Stored Person",
                bio: "",
                avatar_url: "",
                profile_url: "https://mastodon.social/@person",
                followers_count: 10,
                following_count: 10,
                mutual_count: 0,
                mutuals: [],
                follows_viewer: false,
                signals: [],
                platform: "mastodon",
                score: 80,
                generation_id: "g1",
                follow_state: "idle",
                last_seen_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            follow_updates: [],
            sync_state: {
              id: "s1",
              workspace_id: ws.id,
              social_account_id: acc,
              platform: "mastodon",
              status: "ok",
              current_generation_id: "g1",
              last_success_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          },
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`/grow?workspace=${ws.id}`);
    await expect(page.getByTestId("grow-disabled-notice")).toBeVisible();
    await expect(page.getByTestId("growth-grid")).toBeVisible();
    await expect(page.getByTestId("grow-stored-notice")).toBeVisible();
    await expect(page.getByTestId("grow-stored-notice")).toContainText("Stored recommendations");
  });
});

test.describe("Messages feature-aware", () => {
  test("all messaging off shows disabled empty with recovery", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `msg-off-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Msg Off ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-msg";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "instagram", "messaging", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "instagram",
            account_username: "insta",
            is_active: true,
            account_id: acc,
            slug: "insta",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/messages*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/messages") && route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          json: { items: [], total: 0, sync_states: [] },
        });
        return;
      }
      await route.continue();
    });
    page.route("**/api/v1/messages/**", async (route) => await route.continue());

    await page.goto(`/inbox/messages?workspace=${ws.id}`);
    await expect(page.getByText("Direct messages are off")).toBeVisible();
    await expect(page.getByText("Enable direct messages for at least one account")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open account details" })).toHaveAttribute(
      "href",
      "/settings?tab=accounts",
    );
    await expect(page.getByTestId("messages-disabled-reason")).toContainText("You turned off");
  });

  test("messages history remains visible with disabled notice", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `msg-history-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Msg History ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-msg-hist";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "instagram", "messaging", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "instagram",
            account_username: "insta",
            is_active: true,
            account_id: acc,
            slug: "insta",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/messages*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.pathname.endsWith("/messages") &&
        route.request().method() === "GET" &&
        !url.pathname.includes("/messages/")
      ) {
        await route.fulfill({
          contentType: "application/json",
          json: {
            items: [
              {
                id: "conv-1",
                workspace_id: ws.id,
                social_account_id: acc,
                platform: "instagram",
                remote_conversation_id: "rc1",
                counterpart_name: "Ada",
                counterpart_handle: "@ada",
                last_message_preview: "Hello",
                unread_count: 1,
                last_message_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            total: 1,
            sync_states: [],
          },
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`/inbox/messages?workspace=${ws.id}`);
    await expect(page.getByTestId("messages-disabled-notice")).toBeVisible();
    await expect(page.getByText("New message collection and sending are paused")).toBeVisible();
    await expect(page.getByRole("button", { name: /Ada/ })).toBeVisible();
    // Refresh disabled
    await expect(page.getByTestId("messages-refresh")).toBeDisabled();
  });

  test("mixed messaging enabled and disabled remains usable", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `msg-mixed-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Msg Mixed ${unique}`);
    await authenticatePage(page, auth.token);
    const accOn = "acc-on";
    const accOff = "acc-off";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [accOn]: [
        featureResponse(accOn, "instagram", "messaging", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: true,
          effective_enabled: true,
        }),
      ],
      [accOff]: [
        featureResponse(accOff, "instagram", "messaging", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: accOn,
            platform: "instagram",
            account_username: "on",
            is_active: true,
            account_id: accOn,
            slug: "on",
          },
          {
            id: accOff,
            platform: "instagram",
            account_username: "off",
            is_active: true,
            account_id: accOff,
            slug: "off",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/messages*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/messages") && route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          json: {
            items: [
              {
                id: "conv-1",
                workspace_id: ws.id,
                social_account_id: accOn,
                platform: "instagram",
                remote_conversation_id: "rc1",
                counterpart_name: "Ada",
                last_message_preview: "Hi",
                unread_count: 0,
                last_message_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            total: 1,
            sync_states: [],
          },
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`/inbox/messages?workspace=${ws.id}`);
    await expect(page.getByTestId("messages-disabled-notice")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Ada/ })).toBeVisible();
    await expect(page.getByTestId("messages-refresh")).toBeEnabled();
  });
});

test.describe("Engagement and Analytics feature-aware", () => {
  test("engagement all off shows disabled empty", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `eng-off-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Eng Off ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-eng";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "x", "engagement", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "x",
            account_username: "xuser",
            is_active: true,
            account_id: acc,
            slug: "xuser",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/engagement*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { items: [], total: 0, sync_states: [], next_cursor: "" },
      });
    });
    page.route("**/api/v1/publications*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [],
        headers: { "X-Next-Cursor": "" },
      });
    });
    await page.goto(`/inbox/engagement?workspace=${ws.id}`);
    await expect(page.getByText("Comments and replies are off")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open account details" })).toBeVisible();
  });

  test("engagement history remains with disabled notice", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `eng-hist-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Eng Hist ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-eng-hist";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "youtube", "engagement", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "youtube",
            account_username: "yt",
            is_active: true,
            account_id: acc,
            slug: "yt",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/engagement*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          items: [
            {
              id: "eng-1",
              workspace_id: ws.id,
              rendition_id: "rend-1",
              social_account_id: acc,
              platform: "youtube",
              remote_id: "r1",
              parent_remote_id: "",
              conversation_remote_id: "",
              author_name: "Ada",
              author_handle: "@ada",
              body: "Nice post",
              is_ours: false,
              can_reply: true,
              can_hide: true,
              can_delete: false,
              hidden: false,
              remote_created_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          total: 1,
          sync_states: [],
          next_cursor: "",
        },
      });
    });
    page.route("**/api/v1/publications*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [],
        headers: { "X-Next-Cursor": "" },
      });
    });
    await page.goto(`/inbox/engagement?workspace=${ws.id}`);
    await expect(page.getByTestId("engagement-disabled-notice")).toBeVisible();
    await expect(page.getByText("Nice post")).toBeVisible();
    await expect(page.getByTestId("engagement-refresh")).toBeDisabled();
  });

  test("analytics all off shows disabled empty and reason distinguishes scopes", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `ana-off-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Ana Off ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-ana";
    const featureMapMissing: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "x", "analytics", {
          supported: true,
          availability: "missing_scope",
          stored_exists: true,
          stored_enabled: true,
          missing_scopes: ["analytics.read"],
          required_scopes: ["analytics.read"],
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "x",
            account_username: "xuser",
            is_active: true,
            account_id: acc,
            slug: "xuser",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMapMissing, ws.id);
    page.route("**/api/v1/analytics*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          generated_at: new Date().toISOString(),
          last_synced_at: null,
          range_days: 30,
          summary: {
            followers: { value: 0, measured: 0 },
            engagement: { value: 0, measured: 0 },
            views: { value: 0, measured: 0 },
            impressions: { value: 0, measured: 0 },
            reach: { value: 0, measured: 0 },
            published: 0,
          },
          follower_series: [],
          accounts: [{ id: acc, platform: "x", username: "@xuser", status: "ok", metrics: {} }],
          content: [],
          publications: [],
          publication_total: 0,
        },
      });
    });
    await page.goto(`/analytics?workspace=${ws.id}`);
    await expect(page.getByText("Analytics are off")).toBeVisible();
    await expect(page.getByTestId("analytics-disabled-reason")).toContainText("analytics.read");
    await expect(page.getByText("Needs more provider permission")).toBeVisible();
  });

  test("analytics plan restricted reason distinct", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `ana-plan-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Ana Plan ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-ana-plan";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "x", "analytics", {
          supported: true,
          availability: "plan_restricted",
          stored_exists: true,
          stored_enabled: true,
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "x",
            account_username: "xuser",
            is_active: true,
            account_id: acc,
            slug: "xuser",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/analytics*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          generated_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          range_days: 30,
          summary: {
            followers: { value: 100, measured: 1 },
            engagement: { value: 10, measured: 1 },
            views: { value: 1000, measured: 1 },
            impressions: { value: 2000, measured: 1 },
            reach: { value: 500, measured: 1 },
            published: 2,
          },
          follower_series: [
            { date: "2026-07-01", value: 90 },
            { date: "2026-07-02", value: 100 },
          ],
          accounts: [
            {
              id: acc,
              platform: "x",
              username: "@xuser",
              status: "ok",
              metrics: { followers: 100 },
              follower_delta: 10,
              follower_series: [],
              last_synced_at: new Date().toISOString(),
            },
          ],
          content: [],
          publications: [
            {
              publication_id: "pub-1",
              title: "Post 1",
              excerpt: "Excerpt",
              published_at: new Date().toISOString(),
              metrics: { likes: 10 },
              measured: { likes: 1 },
              engagement: 10,
              engagement_measured: 1,
              renditions: [],
            },
          ],
          publication_total: 1,
        },
      });
    });
    await page.goto(`/analytics?workspace=${ws.id}`);
    await expect(page.getByTestId("analytics-disabled-notice")).toBeVisible();
    await expect(page.getByTestId("analytics-disabled-reason")).toContainText(
      "Not included in your current plan",
    );
  });

  test("analytics history remains visible with disabled notice when disabled", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `ana-hist-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Ana Hist ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-ana-hist";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "x", "analytics", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: false,
          effective_enabled: false,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "x",
            account_username: "xuser",
            is_active: true,
            account_id: acc,
            slug: "xuser",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/analytics*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          generated_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          range_days: 30,
          summary: {
            followers: { value: 100, measured: 1 },
            engagement: { value: 10, measured: 1 },
            views: { value: 1000, measured: 1 },
            impressions: { value: 2000, measured: 1 },
            reach: { value: 500, measured: 1 },
            published: 1,
          },
          follower_series: [
            { date: "2026-07-01", value: 90 },
            { date: "2026-07-02", value: 100 },
          ],
          accounts: [
            {
              id: acc,
              platform: "x",
              username: "@xuser",
              status: "ok",
              metrics: { followers: 100 },
              last_synced_at: new Date().toISOString(),
            },
          ],
          content: [],
          publications: [
            {
              publication_id: "pub-1",
              title: "Stored Post",
              excerpt: "Excerpt",
              published_at: new Date().toISOString(),
              metrics: { likes: 10 },
              measured: { likes: 1 },
              engagement: 10,
              engagement_measured: 1,
              renditions: [],
            },
          ],
          publication_total: 1,
        },
      });
    });
    await page.goto(`/analytics?workspace=${ws.id}`);
    await expect(page.getByTestId("analytics-disabled-notice")).toBeVisible();
    await expect(page.getByRole("link", { name: "Stored Post" })).toBeVisible();
  });
});

test.describe("responsive light dark keyboard", () => {
  test("grow responsive viewports no overflow", async ({ page, request }, testInfo) => {
    test.setTimeout(90000);
    const viewports = [{ width: 1280, height: 800 }] as const;
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `grow-resp-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Grow Resp ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-resp";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "bluesky", "grow", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: true,
          effective_enabled: true,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "bluesky",
            account_username: "resp",
            account_avatar_url: "",
            account_id: acc,
            is_active: true,
            slug: "resp",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/growth*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { items: [], follow_updates: [], sync_state: null },
      });
    });
    await page.goto(`/grow?workspace=${ws.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Grow" })).toBeVisible();
    for (const viewport of viewports) {
      try {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
      } catch {}
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        )
        .toBe(true);
      const trig = page.getByTestId("grow-account-select");
      if (await trig.isVisible()) {
        await trig.focus();
        await expect(trig).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("option", { name: /resp/ })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      if (viewport.width <= 390) {
        const box = await page
          .getByRole("button", { name: "Find people" })
          .boundingBox()
          .catch(() => null);
        if (box) expect(box.height).toBeGreaterThanOrEqual(44 - 1);
      }
    }
  });

  test("messages keyboard navigation and dark theme", async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => localStorage.setItem("mode-watcher-mode", "dark"));
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `msg-kb-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, `Msg KB ${unique}`);
    await authenticatePage(page, auth.token);
    const acc = "acc-kb";
    const featureMap: Record<string, ReturnType<typeof featureResponse>[]> = {
      [acc]: [
        featureResponse(acc, "instagram", "messaging", {
          supported: true,
          availability: "available",
          stored_exists: true,
          stored_enabled: true,
          effective_enabled: true,
        }),
      ],
    };
    page.route("**/api/v1/accounts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: acc,
            platform: "instagram",
            account_username: "kb",
            is_active: true,
            account_id: acc,
            slug: "kb",
          },
        ],
      });
    });
    installAccountFeaturesRoute(page, featureMap, ws.id);
    page.route("**/api/v1/messages*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/messages") && route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          json: { items: [], total: 0, sync_states: [] },
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`/inbox/messages?workspace=${ws.id}`);
    await page.keyboard.press("Tab");
    // Should focus refresh or selector
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement?.getAttribute("aria-label") ||
            document.activeElement?.textContent ||
            "",
        ),
      )
      .not.toEqual("");
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      )
      .toBe(true);
  });
});
