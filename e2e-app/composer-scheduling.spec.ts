import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

type PostPayload = {
  workspace_id?: string;
  source_text?: string;
  source_url?: string;
  content_profile?: string;
  scheduled_at?: string;
  renditions?: Array<{
    social_account_id?: string;
    profile?: string;
    body?: string;
    media?: unknown[];
  }>;
  media?: unknown[];
  [key: string]: unknown;
};

test("composer quick-schedules a publication from the selected time", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `composer-scheduling-${unique}@example.com`;
  const postContent = "Schedule this launch note from the composer.";
  let publicationPayload: PostPayload | undefined;
  let scheduleRequested = false;

  const auth = await registerUser(request, email);
  const workspaceBody = await createWorkspace(
    request,
    auth.token,
    "Composer Scheduling E2E",
  );

  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        profiles: [],
        capabilities: [
          {
            provider: "bluesky",
            profile: "short_video",
            label: "Short video",
            media: {
              min_count: 0,
              max_count: 4,
              allowed_mimes: [],
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
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "bluesky-main",
          slug: "bluesky-main",
          platform: "bluesky",
          account_id: "bsky-main",
          account_username: "openpost.bsky.social",
          account_avatar_url: "",
          instance_url: "",
          is_active: true,
          thread_replies_supported: true,
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
            connected_accounts: 1,
            blocking_issues: [],
            next_actions: [],
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
            account_id: "bluesky-main",
            provider: "bluesky",
            profile: "short_video",
            output_profile: "bluesky.video",
            label: "Bluesky video",
            text_limit: 300,
            media: {
              min_count: 0,
              max_count: 4,
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
          },
        ],
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
          id: "publication-schedule",
          workspace_id: publicationPayload.workspace_id,
          revision: 1,
          title: "Short text",
          content_profile: publicationPayload.content_profile,
          source_text: publicationPayload.source_text,
          status: "draft",
          scheduled_at: publicationPayload.scheduled_at ?? "",
          renditions: [],
        },
      });
      return;
    }

    await route.continue();
  });
  await page.route(
    "**/api/v1/publications/publication-schedule",
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
  await page.route(
    "**/api/v1/publications/publication-schedule/renditions",
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
  await page.route("**/api/v1/publications/*/validate", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          publication_id: "publication-schedule",
          issues: [],
        },
      });
      return;
    }

    await route.continue();
  });
  await page.route("**/api/v1/publications/*/schedule", async (route) => {
    if (route.request().method() === "POST") {
      scheduleRequested = true;
      await route.fulfill({
        contentType: "application/json",
        json: {
          message: "Publication scheduled",
          job_id: "job-publication-schedule",
        },
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/");
  await page.getByTestId("composer-mode-select").click();
  await page.getByRole("option", { name: "Short video" }).click();
  await expect(
    page.getByRole("button", { name: "Target accounts" }),
  ).toBeVisible();
  await expect(page.getByTestId("composer-action-controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByTestId("composer-media-dropzone")).toBeVisible();
  await page.getByLabel("Caption").fill(postContent);
  await page.getByRole("button", { name: "Schedule" }).first().click();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 2);
  const futureDateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(futureDate);
  const scheduleDialog = page.getByTestId("schedule-dialog-shell");
  await expect(scheduleDialog).toBeVisible();
  await scheduleDialog
    .getByRole("button", { name: futureDateLabel, exact: true })
    .click();
  await scheduleDialog
    .getByRole("button", { name: "10:30", exact: true })
    .click();
  await scheduleDialog.getByRole("button", { name: "Done" }).click();
  await expect(scheduleDialog).toBeHidden();

  const quickSchedule = page.getByRole("button", {
    name: /^Schedule for .* 10:30$/,
  });
  await expect(quickSchedule).toBeEnabled();
  await expect(quickSchedule.locator(".lucide-send")).toBeVisible();
  await quickSchedule.click();

  await expect(page.getByText("Publication scheduled")).toBeVisible();
  await expect.poll(() => publicationPayload).toBeTruthy();
  await expect.poll(() => scheduleRequested).toBe(true);

  expect(publicationPayload).toMatchObject({
    workspace_id: workspaceBody.id,
    content_profile: "short_video",
    source_text: postContent,
    media: [],
    renditions: [
      expect.objectContaining({
        social_account_id: "bluesky-main",
        profile: "short_video",
        body: postContent,
        settings: {},
        media: [],
      }),
    ],
  });
  expect(publicationPayload?.source_url).toBeUndefined();
  expect(publicationPayload?.scheduled_at).toBeTruthy();
  expect(new Date(publicationPayload?.scheduled_at ?? "").toString()).not.toBe(
    "Invalid Date",
  );
});
