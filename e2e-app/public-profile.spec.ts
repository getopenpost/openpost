import { expect, test, type Page } from "@playwright/test";

async function routePublicProfileDocumentFixture(page: Page, username: string) {
  await page.route(`**/u/${username}`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(404);
    await route.fulfill({ response, status: 200 });
  });
}

function profileActivity() {
  const today = new Date();
  return Array.from({ length: 365 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (364 - index));
    const count = index > 340 && index % 4 !== 0 ? (index % 5) + 1 : 0;
    return {
      date: date.toISOString().slice(0, 10),
      count,
      level: count === 0 ? 0 : Math.min(4, count),
    };
  });
}

test("public publishing profile stays readable at 320px", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 320, height: 900 });
  await routePublicProfileDocumentFixture(page, "rodrgds");
  await page.route("**/api/v1/public/profiles/rodrgds", (route) =>
    route.fulfill({
      json: {
        username: "rodrgds",
        visible_fields: [
          "display_name",
          "avatar",
          "joined_at",
          "activity",
          "platforms",
          "workspaces",
          "plan",
        ],
        display_name: "Rodrigo Dias",
        avatar_url: "",
        plan_id: "pro",
        joined_at: "2025-08-03T12:00:00Z",
        lifetime_posts: 327,
        peak_posts: 8,
        current_streak: 6,
        longest_streak: 32,
        active_days: 118,
        activity: profileActivity(),
        top_platforms: [
          { key: "x", name: "X", count: 180 },
          { key: "linkedin", name: "LinkedIn", count: 97 },
        ],
        top_workspaces: [
          { key: "openpost", name: "OpenPost", count: 210 },
          { key: "personal", name: "Personal", count: 117 },
        ],
      },
    }),
  );

  await page.goto("/u/rodrgds");

  await expect(
    page.getByRole("heading", { name: "Rodrigo Dias" }),
  ).toBeVisible();
  await expect(page.getByText("@rodrgds")).toBeVisible();
  await expect(page.getByText("Pro", { exact: true })).toBeVisible();
  await expect(page.getByText("327")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Publishing activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Most used platforms" }),
  ).toBeVisible();
  await expect(
    page.getByText("OpenPost", { exact: true }).last(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect(consoleErrors).toEqual([]);
});

test("public publishing profile fits a desktop viewport", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await routePublicProfileDocumentFixture(page, "rodrgds");
  await page.route("**/api/v1/public/profiles/rodrgds", (route) =>
    route.fulfill({
      json: {
        username: "rodrgds",
        visible_fields: [
          "display_name",
          "avatar",
          "joined_at",
          "activity",
          "platforms",
          "workspaces",
          "plan",
        ],
        display_name: "Rodrigo Dias",
        avatar_url: "",
        plan_id: "pro",
        joined_at: "2025-08-03T12:00:00Z",
        lifetime_posts: 18,
        peak_posts: 4,
        current_streak: 1,
        longest_streak: 1,
        active_days: 9,
        activity: profileActivity(),
        top_platforms: [
          { key: "bluesky", name: "Bluesky", count: 14 },
          { key: "linkedin", name: "LinkedIn", count: 14 },
          { key: "mastodon", name: "Mastodon", count: 14 },
          { key: "x", name: "X", count: 13 },
          { key: "threads", name: "Threads", count: 12 },
        ],
        top_workspaces: [{ key: "personal", name: "Personal", count: 18 }],
      },
    }),
  );

  await page.goto("/u/rodrgds");

  await expect(
    page.getByRole("heading", { name: "Rodrigo Dias" }),
  ).toBeVisible();
  await expect(page.getByText("Pro", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(900);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1600);
  const activityWidths = await page.evaluate(() => ({
    field:
      document
        .querySelector<HTMLElement>(".activity-field")
        ?.getBoundingClientRect().width ?? 0,
    scroll:
      document
        .querySelector<HTMLElement>(".activity-scroll")
        ?.getBoundingClientRect().width ?? 0,
  }));
  expect(activityWidths.field).toBeGreaterThanOrEqual(
    activityWidths.scroll - 1,
  );
  expect(consoleErrors).toEqual([]);
});

