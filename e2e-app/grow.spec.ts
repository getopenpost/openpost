import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const now = "2026-08-20T12:00:00Z";
const blueskyAvatarURL = "https://cdn.openpost.test/bluesky-account.svg";
const mastodonAvatarURL = "https://cdn.openpost.test/mastodon-account.svg";

const accounts = [
  {
    id: "account-bluesky",
    account_id: "did:plc:openpost",
    account_username: "openpost.bsky.social",
    account_avatar_url: blueskyAvatarURL,
    account_kind: "person",
    grant_destination_count: 1,
    instance_url: "https://bsky.social",
    is_active: true,
    messages_enabled: false,
    messaging_supported: true,
    platform: "bluesky",
    shared_grant: false,
    slug: "openpost-bluesky",
    thread_replies_supported: true,
  },
  {
    id: "account-mastodon",
    account_id: "42",
    account_username: "openpost@mastodon.social",
    account_avatar_url: mastodonAvatarURL,
    account_kind: "person",
    grant_destination_count: 1,
    instance_url: "https://mastodon.social",
    is_active: true,
    messages_enabled: false,
    messaging_supported: true,
    platform: "mastodon",
    shared_grant: false,
    slug: "openpost-mastodon",
    thread_replies_supported: true,
  },
];

function recommendation(
  accountID: string,
  platform: "bluesky" | "mastodon",
  index: number,
  overrides: Record<string, unknown> = {},
) {
  const prefix = platform === "bluesky" ? "b" : "m";
  const names = [
    "Jane Smith",
    "Pieter Levels",
    "Erica Chen",
    "Ben Ortiz",
    "Tori Wells",
    "Seb Stone",
  ];
  return {
    id: `${prefix}-${index}`,
    workspace_id: "workspace-placeholder",
    social_account_id: accountID,
    platform,
    remote_account_id: `${prefix}-remote-${index}`,
    handle:
      platform === "bluesky" ? `person${index}.bsky.social` : `person${index}@mastodon.social`,
    display_name: names[index - 1],
    bio: [
      "Building small developer tools and writing about infrastructure.",
      "Independent maker sharing practical product lessons.",
      "Design systems, branding, and accessible interfaces.",
      "Open source work across Rust, Go, and Linux.",
      "Product designer helping teams ship clearer experiences.",
      "Developer and systems administrator sharing what works.",
    ][index - 1],
    avatar_url: "",
    profile_url:
      platform === "bluesky"
        ? `https://bsky.app/profile/person${index}.bsky.social`
        : `https://mastodon.social/@person${index}`,
    followers_count: 900 + index * 731,
    following_count: 500 + index * 317,
    mutual_count: index === 1 ? 2 : 7 - index,
    mutuals: [
      { RemoteID: "mutual-1", Handle: "theo", DisplayName: "Theo", AvatarURL: "" },
      {
        RemoteID: "mutual-2",
        Handle: index === 2 ? "alex" : "jane",
        DisplayName: index === 2 ? "Alex" : "Jane",
        AvatarURL: "",
      },
    ],
    mutual_exact: index !== 2,
    follows_viewer: index === 2,
    signals:
      index === 1
        ? ["friends_of_friends"]
        : index === 2
          ? ["suggestion"]
          : ["similar_to_recently_followed"],
    score: 90 - index,
    generation_id: `generation-${accountID}`,
    follow_state: "idle",
    last_seen_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function installGrowthRoutes(page: Page, workspaceID: string) {
  const dismissed = new Set<string>();
  const terminal = new Map<string, "following" | "requested">();
  let refreshReads = 0;
  let refreshRequests = 0;
  let delayedAccount = "";
  let overlapTerminalOnce = false;
  let terminalOverlapReads = 0;

  page.route("https://cdn.openpost.test/*-account.svg", async (route) => {
    const label = route.request().url().includes("bluesky") ? "BS" : "MA";
    await route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#c45106"/><text x="32" y="39" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="white">${label}</text></svg>`,
    });
  });

  page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: accounts });
  });

  page.route("**/api/v1/account-features*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || !url.pathname.endsWith("/account-features")) {
      await route.continue();
      return;
    }
    const requestedIDs = new Set(
      (url.searchParams.get("account_ids") ?? "").split(",").filter(Boolean),
    );
    await route.fulfill({
      contentType: "application/json",
      json: accounts
        .filter((account) => requestedIDs.has(account.id))
        .map((account) => ({
          workspace_id: workspaceID,
          social_account_id: account.id,
          platform: account.platform,
          feature: "grow",
          supported: true,
          availability: "available",
          reason_code: "available",
          required_scopes: [],
          missing_scopes: [],
          unavailable_reason: "",
          stored_exists: true,
          stored_enabled: true,
          effective_enabled: true,
        })),
    });
  });

  page.route("**/api/v1/growth**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/growth/refresh") && method === "POST") {
      refreshRequests += 1;
      refreshReads = 1;
      await route.fulfill({
        contentType: "application/json",
        json: { job_id: "refresh-1", status: "queued", message: "Growth refresh queued." },
      });
      return;
    }
    const followMatch = url.pathname.match(/\/growth\/([^/]+)\/follow$/u);
    if (followMatch && method === "POST") {
      const id = followMatch[1];
      terminal.set(id, id.startsWith("m-") ? "requested" : "following");
      await route.fulfill({
        contentType: "application/json",
        json: { job_id: `follow-${id}`, status: "pending", message: "Follow queued." },
      });
      return;
    }
    const dismissMatch = url.pathname.match(/\/growth\/([^/]+)\/dismiss$/u);
    if (dismissMatch && method === "POST") {
      const id = dismissMatch[1];
      if (id.endsWith("-3")) {
        await route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          json: { status: 500, title: "Failed", detail: "Growth operation failed" },
        });
      } else {
        dismissed.add(id);
        await route.fulfill({ contentType: "application/json", json: { status: "dismissed" } });
      }
      return;
    }
    if (url.pathname.endsWith("/growth") && method === "GET") {
      const accountID = url.searchParams.get("account_id") ?? accounts[0].id;
      if (delayedAccount === accountID) {
        delayedAccount = "";
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      const platform = accountID === accounts[1].id ? "mastodon" : "bluesky";
      const all = Array.from({ length: 6 }, (_, index) =>
        recommendation(accountID, platform, index + 1, { workspace_id: workspaceID }),
      );
      const includeTerminal = overlapTerminalOnce && terminal.size > 0;
      const items = all.filter(
        (item) => !dismissed.has(item.id) && (includeTerminal || !terminal.has(item.id)),
      );
      if (includeTerminal) {
        overlapTerminalOnce = false;
        terminalOverlapReads += 1;
      }
      const followUpdates = [...terminal.entries()]
        .filter(([id]) => id.startsWith(platform === "bluesky" ? "b-" : "m-"))
        .map(([id, followState]) => ({
          id,
          follow_state: followState,
          updated_at: now,
          generation_id: `generation-${accountID}`,
        }));
      const status = refreshReads > 0 ? "refreshing" : "ok";
      if (refreshReads > 0) refreshReads -= 1;
      await route.fulfill({
        contentType: "application/json",
        json: {
          items,
          follow_updates: followUpdates,
          sync_state: {
            id: `state-${accountID}`,
            workspace_id: workspaceID,
            social_account_id: accountID,
            platform,
            status,
            current_generation_id: `generation-${accountID}`,
            last_attempted_at: now,
            last_success_at: now,
            created_at: now,
            updated_at: now,
          },
        },
      });
      return;
    }
    await route.continue();
  });

  return {
    delayNext(accountID: string) {
      delayedAccount = accountID;
    },
    overlapNextTerminalRead() {
      overlapTerminalOnce = true;
    },
    refreshRequestCount() {
      return refreshRequests;
    },
    terminalOverlapReadCount() {
      return terminalOverlapReads;
    },
  };
}

