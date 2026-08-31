import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  clickComposerDeliveryAction,
  composerDeliveryAction,
  createWorkspace,
  registerUser,
} from "./helpers";

type PostPayload = {
  workspace_id?: string;
  source_text?: string;
  source_url?: string;
  content_profile?: string;
  renditions?: Array<{
    social_account_id?: string;
    profile?: string;
    body?: string;
    settings?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
};

test("composer renders account-specific renditions", async ({ page, request }, testInfo) => {
  const unique = Date.now().toString(36);
  const email = `composer-preview-${unique}@example.com`;
  let publicationPayload: PostPayload | undefined;
  let deleteRequested = false;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Composer Preview E2E");

  await authenticatePage(page, auth.token);
  await page.route("https://cdn.example/*.jpg", async (route) => {
    const label = route.request().url().includes("image-editor") ? "OS" : "OP";
    await route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#c45106"/><text x="32" y="39" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="white">${label}</text></svg>`,
    });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "bluesky-main",
          slug: "bluesky-main",
          platform: "bluesky",
          account_id: "bsky-main",
          account_username: "openpost_main",
          account_avatar_url: "https://cdn.example/main.jpg",
          instance_url: "",
          is_active: true,
          thread_replies_supported: false,
        },
        {
          id: "bluesky-studio",
          slug: "bluesky-studio",
          platform: "bluesky",
          account_id: "bsky-studio",
          account_username: "openpost_studio",
          account_avatar_url: "https://cdn.example/image-editor.jpg",
          instance_url: "",
          is_active: true,
          thread_replies_supported: false,
        },
      ],
    });
  });
  await page.route("**/api/v1/provider-readiness?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        providers: [
          {
            provider: "bluesky",
            configured_app_state: "ready",
            connected_accounts: 2,
            blocking_issues: [],
            next_actions: [],
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    const payload = route.request().postDataJSON() as {
      account_ids: string[];
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: payload.account_ids.map((accountID) => ({
          account_id: accountID,
          provider: "bluesky",
          profile: "short_text",
          output_profile: "bluesky.post",
          label: "Bluesky post",
          text_limit: 300,
          media: {
            min_count: 0,
            max_count: 1,
            allowed_mimes: [],
            requires_public_url: false,
            requires_https_fetchable: false,
          },
          intents: ["post"],
          media_shapes: ["text"],
          settings: [],
          setting_groups: [],
          compatible: true,
          active_constraints: {},
          issues: [],
          capability_revision: "test-v1",
          dynamic_options: {},
        })),
      },
    });
  });
  await page.route("**/api/v1/posts/draft", async (route) => {
    const body = route.request().postDataJSON() as {
      publication?: PostPayload;
    };
    publicationPayload = body.publication;
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-preview",
        publication_id: "publication-preview",
        revision: 1,
        updated_at: "2026-08-05T12:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/posts/post-preview/draft", async (route) => {
    const body = route.request().postDataJSON() as {
      publication?: PostPayload;
    };
    publicationPayload = body.publication;
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-preview",
        publication_id: "publication-preview",
        revision: 2,
        updated_at: "2026-08-05T12:00:01Z",
      },
    });
  });
  await page.route("**/api/v1/posts/post-preview", async (route) => {
    if (route.request().method() === "DELETE") {
      deleteRequested = true;
      await route.fulfill({ contentType: "application/json", json: {} });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/publications", async (route) => {
    if (route.request().method() === "POST") {
      publicationPayload = JSON.parse(route.request().postData() ?? "{}") as PostPayload;

      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "publication-preview",
          workspace_id: publicationPayload.workspace_id,
          revision: 1,
          title: "Launch update",
          content_profile: publicationPayload.content_profile,
          source_text: publicationPayload.source_text,
          source_url: publicationPayload.source_url,
          status: "draft",
          renditions: [],
        },
      });
      return;
    }

    await route.continue();
  });
  await page.route(/\/api\/v1\/publications\/publication-preview(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PUT") {
      publicationPayload = {
        ...publicationPayload,
        ...(route.request().postDataJSON() as PostPayload),
      };
      await route.fulfill({
        contentType: "application/json",
        json: { revision: 2 },
      });
      return;
    }
    if (route.request().method() === "DELETE") {
      deleteRequested = true;
      await route.fulfill({
        contentType: "application/json",
        json: { message: "publication deleted" },
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/publications/publication-preview/renditions", async (route) => {
    if (route.request().method() === "PUT") {
      publicationPayload = {
        ...publicationPayload,
        ...(route.request().postDataJSON() as PostPayload),
      };
      await route.fulfill({ contentType: "application/json", json: {} });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("text-thread-composer-shell")).toBeVisible();
  await expect(page.getByTestId("composer-action-controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await expect(page.getByLabel("Composer workspace")).toHaveCount(0);
  await page.getByLabel("Post text").fill("Launch update");

  await expect(page.locator('[data-testid="instagram-preview"]')).toHaveCount(0);
  await expect(page.getByLabel(/Remove .* from targets/)).toHaveCount(0);
  const accountControl = page.getByTestId("composer-account-control");
  await expect(accountControl).toHaveAttribute(
    "aria-label",
    "Accounts: @openpost_main, Bluesky; @openpost_studio, Bluesky",
  );
  await expect(accountControl.getByTestId("composer-account-icon")).toHaveCount(2);
  await accountControl.click();
  await expect(page.getByTestId("composer-account-row")).toHaveCount(2);
  const accountPicker = page.getByRole("group", { name: "Accounts" });
  await expect(accountPicker.getByText("@openpost_main", { exact: true })).toBeVisible();
  await expect(accountPicker.getByText("@openpost_studio", { exact: true })).toBeVisible();
  const mainAccountRow = page
    .getByTestId("composer-account-row")
    .filter({ hasText: "openpost_main" });
  await expect(mainAccountRow.locator('[data-slot="social-account-platform"]')).toHaveText(
    "Bluesky",
  );
  await expect(mainAccountRow.locator('[data-slot="avatar-image"]')).toHaveAttribute(
    "src",
    "https://cdn.example/main.jpg",
  );
  await expect
    .poll(() =>
      mainAccountRow
        .locator('[data-slot="avatar-image"]')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await accountPicker.screenshot({ path: testInfo.outputPath("composer-390-account-picker.png") });
  await mainAccountRow.getByText("@openpost_main", { exact: true }).click();
  await expect(accountControl.getByTestId("composer-account-icon")).toHaveCount(1);
  await mainAccountRow.getByText("@openpost_main", { exact: true }).click();
  await expect(accountControl.getByTestId("composer-account-icon")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect.poll(() => publicationPayload).toBeTruthy();
  const deleteAction = await composerDeliveryAction(page, "Delete");
  await expect(deleteAction).toBeVisible();
  await page.keyboard.press("Escape");

  expect(publicationPayload).toMatchObject({
    content_profile: "short_text",
    source_text: "Launch update",
    renditions: expect.arrayContaining([
      expect.objectContaining({
        social_account_id: "bluesky-main",
        profile: "short_text",
        body: "Launch update",
      }),
      expect.objectContaining({
        social_account_id: "bluesky-studio",
        profile: "short_text",
        body: "Launch update",
      }),
    ]),
  });
  expect(publicationPayload?.source_url ?? "").toBe("");
  for (const rendition of publicationPayload?.renditions ?? []) {
    expect(rendition.settings).not.toHaveProperty("url");
    expect(rendition.settings?.link_url ?? "").toBe("");
  }

  await accountControl.click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  const validationControl = page.getByTestId("composer-validation-control");
  await expect(validationControl).toBeVisible();
  await validationControl.click();
  await expect(page.getByText("Choose at least one account.")).toBeVisible();
  await page.keyboard.press("Escape");

  await clickComposerDeliveryAction(page, "Delete");
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => deleteRequested).toBe(true);
});

test("the composer tolerates repeated destination validation identities", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `composer-video-validation-${unique}@example.com`;
  const pageErrors: Error[] = [];

  page.on("pageerror", (error) => pageErrors.push(error));

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Video Validation E2E");
  await authenticatePage(page, auth.token);

  const accounts = [
    {
      id: "youtube-main",
      slug: "youtube-main",
      platform: "youtube",
      account_id: "youtube-channel",
      account_username: "OpenPost",
      account_avatar_url: "",
      instance_url: "",
      is_active: true,
      thread_replies_supported: false,
    },
    {
      id: "linkedin-main",
      slug: "linkedin-main",
      platform: "linkedin",
      account_id: "linkedin-profile",
      account_username: "openpost",
      account_avatar_url: "",
      instance_url: "",
      is_active: true,
      thread_replies_supported: false,
    },
  ];

  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: accounts });
  });
  await page.route("**/api/v1/provider-readiness?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        providers: ["youtube", "linkedin"].map((provider) => ({
          provider,
          configured_app_state: "ready",
          connected_accounts: 1,
          blocking_issues: [],
          next_actions: [],
        })),
      },
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    const payload = route.request().postDataJSON() as {
      account_ids: string[];
      creation_preset: "post" | "thread";
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: payload.account_ids.map((accountID) => {
          const provider = accountID.startsWith("youtube") ? "youtube" : "linkedin";
          return {
            account_id: accountID,
            provider,
            profile: "long_video",
            output_profile: `${provider}.video`,
            label: `${provider} video`,
            text_limit: 3000,
            media: {
              min_count: 1,
              max_count: 1,
              allowed_mimes: ["video/mp4"],
              requires_public_url: false,
              requires_https_fetchable: false,
            },
            intents: ["short_video", "video"],
            media_shapes: ["video"],
            settings:
              provider === "youtube"
                ? [
                    {
                      key: "title",
                      message_key: "publishing.setting.title",
                      label: "Title",
                      group: "content",
                      control: "text",
                      type: "text",
                      scope: "destination",
                      intents: ["video"],
                      output_profiles: ["youtube.video"],
                      media_shapes: ["video"],
                      required: true,
                      required_policy: "always",
                      constraints: {},
                    },
                  ]
                : [],
            setting_groups: [],
            compatible: false,
            active_constraints: {},
            issues: [
              {
                code: "media_required",
                field: "media",
                media_id: "",
                message: "Add a video.",
                fallback_message: "Add a video.",
                severity: "error",
                provider,
              },
              ...(provider === "youtube"
                ? [
                    {
                      code: "title_required",
                      field: "title",
                      media_id: "",
                      message: "Add a title for YouTube.",
                      fallback_message: "Add a title for YouTube.",
                      severity: "error",
                      provider,
                    },
                  ]
                : []),
            ],
            capability_revision: "test-v1",
            dynamic_options: {},
          };
        }),
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("text-thread-composer-shell")).toBeVisible();
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  await expect(
    page.getByTestId("composer-account-control").getByTestId("composer-account-icon"),
  ).toHaveCount(2);
  await page.getByLabel("Post text").fill("Video description");

  await page.getByTestId("composer-account-control").click();
  await expect(page.getByText("Add a video.", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const validationControl = page.getByTestId("composer-validation-control");
  await expect(validationControl).toBeVisible();
  await validationControl.click();
  await expect(page.getByText("Add a video.", { exact: true })).toHaveCount(1);
  const targetedIssue = page.getByRole("button", {
    name: "Edit: OpenPost · YouTube: Add a title for YouTube.",
  });
  await expect(targetedIssue).toBeVisible();
  await targetedIssue.click();
  const youtubeTab = page.locator("#composer-destination-youtube-main");
  await expect(youtubeTab).toHaveAttribute("aria-selected", "true");
  const destinationDialog = page.getByRole("dialog");
  await expect(destinationDialog).toBeVisible();
  await expect(destinationDialog.locator("#destination-setting-title")).toBeFocused();
  await destinationDialog.getByRole("button", { name: "Close" }).click();

  expect(pageErrors.filter((error) => error.message.includes("each_key_duplicate"))).toEqual([]);
});
