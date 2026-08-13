import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const scheduledAt = "2026-08-12T15:30:00Z";

function mediaSummary(id: string, filename: string) {
  return {
    id,
    mime_type: "video/mp4",
    size: 1024,
    original_filename: filename,
    width: 1920,
    height: 1080,
    duration_ms: 12_000,
    frame_rate: 30,
    aspect_ratio: "16:9",
    dominant_type: "video",
    analysis_status: "ready",
    public_url_ready: true,
    public_url_status: 200,
    url: "/assets/logo.svg",
  };
}

const originalVideo = mediaSummary("video-old", "launch-original.mp4");
const returnedVideo = mediaSummary("video-new", "launch-landscape.mp4");

test("composer preserves its draft through Image cancel and Video replacement", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `composer-editor-handoff-${unique}@example.com`,
  );
  const workspace = await createWorkspace(
    request,
    auth.token,
    "Composer editor handoff E2E",
  );
  await authenticatePage(page, auth.token);

  const pageErrors: Error[] = [];
  const draftWrites: Array<Record<string, unknown>> = [];
  const videoTokenBodies: Array<Record<string, unknown>> = [];
  let nextRevision = 4;

  const publication = {
    id: "publication-handoff",
    text_post_id: "post-handoff",
    workspace_id: workspace.id,
    created_by: "user-handoff",
    title: "Scheduled launch",
    intent: "post",
    creation_preset: "post",
    content_profile: "video",
    source_text: "Scheduled launch",
    status: "draft",
    revision: 3,
    scheduled_at: scheduledAt,
    metadata: {},
    created_at: "2026-08-09T10:00:00Z",
    updated_at: "2026-08-09T10:00:00Z",
    renditions: [
      {
        id: "rendition-youtube",
        publication_id: "publication-handoff",
        social_account_id: "youtube-main",
        platform: "youtube",
        profile: "video",
        output_profile: "youtube.video",
        format_locked: true,
        body: "Scheduled launch",
        title: "",
        description: "",
        settings: {},
        status: "draft",
        error_retryable: false,
        segments: [],
        media: [originalVideo],
      },
    ],
    segments: [],
    media: [originalVideo],
    repost_override: { mode: "inherit" },
  };

  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "youtube-main",
          slug: "youtube-main",
          platform: "youtube",
          account_id: "youtube-channel",
          account_username: "OpenPost Video",
          account_avatar_url: "",
          instance_url: "",
          is_active: true,
          thread_replies_supported: false,
        },
      ],
    });
  });
  await page.route("**/api/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        profiles: [],
        capabilities: [
          {
            provider: "youtube",
            profile: "video",
            output_profile: "youtube.video",
            label: "YouTube video",
            media: {
              min_count: 1,
              max_count: 1,
              allowed_mimes: ["video/mp4"],
              max_duration_seconds: 3600,
              max_size_bytes: 1_000_000_000,
              aspect_ratios: ["16:9"],
              requires_public_url: false,
              requires_https_fetchable: false,
            },
            native_scheduling: false,
            openpost_queued: true,
            requires_app_review: false,
            requires_public_media: false,
            settings: [],
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/capabilities/resolve", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        accounts: [
          {
            account_id: "youtube-main",
            provider: "youtube",
            profile: "video",
            output_profile: "youtube.video",
            label: "YouTube video",
            text_limit: 5000,
            media: {
              min_count: 1,
              max_count: 1,
              allowed_mimes: ["video/mp4"],
              max_duration_seconds: 3600,
              max_size_bytes: 1_000_000_000,
              aspect_ratios: ["16:9"],
              requires_public_url: false,
              requires_https_fetchable: false,
            },
            intents: ["post"],
            media_shapes: ["video"],
            settings: [],
            setting_groups: [],
            compatible: true,
            active_constraints: { media_shape: "video" },
            issues: [],
            capability_revision: "handoff-e2e-v1",
            dynamic_options: {},
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/provider-readiness?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        providers: [
          {
            provider: "youtube",
            configured_app_state: "ready",
            connected_accounts: 1,
            blocking_issues: [],
            next_actions: [],
          },
        ],
      },
    });
  });
  await page.route(
    /\/api\/v1\/publications\/publication-handoff(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          contentType: "application/json",
          json: { revision: nextRevision++ },
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: publication,
      });
    },
  );
  await page.route("**/api/v1/posts/post-handoff/draft", async (route) => {
    draftWrites.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-handoff",
        publication_id: "publication-handoff",
        revision: nextRevision++,
        updated_at: new Date().toISOString(),
      },
    });
  });
  await page.route("**/api/v1/media**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/media/tags")) {
      await route.fulfill({
        contentType: "application/json",
        json: { tags: [], can_edit: true },
      });
      return;
    }
    if (url.pathname.endsWith("/media/metadata")) {
      const requestedIDs = (url.searchParams.get("media_ids") ?? "").split(",");
      await route.fulfill({
        contentType: "application/json",
        json: {
          media: [originalVideo, returnedVideo].filter((item) =>
            requestedIDs.includes(item.id),
          ),
        },
      });
      return;
    }
    if (/\/media\/video-old$/u.test(url.pathname)) {
      await route.fulfill({
        contentType: "video/mp4",
        headers: { "Content-Length": "0" },
        body: "",
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        media: [
          {
            ...originalVideo,
            workspace_id: workspace.id,
            thumbnail_url: "/assets/logo.svg",
            alt_text: "",
            is_favorite: false,
            can_delete: true,
            processing_status: "ready",
            processing_progress: 100,
            usage_count: 1,
          },
        ],
        total: 1,
      },
    });
  });
  await page.route("**/api/v1/image-editor/return-tokens", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        token: "image-handoff-token",
        expires_at: "2099-08-09T12:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/video-editor/return-tokens", async (route) => {
    videoTokenBodies.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    await route.fulfill({
      contentType: "application/json",
      json: {
        token: "video-handoff-token",
        expires_at: "2099-08-09T12:00:00Z",
      },
    });
  });
  await page.route(
    "**/api/v1/video-editor/return-tokens/video-handoff-token/consume",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          workspace_id: workspace.id,
          return_url: "/publications/publication-handoff",
          purpose: "post_media",
          constraints: {
            thread_segment: 0,
            rendition_ids: ["rendition-youtube"],
            required_variants: ["landscape"],
          },
          result: {
            project_id: "video-project-handoff",
            exports: [
              {
                variant_id: "landscape",
                media_id: "video-new",
                width: 1920,
                height: 1080,
                duration_ms: 12_000,
                rendition_ids: ["rendition-youtube"],
              },
            ],
          },
        },
      });
    },
  );

  await page.goto("/publications/publication-handoff");
  const composer = page.getByTestId("text-thread-composer-content");
  await expect(composer).toBeVisible();
  await composer
    .getByRole("textbox", { name: "Description" })
    .fill("Edited launch copy survives both editors.");

  await composer.getByRole("button", { name: "Add media" }).click();
  let picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/image-editor\/new\?/u);
  await page.getByRole("button", { name: "Back to post" }).click();
  await expect(page).toHaveURL(/\/publications\/publication-handoff$/u);
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Edited launch copy survives both editors.",
  );
  await expect(page.getByTestId("composer-account-icon")).toHaveCount(1);

  await composer.getByRole("button", { name: "Add media" }).click();
  picker = page.getByRole("dialog");
  await picker.getByRole("tab", { name: "Library" }).click();
  await picker
    .getByRole("button", { name: "Edit in OpenPost Video Editor" })
    .click();
  await expect(page).toHaveURL(/\/video-editor\/new\?/u);
  expect(new URL(page.url()).searchParams.get("source_media")).toBe(
    "video-old",
  );
  expect(new URL(page.url()).searchParams.get("required_variants")).toBe(
    "landscape",
  );
  expect(videoTokenBodies).toHaveLength(1);
  expect(videoTokenBodies[0]).toMatchObject({
    workspace_id: workspace.id,
    return_url: "/publications/publication-handoff",
    purpose: "post_media",
    constraints: {
      replace_media_id: "video-old",
      rendition_ids: ["rendition-youtube"],
      required_variants: ["landscape"],
    },
  });

  await page.goto(
    "/publications/publication-handoff?video_editor_return=video-handoff-token",
  );
  await expect(page).toHaveURL(/\/publications\/publication-handoff$/u);
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Edited launch copy survives both editors.",
  );
  await expect(page.getByTestId("composer-account-icon")).toHaveCount(1);
  await expect
    .poll(() => draftWrites.at(-1)?.media_ids, { timeout: 10_000 })
    .toEqual(["video-new"]);
  expect(draftWrites.at(-1)).toMatchObject({
    social_account_ids: ["youtube-main"],
  });
  expect(Date.parse(String(draftWrites.at(-1)?.scheduled_at))).toBe(
    Date.parse(scheduledAt),
  );
  expect(pageErrors).toEqual([]);
});
