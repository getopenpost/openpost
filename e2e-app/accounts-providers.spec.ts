import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("accounts page shows configured and unavailable providers", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `accounts-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Provider Availability E2E");

  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/accounts/providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          platform: "bluesky",
          display_name: "Bluesky",
          auth_mode: "app_password",
          configured: true,
          status: "available",
          description: "Handle and app-password connection.",
          capabilities: [
            "Text posts",
            "Media posts",
            "Scheduling",
            "MCP workflows",
          ],
        },
        {
          platform: "x",
          display_name: "X (Twitter)",
          auth_mode: "oauth",
          configured: false,
          status: "needs_configuration",
          description: "Requires an X provider app.",
        },
        {
          platform: "mastodon",
          display_name: "Mastodon",
          auth_mode: "oauth_oob",
          configured: false,
          status: "needs_configuration",
          description: "Configure Mastodon instances first.",
        },
        {
          platform: "linkedin",
          display_name: "LinkedIn",
          auth_mode: "oauth",
          configured: false,
          status: "needs_configuration",
          description: "Requires a LinkedIn provider app.",
        },
        {
          platform: "threads",
          display_name: "Threads",
          auth_mode: "oauth",
          configured: false,
          status: "needs_configuration",
          description: "Requires a Meta provider app.",
        },
        {
          platform: "instagram",
          display_name: "Instagram",
          auth_mode: "oauth",
          configured: false,
          status: "needs_configuration",
          description: "Requires a Meta provider app.",
          capabilities: ["Images", "Reels", "Scheduling", "MCP workflows"],
        },
        {
          platform: "facebook",
          display_name: "Facebook",
          auth_mode: "oauth",
          configured: false,
          status: "needs_configuration",
          description: "Requires a Meta provider app.",
          capabilities: ["Page posts", "Media posts", "Scheduling"],
        },
        {
          platform: "youtube",
          display_name: "YouTube",
          auth_mode: "oauth",
          configured: false,
          status: "needs_configuration",
          description: "Requires a Google OAuth provider app.",
          capabilities: [
            "Shorts",
            "Video uploads",
            "Scheduling",
            "MCP workflows",
          ],
        },
        {
          platform: "tiktok",
          display_name: "TikTok",
          auth_mode: "oauth",
          configured: false,
          status: "needs_configuration",
          description: "Requires a TikTok provider app.",
          capabilities: ["Short videos", "Scheduling", "MCP workflows"],
        },
      ],
    });
  });
  await page.goto("/accounts");

  await expect(
    page.getByRole("heading", { name: "Add a channel" }),
  ).toBeVisible();
  await expect(page.getByTestId("provider-card-bluesky")).toContainText(
    "Post to Bluesky",
  );
  await expect(page.getByTestId("provider-card-bluesky")).not.toContainText(
    "Handle and app-password connection.",
  );
  await expect(page.getByTestId("provider-card-bluesky")).not.toContainText(
    "MCP workflows",
  );
  await expect(
    page
      .getByTestId("provider-card-bluesky")
      .getByRole("button", { name: "Connect" }),
  ).toBeEnabled();

  for (const platform of [
    "x",
    "mastodon",
    "linkedin",
    "threads",
    "instagram",
    "facebook",
    "youtube",
    "tiktok",
  ]) {
    await expect(page.getByTestId(`provider-card-${platform}`)).toContainText(
      "Admin setup required",
    );
    await expect(
      page
        .getByTestId(`provider-card-${platform}`)
        .getByRole("button", { name: "Ask admin" }),
    ).toBeDisabled();
  }

  for (const [platform, title] of [
    ["instagram", "Instagram"],
    ["facebook", "Facebook"],
    ["youtube", "YouTube"],
    ["tiktok", "TikTok"],
  ] as const) {
    await expect(
      page.getByTestId(`provider-card-${platform}`).locator("svg title"),
    ).toHaveText(title);
  }
});

test("accounts page starts custom Mastodon instance connection", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `mastodon-custom-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Custom Mastodon E2E");

  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/accounts/providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          platform: "mastodon",
          display_name: "Mastodon",
          auth_mode: "oauth_oob",
          configured: true,
          status: "available",
          description: "Connect any public Mastodon instance.",
          name: "Custom instance",
        },
      ],
    });
  });

  let authURLRequest:
    | {
        workspaceId: string | null;
        instanceURL: string | null;
        serverName: string | null;
      }
    | undefined;
  await page.route("**/api/v1/accounts/mastodon/auth-url?**", async (route) => {
    const url = new URL(route.request().url());
    authURLRequest = {
      workspaceId: url.searchParams.get("workspace_id"),
      instanceURL: url.searchParams.get("instance_url"),
      serverName: url.searchParams.get("server_name"),
    };
    await route.fulfill({
      contentType: "application/json",
      json: { url: "/accounts/mastodon/callback" },
    });
  });

  await page.goto("/accounts");
  const card = page.getByTestId("provider-card-mastodon");
  await expect(card).toContainText("Connect any public Mastodon instance");
  await card.getByRole("button", { name: "Connect" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Mastodon" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Server address").fill("mastodon.social");
  await dialog.getByRole("button", { name: "Connect" }).click();

  await expect(page).toHaveURL(/\/accounts\/mastodon\/callback/);
  expect(authURLRequest?.workspaceId).toBeTruthy();
  expect(authURLRequest?.instanceURL).toBe("mastodon.social");
  expect(authURLRequest?.serverName).toBeNull();
});
