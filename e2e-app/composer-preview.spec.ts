import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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

test("composer renders account-specific renditions", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `composer-preview-${unique}@example.com`;
  let publicationPayload: PostPayload | undefined;
  let deleteRequested = false;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Composer Preview E2E");

  await authenticatePage(page, auth.token);
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
          account_avatar_url: "https://cdn.example/studio.jpg",
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
          profile: "short_video",
          output_profile: "bluesky.video",
          label: "Bluesky video",
          text_limit: 300,
          media: {
            min_count: 0,
            max_count: 1,
            allowed_mimes: [],
            requires_public_url: false,
            requires_https_fetchable: false,
          },
          intents: ["short_video"],
          media_shapes: ["video"],
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
  await page.route("**/api/v1/publications", async (route) => {
    if (route.request().method() === "POST") {
      publicationPayload = JSON.parse(
        route.request().postData() ?? "{}",
      ) as PostPayload;

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
  await page.route(
    /\/api\/v1\/publications\/publication-preview(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() === "PUT") {
        publicationPayload = {
          ...(publicationPayload ?? {}),
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
    },
  );
  await page.route(
    "**/api/v1/publications/publication-preview/renditions",
    async (route) => {
      if (route.request().method() === "PUT") {
        publicationPayload = {
          ...(publicationPayload ?? {}),
          ...(route.request().postDataJSON() as PostPayload),
        };
        await route.fulfill({ contentType: "application/json", json: {} });
        return;
      }
      await route.continue();
    },
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("composer-mode-select").click();
  await page.getByRole("option", { name: "Short video" }).click();
  await expect(
    page.getByRole("button", { name: "Target accounts" }),
  ).toBeVisible();
  await expect(page.getByTestId("composer-action-controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByTestId("composer-media-dropzone")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect(page.getByLabel("Composer workspace")).toHaveCount(0);
  await page.getByLabel("Caption").fill("Launch update");

  await expect(page.locator('[data-testid="instagram-preview"]')).toHaveCount(
    0,
  );
  await expect(page.getByLabel(/Remove .* from targets/)).toHaveCount(0);
  const accountControl = page.getByTestId("composer-account-control");
  await expect(accountControl.getByTestId("composer-account-icon")).toHaveCount(
    2,
  );
  await accountControl.click();
  await expect(page.getByTestId("composer-account-row")).toHaveCount(2);
  await expect(page.getByText("@openpost_main", { exact: true })).toBeVisible();
  await expect(
    page.getByText("@openpost_studio", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => publicationPayload).toBeTruthy();
  await expect(page.getByTestId("composer-delete")).toBeVisible();

  expect(publicationPayload).toMatchObject({
    content_profile: "short_video",
    source_text: "Launch update",
    renditions: [
      expect.objectContaining({
        social_account_id: "bluesky-main",
        profile: "short_video",
        body: "Launch update",
      }),
      expect.objectContaining({
        social_account_id: "bluesky-studio",
        profile: "short_video",
        body: "Launch update",
      }),
    ],
  });
  expect(publicationPayload?.source_url).toBeUndefined();
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

  await page.getByTestId("composer-delete").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect.poll(() => deleteRequested).toBe(true);
});

test("video composers tolerate repeated destination validation identities", async ({
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
      intent: "short_video" | "video";
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: payload.account_ids.map((accountID) => {
          const provider = accountID.startsWith("youtube")
            ? "youtube"
            : "linkedin";
          return {
            account_id: accountID,
            provider,
            profile: payload.intent === "video" ? "long_video" : "short_video",
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
            settings: [],
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
            ],
            capability_revision: "test-v1",
            dynamic_options: {},
          };
        }),
      },
    });
  });

  await page.goto("/");

  for (const mode of ["short_video", "video"] as const) {
    await page.getByTestId("composer-mode-select").click();
    await page.getByTestId(`composer-mode-option-${mode}`).click();

    await expect(page.getByTestId("focused-composer")).toBeVisible();
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    await expect(
      page
        .getByTestId("composer-account-control")
        .getByTestId("composer-account-icon"),
    ).toHaveCount(2);

    await page.getByTestId("composer-account-control").click();
    await expect(page.getByText("Add a video.", { exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");

    const validationControl = page.getByTestId("composer-validation-control");
    await expect(validationControl).toBeVisible();
    await validationControl.click();
    await expect(page.getByText("Add a video.", { exact: true })).toHaveCount(
      1,
    );
    await page.keyboard.press("Escape");

    expect(
      pageErrors.filter((error) =>
        error.message.includes("each_key_duplicate"),
      ),
    ).toEqual([]);
  }
});