test("public profile distinguishes disabled, private, and transient failure states", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ json: { public_profiles_enabled: false } }),
  );
  await page.route("**/api/v1/public/profiles/disabled", (route) =>
    route.fulfill({ status: 404, json: { detail: "disabled" } }),
  );
  await page.goto("/u/disabled");
  await expect(
    page.getByText("Public profiles are not available"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ json: { public_profiles_enabled: true } }),
  );
  await page.route("**/api/v1/public/profiles/private", (route) =>
    route.fulfill({ status: 404, json: { detail: "not found" } }),
  );
  await page.goto("/u/private");
  await expect(page.getByText("Profile unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

  await page.unroute("**/api/v1/auth/config");
  let capabilityAvailable = false;
  await page.route("**/api/v1/auth/config", (route) =>
    capabilityAvailable
      ? route.fulfill({ json: { public_profiles_enabled: true } })
      : route.fulfill({
          status: 500,
          json: { detail: "configuration unavailable" },
        }),
  );
  await page.route("**/api/v1/public/profiles/capability-failure", (route) =>
    route.fulfill({
      json: {
        username: "capability-failure",
        visible_fields: ["display_name"],
        display_name: "Must stay hidden",
      },
    }),
  );
  await page.goto("/u/capability-failure");
  await expect(page.getByText("Profile could not be loaded")).toBeVisible();
  await expect(page.getByText("Must stay hidden")).toHaveCount(0);
  capabilityAvailable = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Must stay hidden" }),
  ).toBeVisible();

  let attempts = 0;
  await page.route("**/api/v1/public/profiles/recovering", (route) => {
    attempts += 1;
    if (attempts === 1) {
      return route.fulfill({
        status: 500,
        json: { detail: "temporarily unavailable" },
      });
    }
    return route.fulfill({
      json: { username: "recovering", visible_fields: [] },
    });
  });
  await page.goto("/u/recovering");
  await expect(page.getByText("Profile could not be loaded")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("@recovering")).toBeVisible();
  expect(attempts).toBe(2);

  let offlineAttempts = 0;
  await page.route("**/api/v1/public/profiles/offline", (route) => {
    offlineAttempts += 1;
    if (offlineAttempts === 1) return route.abort("failed");
    return route.fulfill({
      json: { username: "offline", visible_fields: [] },
    });
  });
  await page.goto("/u/offline");
  await expect(page.getByText("Profile could not be loaded")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("@offline")).toBeVisible();
  expect(offlineAttempts).toBe(2);
});

test("public profile discards a delayed response after client navigation", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ json: { public_profiles_enabled: true } }),
  );
  let releaseSlow: (() => void) | undefined;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  await page.route("**/api/v1/public/profiles/slow", async (route) => {
    await slowGate;
    await route
      .fulfill({
        json: {
          username: "slow",
          visible_fields: ["display_name"],
          display_name: "Delayed profile",
        },
      })
      .catch(() => undefined);
  });
  await page.route("**/api/v1/public/profiles/fast", (route) =>
    route.fulfill({
      json: {
        username: "fast",
        visible_fields: ["display_name"],
        display_name: "Current profile",
      },
    }),
  );

  await page.goto("/u/slow");
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/u/fast";
    link.textContent = "Open next profile";
    link.dataset.testid = "next-profile";
    document.body.append(link);
  });
  await page.getByTestId("next-profile").click();
  await page.waitForURL("**/u/fast");
  await expect(
    page.getByRole("heading", { name: "Current profile" }),
  ).toBeVisible();

  releaseSlow?.();
  await page.waitForTimeout(100);
  await expect(page.getByText("Delayed profile")).toHaveCount(0);
  await expect(page.getByText("@fast")).toBeVisible();
});

test("public profile renders only the declared optional sections", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ json: { public_profiles_enabled: true } }),
  );
  await page.route("**/api/v1/public/profiles/careful", (route) =>
    route.fulfill({
      json: {
        username: "careful",
        visible_fields: ["avatar"],
        top_workspaces: [{ key: "secret", name: "Secret Client", count: 3 }],
        activity: profileActivity(),
      },
    }),
  );
  await page.goto("/u/careful");
  await expect(page.getByRole("heading", { name: "careful" })).toBeVisible();
  await expect(page.getByText("Secret Client")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Publishing activity" }),
  ).toHaveCount(0);
});