async function chooseAccount(page: Page, name: RegExp) {
  await page.getByTestId("grow-account-select").click();
  await page.getByRole("option", { name }).click();
}

async function prepareGrow(page: Page, request: Parameters<typeof registerUser>[0], seed: string) {
  const auth = await registerUser(request, `grow-${seed}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, `Grow ${seed}`)) as { id: string };
  await authenticatePage(page, auth.token);
  const fixture = installGrowthRoutes(page, workspace.id);
  await page.goto(`/grow?workspace=${workspace.id}`);
  await expect(page.getByRole("heading", { name: "Grow" })).toBeVisible();
  await expect(page.getByTestId("growth-profile-card")).toHaveCount(6);
  return { fixture, workspace };
}

test("Grow filters and orders the selected account's recommendations", async ({
  page,
  request,
}, testInfo) => {
  await prepareGrow(page, request, `controls-${Date.now().toString(36)}-${testInfo.workerIndex}`);

  const accountSelector = page.getByTestId("grow-account-select");
  await expect(accountSelector).toHaveAttribute(
    "aria-label",
    "For: @openpost.bsky.social, Bluesky",
  );
  await expect(accountSelector).toContainText("openpost.bsky.social");
  await expect(accountSelector).toContainText("Bluesky");
  const accountAvatar = accountSelector.locator('[data-slot="avatar-image"]');
  await expect(accountAvatar).toHaveAttribute("src", blueskyAvatarURL);
  await expect
    .poll(() =>
      accountAvatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await accountSelector.click();
  await expect(
    page.getByRole("option", { name: /openpost@mastodon\.social.*Mastodon/iu }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("grow-result-count")).toHaveText("6 people");

  await page.getByTestId("grow-view-select").click();
  await page.getByRole("option", { name: "Follows you" }).click();
  await expect(page.getByTestId("growth-profile-card")).toHaveCount(1);
  await expect(page.getByText("Pieter Levels")).toBeVisible();

  await page.getByTestId("grow-view-select").click();
  await page.getByRole("option", { name: "All recommendations" }).click();
  await page.getByTestId("grow-mutuals-select").click();
  await page.getByRole("option", { name: "5 or more" }).click();
  await expect(page.getByTestId("growth-profile-card")).toHaveCount(1);
  await expect(page.getByText("Pieter Levels")).toBeVisible();

  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.getByTestId("grow-sort-select").click();
  await page.getByRole("option", { name: "Most mutuals" }).click();
  await expect(page.getByTestId("growth-profile-card").first()).toContainText("Pieter Levels");

  await page.getByTestId("grow-sort-select").click();
  await page.getByRole("option", { name: "Follow-back potential" }).click();
  await expect(page.getByTestId("growth-profile-card").first()).toContainText("Pieter Levels");
  await expect(
    page.getByText("Estimated from follows, mutuals, and account balance."),
  ).toBeVisible();
});

test("Grow keeps follow settlement stable across an overlapping list snapshot", async ({
  page,
  request,
}, testInfo) => {
  const eachKeyErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message.includes("each_key_duplicate")) eachKeyErrors.push(error.message);
  });
  const { fixture } = await prepareGrow(
    page,
    request,
    `follow-race-${Date.now().toString(36)}-${testInfo.workerIndex}`,
  );

  fixture.overlapNextTerminalRead();
  await page.getByRole("button", { name: "Follow @person1.bsky.social" }).click();
  await expect.poll(() => fixture.terminalOverlapReadCount(), { timeout: 8_000 }).toBe(1);
  await expect(page.getByRole("button", { name: "Following @person1.bsky.social" })).toBeVisible();
  expect(eachKeyErrors).toEqual([]);
});

test("Grow keeps account-specific evidence and follow outcomes clear", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  const unauthorized: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() === 401) unauthorized.push(response.url());
  });
  const { fixture } = await prepareGrow(
    page,
    request,
    `${Date.now().toString(36)}-${testInfo.workerIndex}`,
  );

  await expect(page.getByText("Followed by Theo and Jane", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Also followed by Theo and Alex", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/follow-back chance|high growth opportunity|very likely/iu),
  ).toHaveCount(0);

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open profile for @person1.bsky.social" }).click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toContain("bsky.app/profile/person1.bsky.social");
  await popup.close();

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => fixture.refreshRequestCount()).toBe(1);
  await expect(page.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  await expect(page.getByTestId("growth-profile-card")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled({ timeout: 12_000 });

  await page.getByRole("button", { name: "Follow @person1.bsky.social" }).click();
  await expect(page.getByRole("button", { name: "Following @person1.bsky.social" })).toBeVisible();
  await expect(page.getByText("Jane Smith")).toHaveCount(0, { timeout: 8_000 });
  await page.reload();
  await expect(page.getByText("@person2.bsky.social")).toBeVisible();
  await expect(page.getByText("Jane Smith")).toHaveCount(0);

  fixture.delayNext(accounts[1].id);
  await chooseAccount(page, /openpost@mastodon\.social/iu);
  await chooseAccount(page, /openpost\.bsky\.social/iu);
  await page.waitForTimeout(800);
  await expect(page.getByText("@person2.bsky.social")).toBeVisible();
  await expect(page.getByText("@person1@mastodon.social")).toHaveCount(0);

  await chooseAccount(page, /openpost@mastodon\.social/iu);
  await expect(page.getByText("@person1@mastodon.social")).toBeVisible();
  await page.getByRole("button", { name: "Follow @person1@mastodon.social" }).click();
  await expect(
    page.getByRole("button", { name: "Requested @person1@mastodon.social" }),
  ).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Jane Smith")).toHaveCount(0, { timeout: 8_000 });

  await page
    .getByRole("button", { name: "Dismiss recommendation for @person2@mastodon.social" })
    .click();
  await expect(page.getByText("Pieter Levels")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Dismiss recommendation for @person3@mastodon.social" })
    .click();
  await expect(page.getByText("Erica Chen")).toBeVisible();
  await expect(page.getByText("Couldn't dismiss recommendation. Try again.")).toBeVisible();

  expect(consoleErrors.filter((message) => !message.includes("Failed to load resource"))).toEqual(
    [],
  );
  expect(unauthorized).toEqual([]);
});

test("Grow fits desktop and phone layouts in both themes", async ({ page, request }, testInfo) => {
  test.skip(
    process.env.OPENPOST_GROW_SCREENSHOTS !== "1",
    "Set OPENPOST_GROW_SCREENSHOTS=1 to capture review evidence.",
  );
  await prepareGrow(page, request, `visual-${Date.now().toString(36)}-${testInfo.workerIndex}`);
  const reviewDir = path.resolve(".impeccable/review");
  await mkdir(reviewDir, { recursive: true });
  const scenarios = [
    { name: "grow-desktop-light.png", width: 1280, height: 900, theme: "light" },
    { name: "grow-desktop-dark.png", width: 1280, height: 900, theme: "dark" },
    { name: "grow-phone-390-light.png", width: 390, height: 844, theme: "light" },
    { name: "grow-phone-390-dark.png", width: 390, height: 844, theme: "dark" },
    { name: "grow-phone-320-light.png", width: 320, height: 740, theme: "light" },
  ] as const;

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.evaluate(
      (theme) => localStorage.setItem("mode-watcher-mode", theme),
      scenario.theme,
    );
    await page.reload();
    await expect(page.getByTestId("growth-profile-card")).toHaveCount(6);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    if (scenario.width < 768) {
      await expect(page.locator('[data-slot="mobile-bottom-nav"]')).toBeVisible();
      await expect(page.getByRole("button", { name: "More" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      const accountSelector = page.getByTestId("grow-account-select");
      const triggerBox = await accountSelector.boundingBox();
      expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      await accountSelector.click();
      const mastodonOption = page.getByRole("option", {
        name: /@openpost@mastodon\.social.*Mastodon/iu,
      });
      await expect(mastodonOption).toBeVisible();
      const optionBox = await mastodonOption.boundingBox();
      expect(optionBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      const openOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(openOverflow).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: path.join(reviewDir, scenario.name), fullPage: false });
    if (scenario.width < 768) await page.keyboard.press("Escape");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Follow @person1.bsky.social" }).click();
  await expect(page.getByText("Jane Smith")).toHaveCount(0, { timeout: 6_000 });
});
