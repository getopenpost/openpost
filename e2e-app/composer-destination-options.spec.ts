import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const threadsAccount = {
  id: "threads-main",
  slug: "threads-main",
  platform: "threads",
  account_id: "threads-user-1",
  account_username: "openpost",
  account_avatar_url: "",
  instance_url: "",
  is_active: true,
  thread_replies_supported: true,
};

const media = {
  min_count: 0,
  max_count: 0,
  allowed_mimes: [],
  requires_public_url: false,
  requires_https_fetchable: false,
};

function setting(
  key: string,
  label: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    key,
    message_key: `publishing.setting.${key.replaceAll("_", ".")}`,
    label,
    group: "content",
    control: "text",
    type: "text",
    scope: "destination",
    intents: ["post"],
    output_profiles: ["threads.post"],
    media_shapes: ["text"],
    required: false,
    required_policy: "never",
    constraints: {},
    ...overrides,
  };
}

function threadsResolvedCapability() {
  const settings = [
    setting("poll_options", "Poll", {
      group: "conversation",
      control: "poll",
      type: "textarea",
      scope: "segment",
      constraints: {
        min_items: 2,
        max_items: 4,
        max_length: 25,
      },
    }),
    setting("reply_control", "Who can reply", {
      group: "conversation",
      control: "select",
      type: "select",
      options: [
        "everyone",
        "accounts_you_follow",
        "mentioned_only",
        "followers_only",
      ],
    }),
    setting("text_attachment_plaintext", "Text attachment", {
      control: "long_text",
      type: "textarea",
      constraints: { max_length: 10000 },
    }),
  ];
  return {
    account_id: threadsAccount.id,
    provider: "threads",
    profile: "short_text",
    output_profile: "threads.post",
    label: "Threads post",
    text_limit: 500,
    media,
    intents: ["post"],
    media_shapes: ["text"],
    settings,
    setting_groups: [
      {
        key: "content",
        settings: settings.filter((item) => item.group === "content"),
      },
      {
        key: "conversation",
        settings: settings.filter((item) => item.group === "conversation"),
      },
    ],
    compatible: true,
    active_constraints: { media_shape: "text", text_limit: 500, media },
    issues: [],
    capability_revision: "catalog-v2",
    dynamic_options: {},
  };
}

test("Threads destination options stay scoped and touch accessible on mobile", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `composer-options-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Destination options E2E",
  )) as { id: string };
  await authenticatePage(page, auth.token);

  let publicationPayload: Record<string, unknown> | undefined;
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [threadsAccount],
    });
  });
  await page.route("**/api/v1/provider-readiness?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        providers: [
          {
            provider: "threads",
            configured_app_state: "ready",
            connected_accounts: 1,
            blocking_issues: [],
            next_actions: [],
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { capabilities: [threadsResolvedCapability()] },
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { accounts: [threadsResolvedCapability()] },
    });
  });
  await page.route("**/api/v1/posts/draft", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as {
      publication: Record<string, unknown>;
    };
    publicationPayload = payload.publication;
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-1",
        publication_id: "publication-1",
        revision: 1,
        updated_at: "2026-07-24T12:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/posts/post-1/draft", async (route) => {
    const payload = route.request().postDataJSON() as {
      publication: Record<string, unknown>;
    };
    publicationPayload = payload.publication;
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-1",
        publication_id: "publication-1",
        revision: 2,
        updated_at: "2026-07-24T12:00:01Z",
      },
    });
  });
  await page.route("**/api/v1/publications/publication-1", async (route) => {
    if (route.request().method() === "PUT") {
      publicationPayload = {
        ...(publicationPayload ?? {}),
        ...JSON.parse(route.request().postData() ?? "{}"),
      };
      await route.fulfill({ contentType: "application/json", json: {} });
      return;
    }
    await route.continue();
  });
  await page.route(
    "**/api/v1/publications/publication-1/renditions",
    async (route) => {
      if (route.request().method() === "PUT") {
        publicationPayload = {
          ...(publicationPayload ?? {}),
          ...JSON.parse(route.request().postData() ?? "{}"),
        };
        await route.fulfill({ contentType: "application/json", json: {} });
        return;
      }
      await route.continue();
    },
  );

  await page.goto("/");
  await page.getByLabel("Post text").fill("A scoped Threads poll");
  await page.getByTestId("composer-account-control").click();
  const accountRow = page.getByTestId("composer-account-row");
  await expect(accountRow).toContainText(/openpost.*Threads/);
  const accountRowBox = await accountRow.boundingBox();
  expect(accountRowBox?.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /openpost/ }).click();
  const settingsButton = page.getByRole("button", {
    name: "Platform settings",
  });
  const settingsBox = await settingsButton.boundingBox();
  expect(settingsBox?.width).toBeGreaterThanOrEqual(44);
  expect(settingsBox?.height).toBeGreaterThanOrEqual(44);
  await settingsButton.click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Threads settings" }),
  ).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox?.height).toBeGreaterThanOrEqual(800);
  await dialog.getByRole("button", { name: "Poll", exact: true }).click();
  await dialog.getByPlaceholder("Option 1").fill("Ship now");
  await dialog.getByPlaceholder("Option 2").fill("Review first");
  await dialog.getByRole("button", { name: "Who can reply" }).click();
  await page
    .getByRole("option", { name: "followers_only", exact: true })
    .click();
  await dialog.getByLabel("Text attachment").fill("Long-form context");
  await dialog.getByRole("button", { name: "Done" }).click();

  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect
    .poll(() => JSON.stringify(publicationPayload ?? {}), {
      timeout: 10_000,
    })
    .toContain("followers_only");
  const renditions = publicationPayload?.renditions as Array<{
    social_account_id: string;
    settings: Record<string, unknown>;
    segments: Array<{ settings: Record<string, unknown> }>;
  }>;
  expect(renditions[0].social_account_id).toBe(threadsAccount.id);
  expect(renditions[0].settings).toMatchObject({
    reply_control: "followers_only",
    text_attachment_plaintext: "Long-form context",
  });
  expect(renditions[0].segments[0].settings).toMatchObject({
    poll_options: "Ship now\nReview first",
  });
});
