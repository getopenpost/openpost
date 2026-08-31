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

function publicationReadiness(state: string, publishable: boolean, blocker?: string) {
  return {
    state,
    executable: publishable,
    connectable: false,
    publishable,
    advertisable: false,
    facts: {
      configuration: "configured",
      local_test: "passed",
      live_certification: "passed",
      approval: "approved",
      authorization: "authorized",
      control: "enabled",
      policy: state === "policy_restricted" ? "restricted" : "allowed",
    },
    blockers: blocker ? [{ code: blocker }] : [],
  };
}

test("composer uses the exact immediate and scheduled readiness decisions", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `composer-scheduling-${unique}@example.com`;
  const postContent = "Schedule this launch note from the composer.";
  let publicationPayload: PostPayload | undefined;
  let scheduleAttempts = 0;
  let injectChangedDestinationValidation = true;
  let retryQueued = false;

  const destinationOutcomes = () => [
    {
      id: "rendition-live",
      social_account_id: "account-live",
      target_key: "live",
      platform: "youtube",
      status: "published",
      delivery: { state: "live", recovery_action: "none" },
    },
    {
      id: "rendition-pending",
      social_account_id: "bluesky-main",
      target_key: "bluesky",
      platform: "bluesky",
      status: "scheduled",
      delivery: { state: "queued", recovery_action: "none" },
    },
    {
      id: "rendition-retry",
      social_account_id: "account-retry",
      target_key: "x",
      platform: "x",
      status: retryQueued ? "scheduled" : "failed",
      delivery: retryQueued
        ? { state: "queued", recovery_action: "none" }
        : {
            state: "rejected",
            error_kind: "provider_http",
            error_code: "rate_limited",
            recovery_action: "retry",
          },
    },
    {
      id: "rendition-ambiguous",
      social_account_id: "account-ambiguous",
      target_key: "threads",
      platform: "threads",
      status: "failed",
      delivery: { state: "ambiguous", recovery_action: "reconcile" },
    },
  ];

  const auth = await registerUser(request, email);
  const workspaceBody = await createWorkspace(request, auth.token, "Composer Scheduling E2E");

  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        profiles: [],
        capabilities: [
          {
            provider: "bluesky",
            profile: "short_text",
            output_profile: "bluesky.post",
            label: "Bluesky post",
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
            profile: "short_text",
            output_profile: "bluesky.post",
            label: "Bluesky post",
            text_limit: 300,
            media: {
              min_count: 0,
              max_count: 4,
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
            immediate_readiness: publicationReadiness(
              "policy_restricted",
              false,
              "policy_restricted",
            ),
            scheduled_readiness: publicationReadiness("healthy", true),
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/repost-automation*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        workspace_id: workspaceBody.id,
        can_manage: true,
        supported_platforms: ["bluesky"],
        policies: [],
        accounts: [
          {
            id: "bluesky-main",
            workspace_id: workspaceBody.id,
            workspace_name: "Composer Scheduling E2E",
            platform: "bluesky",
            username: "openpost.bsky.social",
            supports_repost: true,
            cross_workspace: false,
            grant_required: false,
            grant_active: true,
          },
        ],
        grants: [],
      },
    });
  });
  await page.route(`**/api/v1/workspaces/${workspaceBody.id}/setup`, async (route) => {
    const activated = scheduleAttempts >= 2;
    await route.fulfill({
      contentType: "application/json",
      json: {
        activated,
        visible: !activated,
        completed_steps: activated ? 4 : 3,
        total_steps: 4,
        next_step: activated ? undefined : "publication",
        next_action: activated ? undefined : "create_publication",
        action_href: activated ? undefined : "/",
        steps: [
          { id: "workspace", completed: true },
          { id: "destination", completed: true },
          { id: "composition", completed: true },
          { id: "publication", completed: activated },
        ],
      },
    });
  });
  await page.route("**/api/v1/posts/draft", async (route) => {
    const body = route.request().postDataJSON() as {
      publication?: PostPayload;
      workspace_id?: string;
    };
    publicationPayload = {
      ...(body.publication ?? {}),
      workspace_id: body.workspace_id,
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-schedule",
        publication_id: "publication-schedule",
        revision: 1,
        updated_at: "2026-08-05T12:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/posts/post-schedule/draft", async (route) => {
    const body = route.request().postDataJSON() as {
      publication?: PostPayload;
    };
    publicationPayload = {
      ...(publicationPayload ?? {}),
      ...(body.publication ?? {}),
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        post_id: "post-schedule",
        publication_id: "publication-schedule",
        revision: 2,
        updated_at: "2026-08-05T12:00:01Z",
      },
    });
  });
  await page.route("**/api/v1/publications", async (route) => {
    if (route.request().method() === "POST") {
      publicationPayload = JSON.parse(route.request().postData() ?? "{}") as PostPayload;

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
  await page.route("**/api/v1/publications/publication-schedule", async (route) => {
    if (route.request().method() === "PUT") {
      publicationPayload = {
        ...(publicationPayload ?? {}),
        ...(route.request().postDataJSON() as PostPayload),
      };
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "publication-schedule",
          revision: 2,
          status: "draft",
          workspace_id: publicationPayload.workspace_id,
          title: "Short text",
          content_profile: publicationPayload.content_profile,
          source_text: publicationPayload.source_text,
          scheduled_at: publicationPayload.scheduled_at ?? "",
          renditions: [],
        },
      });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "publication-schedule",
          renditions: destinationOutcomes(),
        },
      });
      return;
    }
    await route.continue();
  });

  await page.route(
    "**/api/v1/publications/publication-schedule/renditions/account-retry/retry?**",
    async (route) => {
      const retryOutcome = destinationOutcomes().find(
        (outcome) => outcome.id === "rendition-retry",
      );
      expect(retryOutcome).toMatchObject({
        status: "failed",
        delivery: { recovery_action: "retry" },
      });
      retryQueued = true;
      await route.fulfill({
        contentType: "application/json",
        json: {
          message: "destination retry queued",
          job_id: "retry-job",
          publication_id: "publication-schedule",
          renditions: destinationOutcomes(),
        },
      });
    },
  );
  await page.route("**/api/v1/publications/publication-schedule/renditions", async (route) => {
    if (route.request().method() === "PUT") {
      publicationPayload = {
        ...(publicationPayload ?? {}),
        ...(route.request().postDataJSON() as PostPayload),
      };
      await route.fulfill({ contentType: "application/json", json: {} });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/publications/*/validate", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          publication_id: "publication-schedule",
          issues:
            scheduleAttempts === 1 && injectChangedDestinationValidation
              ? [
                  {
                    code: "text_too_long",
                    field: "body",
                    segment_id: "segment:0",
                    message: "Shorten this Bluesky post before scheduling.",
                    fallback_message: "Shorten this Bluesky post before scheduling.",
                    severity: "error",
                    provider: "bluesky",
                  },
                ]
              : [],
        },
      });
      return;
    }

    await route.continue();
  });
  await page.route("**/api/v1/publications/*/schedule", async (route) => {
    if (route.request().method() === "POST") {
      scheduleAttempts += 1;
      if (scheduleAttempts === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/problem+json",
          json: {
            title: "Publication changed",
            status: 422,
            detail: "Destination validation changed before scheduling.",
          },
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          message: "Publication scheduled",
          job_id: "job-publication-schedule",
          workspace_activated: true,
          activation_publication_id: "publication-schedule",
          publication_id: "publication-schedule",
          renditions: destinationOutcomes(),
        },
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByTestId("text-thread-composer-shell")).toBeVisible();
  await expect(page.getByTestId("composer-action-controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  const ideateWithAI = page.getByRole("button", { name: "Ideate" });
  await expect(ideateWithAI).toBeVisible();
  await expect(ideateWithAI).toBeEnabled();
  await page.getByLabel("Post text").fill(postContent);
  const buildWithAI = page.getByRole("button", { name: "Build with AI" });
  await expect(buildWithAI).toBeVisible();
  await expect(buildWithAI).toBeEnabled();
  await page.getByRole("button", { name: "Add post" }).click();
  await page.getByLabel("Post text").nth(1).fill("The second post keeps the outcome panel shared.");
  await expect(await composerDeliveryAction(page, "Publish Now")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("composer-account-control").click();
  await expect(page.getByTestId("composer-account-row")).toContainText(
    "Publish now: The selected Bluesky account, format, or publishing policy is blocked.",
  );
  await page.keyboard.press("Escape");
  await page
    .getByTestId("desktop-composer-controls")
    .getByRole("button", { name: "Post settings", exact: true })
    .click();
  const settingsSheet = page.getByTestId("composer-settings-sheet");
  await expect(settingsSheet).toBeVisible();
  await settingsSheet.getByRole("button", { name: "Repost settings" }).click();
  await page.getByText("Custom", { exact: true }).click();
  const repostTarget = page.getByRole("checkbox", {
    name: "@openpost.bsky.social Bluesky",
    exact: true,
  });
  await expect(repostTarget).toBeVisible();
  if (!(await repostTarget.isChecked())) await repostTarget.click();
  await page.getByLabel("Minimum likes").fill("10");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await clickComposerDeliveryAction(page, "Schedule");
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
    .getByRole("button", {
      name: futureDateLabel,
      exact: true,
    })
    .click();
  await scheduleDialog.getByRole("button", { name: "10:30", exact: true }).click();
  await scheduleDialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(scheduleDialog).toBeHidden();

  const quickSchedule = page.getByRole("button", {
    name: /^Schedule for .* 10:30$/,
  });
  await expect(quickSchedule).toBeEnabled();
  await expect(quickSchedule.locator(".lucide-calendar-clock")).toBeVisible();

  await expect(page.getByLabel("Post text").first()).toBeFocused();
  await expect(page.getByText("Fix the blocking issues before scheduling.")).toBeVisible();
  const validationControl = page.getByTestId("composer-validation-control");
  await validationControl.click();
  await expect(
    page.getByRole("button", {
      name: "Edit: @openpost.bsky.social · Bluesky: Shorten this Bluesky post before scheduling.",
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  injectChangedDestinationValidation = false;
  await quickSchedule.click();

  await expect(page.getByText("Scheduled!", { exact: true })).toBeVisible();
  const outcomes = page.getByTestId("composer-delivery-feedback");
  await expect(outcomes).toContainText("Workspace activated");
  await expect(outcomes).toContainText("1 succeeded · 1 pending · 1 failed · 1 need review");
  await expect(outcomes.getByText("Live", { exact: true })).toBeVisible();
  await expect(outcomes.getByRole("paragraph").filter({ hasText: /^YouTube$/u })).toBeVisible();
  await expect(outcomes.getByText("Queued", { exact: true })).toBeVisible();
  await expect(outcomes.getByText("provider_http · rate_limited")).toBeVisible();
  await expect(
    outcomes.getByText("OpenPost is checking the provider before another send."),
  ).toBeVisible();
  await expect(outcomes.getByRole("link", { name: "View publication" })).toHaveAttribute(
    "href",
    "/publications/publication-schedule",
  );
  await expect(quickSchedule).toBeDisabled();
  await outcomes.getByRole("button", { name: "Retry destination" }).click();
  await expect(outcomes.getByText("Queued", { exact: true })).toHaveCount(2);
  await expect(outcomes.getByRole("button", { name: "Retry destination" })).toHaveCount(0);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(outcomes).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBeFalsy();
  }
  await expect(page.getByTestId("workspace-activation-completion")).toHaveCount(0);
  await expect(page.getByTestId("workspace-setup-guide-composer")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-celebrating-schedule", "true");
  await expect.poll(() => publicationPayload).toBeTruthy();
  await expect.poll(() => scheduleAttempts).toBe(2);

  expect(publicationPayload).toMatchObject({
    workspace_id: workspaceBody.id,
    content_profile: "thread",
    source_text: postContent,
    renditions: [
      expect.objectContaining({
        social_account_id: "bluesky-main",
        profile: "short_text",
        body: postContent,
        settings: {},
        media: [],
      }),
    ],
    repost_override: {
      mode: "custom",
      target_account_ids: ["bluesky-main"],
      rule: expect.objectContaining({
        delay_seconds: 86400,
        min_likes: 10,
      }),
    },
  });
  expect(publicationPayload?.source_url ?? "").toBe("");
  expect(publicationPayload?.scheduled_at).toBeTruthy();
  expect(new Date(publicationPayload?.scheduled_at ?? "").toString()).not.toBe("Invalid Date");

  await outcomes.getByRole("button", { name: "Create another" }).click();
  await expect(outcomes).toHaveCount(0);
  await expect(page.getByLabel("Post text")).toHaveValue("");
});
