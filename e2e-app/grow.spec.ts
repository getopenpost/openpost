import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const now = "2026-08-20T12:00:00Z";

const accounts = [
  {
    id: "account-bluesky",
    account_id: "did:plc:openpost",
    account_username: "openpost.bsky.social",
    account_avatar_url: "",
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
    account_avatar_url: "",
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

type GrowthFixture = ReturnType<typeof installGrowthRoutes>;

function installGrowthRoutes(page: Page, workspaceID: string) {
  const dismissed = new Set<string>();
  const terminal = new Map<string, "following" | "requested">();
  let refreshReads = 0;
  let refreshRequests = 0;
  let delayedAccount = "";

  page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: accounts });
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
      const items = all.filter((item) => !dismissed.has(item.id) && !terminal.has(item.id));
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
    refreshRequestCount() {
      return refreshRequests;
    },
  };
}

async function chooseAccount(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "For", exact: true }).click();
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
    await expect(page.locator("html")).toHaveClass(
      scenario.theme === "dark" ? /dark/u : /^(?!.*dark)/u,
    );
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
    }
    await page.screenshot({ path: path.join(reviewDir, scenario.name), fullPage: false });
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Follow @person1.bsky.social" }).click();
  await expect(page.getByText("Jane Smith")).toHaveCount(0, { timeout: 6_000 });
});
