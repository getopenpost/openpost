import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

type DeliveryStage = {
  state:
    | "queued"
    | "submitted"
    | "processing"
    | "provider_scheduled"
    | "live"
    | "rejected"
    | "ambiguous"
    | "manual_resolution";
  renditionStatus: "scheduled" | "publishing" | "published" | "failed";
  publicationStatus: "scheduled" | "published" | "failed";
  label: string;
  recoveryAction: "none" | "retry" | "reconcile" | "manual_resolution";
};

const deliveryStages: DeliveryStage[] = [
  {
    state: "queued",
    renditionStatus: "scheduled",
    publicationStatus: "scheduled",
    label: "Queued",
    recoveryAction: "none",
  },
  {
    state: "submitted",
    renditionStatus: "publishing",
    publicationStatus: "scheduled",
    label: "Submitted",
    recoveryAction: "none",
  },
  {
    state: "processing",
    renditionStatus: "publishing",
    publicationStatus: "scheduled",
    label: "Processing at provider",
    recoveryAction: "reconcile",
  },
  {
    state: "provider_scheduled",
    renditionStatus: "scheduled",
    publicationStatus: "scheduled",
    label: "Scheduled at provider",
    recoveryAction: "none",
  },
  {
    state: "live",
    renditionStatus: "published",
    publicationStatus: "published",
    label: "Live",
    recoveryAction: "none",
  },
  {
    state: "rejected",
    renditionStatus: "failed",
    publicationStatus: "failed",
    label: "Rejected",
    recoveryAction: "retry",
  },
  {
    state: "ambiguous",
    renditionStatus: "failed",
    publicationStatus: "failed",
    label: "Outcome needs reconciliation",
    recoveryAction: "reconcile",
  },
  {
    state: "manual_resolution",
    renditionStatus: "failed",
    publicationStatus: "failed",
    label: "Manual review required",
    recoveryAction: "manual_resolution",
  },
];

test("one Rendition traverses exact outcomes across authoring, Publication history, and Activity", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `daily-outcomes-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Daily outcome cohort")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);

  let stageIndex = 0;
  let retryRequests = 0;
  const lifecycleEvents: ReturnType<typeof lifecycleEventFixture>[] = [];
  await page.route("**/api/v1/capabilities", (route) =>
    route.fulfill({
      json: {
        profiles: [],
        capabilities: [
          {
            provider: "bluesky",
            profile: "short_text",
            output_profile: "bluesky.post",
            label: "Bluesky post",
            media: { min_count: 0, max_count: 4, allowed_mimes: [] },
            native_scheduling: false,
            openpost_queued: true,
            requires_app_review: false,
            requires_public_media: false,
            settings: [],
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/accounts?**", (route) =>
    route.fulfill({
      json: [
        {
          id: "cohort-account",
          platform: "bluesky",
          slug: "openpost.example",
          account_id: "openpost.example",
          account_username: "openpost.example",
          account_avatar_url: "",
          instance_url: "",
          is_active: true,
          thread_replies_supported: true,
        },
      ],
    }),
  );
  await page.route("**/api/v1/provider-readiness?**", (route) =>
    route.fulfill({
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
    }),
  );
  await page.route("**/api/v1/capabilities/resolve", (route) =>
    route.fulfill({
      json: {
        accounts: [
          {
            account_id: "cohort-account",
            provider: "bluesky",
            profile: "short_text",
            output_profile: "bluesky.post",
            label: "Bluesky post",
            text_limit: 300,
            media: { min_count: 0, max_count: 4, allowed_mimes: [] },
            intents: ["post"],
            media_shapes: ["text"],
            settings: [],
            setting_groups: [],
            compatible: true,
            active_constraints: {},
            issues: [],
            capability_revision: "daily-cohort-v1",
            dynamic_options: {},
            immediate_readiness: publicationReadiness(),
            scheduled_readiness: publicationReadiness(),
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/repost-automation*", (route) =>
    route.fulfill({
      json: {
        workspace_id: workspace.id,
        can_manage: true,
        supported_platforms: ["bluesky"],
        policies: [],
        accounts: [],
        grants: [],
      },
    }),
  );
  await page.route(`**/api/v1/workspaces/${workspace.id}/setup`, (route) =>
    route.fulfill({
      json: {
        activated: true,
        visible: false,
        completed_steps: 4,
        total_steps: 4,
        steps: [],
      },
    }),
  );
  await page.route("**/api/v1/posts/draft", (route) =>
    route.fulfill({
      json: {
        post_id: "daily-cohort-post",
        publication_id: "daily-cohort",
        revision: 1,
        updated_at: "2026-08-14T10:00:00Z",
      },
    }),
  );
  await page.route("**/api/v1/posts/daily-cohort-post/draft", (route) =>
    route.fulfill({
      json: {
        post_id: "daily-cohort-post",
        publication_id: "daily-cohort",
        revision: 2,
        updated_at: "2026-08-14T10:00:01Z",
      },
    }),
  );
  await page.route("**/api/v1/jobs?**", (route) =>
    route.fulfill({ headers: { "X-Total-Count": "0", "X-Has-More": "false" }, json: [] }),
  );
  await page.route("**/api/v1/publications/daily-cohort/events?**", (route) =>
    route.fulfill({
      headers: { "X-Has-More": "false" },
      json: lifecycleEvents.map((event, index) => ({ ...event, superseded: index > 0 })),
    }),
  );
  await page.route(
    "**/api/v1/publications/daily-cohort/renditions/cohort-account/retry?**",
    (route) => {
      retryRequests += 1;
      return route.fulfill({ json: { message: "destination retry queued", job_id: "retry-job" } });
    },
  );
  await page.route(/\/api\/v1\/publications\/daily-cohort(?:\?.*)?$/, (route) => {
    if (route.request().method() === "PUT") return route.fulfill({ json: {} });
    return route.fulfill({ json: publicationFixture(workspace.id, deliveryStages[stageIndex]) });
  });
  await page.route("**/api/v1/publications/daily-cohort/renditions", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/api/v1/publications/daily-cohort/validate", (route) =>
    route.fulfill({ json: { publication_id: "daily-cohort", issues: [] } }),
  );
  await page.route("**/api/v1/publications/daily-cohort/publish-now", (route) =>
    route.fulfill({
      json: {
        message: "Publication queued",
        job_id: `job-${deliveryStages[stageIndex].state}`,
        publication_id: "daily-cohort",
        renditions: publicationFixture(workspace.id, deliveryStages[stageIndex]).renditions,
      },
    }),
  );
  await page.route(/\/api\/v1\/publications(?:\?.*)?$/, (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        json: {
          ...publicationFixture(workspace.id, deliveryStages[stageIndex]),
          status: "draft",
          renditions: [],
        },
      });
    }
    return route.fulfill({
      headers: { "X-Has-More": "false", "X-Total-Count": "1" },
      json: [publicationFixture(workspace.id, deliveryStages[stageIndex])],
    });
  });

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  for (const [index, stage] of deliveryStages.entries()) {
    stageIndex = index;
    lifecycleEvents.unshift(lifecycleEventFixture(workspace.id, stage, index));
    await test.step(stage.state, async () => {
      await page.goto(`/?workspace=${workspace.id}`);
      await expect(page.getByTestId("text-thread-composer-shell")).toBeVisible();
      await page.getByLabel("Post text").fill(`Daily cohort outcome ${index + 1}`);
      await page.getByRole("button", { name: "Publish now" }).click();
      const authoring = page.getByTestId("composer-delivery-feedback");
      await expect(authoring.getByText(stage.label, { exact: true })).toBeVisible();
      await expectRecoveryAction(authoring, stage);

      await page.goto(`/publications/daily-cohort?workspace=${workspace.id}`);
      const destinations = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Destinations" }),
      });
      await expect(destinations.getByText(stage.label, { exact: true })).toBeVisible();
      await expectRecoveryAction(destinations, stage);
      const timeline = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Version history" }),
      });
      for (const previousStage of deliveryStages.slice(0, index + 1)) {
        await expect(
          timeline.getByText(`Rendition reached ${previousStage.label}`, { exact: true }),
        ).toBeVisible();
      }
      await expect(timeline.getByText(/^Rendition reached /)).toHaveCount(index + 1);
      if (stage.recoveryAction === "retry") {
        await destinations.getByRole("button", { name: "Retry destination" }).click();
        await expect.poll(() => retryRequests).toBe(1);
      }

      await page.goto(`/activity?workspace=${workspace.id}`);
      const activityTab =
        stage.publicationStatus === "published"
          ? "Published"
          : stage.publicationStatus === "failed"
            ? "Failed"
            : "Scheduled";
      await page.getByRole("tab", { name: activityTab, exact: true }).click();
      const activity = page.getByRole("tabpanel", { name: activityTab, exact: true });
      await expect(activity.getByText(stage.label, { exact: true }).first()).toBeVisible();
      await expectRecoveryAction(activity, stage);
      await expectNoDocumentOverflow(page);
      if (stage.recoveryAction === "manual_resolution") {
        await activity.getByRole("button", { name: "Review destination" }).first().click();
        await expect(page).toHaveURL(/\/settings\?tab=accounts&account_id=cohort-account$/);
      }
    });
  }

  expect(retryRequests).toBe(1);
  expect(consoleErrors).toEqual([]);
});

async function expectRecoveryAction(page: Page | Locator, stage: DeliveryStage) {
  const retry = page.getByRole("button", { name: "Retry destination" });
  const review = page.getByRole("button", { name: "Review destination" });
  const reconcile = page.getByText("OpenPost is checking the provider before another send.");

  if (stage.recoveryAction === "retry") await expect(retry.first()).toBeVisible();
  else await expect(retry).toHaveCount(0);
  if (stage.recoveryAction === "manual_resolution") await expect(review.first()).toBeVisible();
  else await expect(review).toHaveCount(0);
  if (stage.recoveryAction === "reconcile") await expect(reconcile.first()).toBeVisible();
  else await expect(reconcile).toHaveCount(0);
}

function publicationReadiness() {
  return {
    state: "healthy",
    executable: true,
    connectable: false,
    publishable: true,
    advertisable: false,
    facts: {
      configuration: "configured",
      local_test: "passed",
      live_certification: "passed",
      approval: "approved",
      authorization: "authorized",
      control: "enabled",
      policy: "allowed",
    },
    blockers: [],
  };
}

function lifecycleEventFixture(workspaceID: string, stage: DeliveryStage, index: number) {
  const rendition = publicationFixture(workspaceID, stage).renditions[0];
  const seconds = String(index).padStart(2, "0");
  return {
    id: `daily-cohort-event-${stage.state}`,
    workspace_id: workspaceID,
    publication_id: "daily-cohort",
    rendition_id: rendition.id,
    type: `delivery_${stage.state}`,
    status: stage.renditionStatus === "failed" ? "failed" : "started",
    summary: `Rendition reached ${stage.label}`,
    actor: { kind: "system" },
    platform: "bluesky",
    destination: {
      rendition_id: rendition.id,
      social_account_id: rendition.social_account_id,
      target_key: rendition.target_key,
      platform: rendition.platform,
      label: "openpost.example",
      status: rendition.status,
    },
    delivery: rendition.delivery,
    superseded: false,
    created_at: `2026-08-14T10:00:${seconds}Z`,
  };
}

function publicationFixture(workspaceID: string, stage: DeliveryStage) {
  const delivery = {
    target_key: "bluesky",
    state: stage.state,
    current_attempt_id: `attempt-${stage.state}`,
    current_attempt_number: 1,
    current_attempt_created_at: "2026-08-14T10:00:00Z",
    recovery_action: stage.recoveryAction,
    ...(stage.state === "rejected"
      ? { error_kind: "provider_rejected", error_code: "rate_limited", error_http_status: 429 }
      : {}),
  };
  return {
    id: "daily-cohort",
    workspace_id: workspaceID,
    created_by: "daily-cohort-user",
    title: "Daily workflow outcome",
    intent: "post",
    creation_preset: "post",
    content_profile: "short_text",
    source_text: "One Rendition advances through every provider outcome.",
    source_url: "",
    goal: "",
    audience: "",
    status: stage.publicationStatus,
    revision: 1,
    actual_run_at: "2026-08-14T10:00:00Z",
    metadata: {},
    created_at: "2026-08-14T09:59:00Z",
    updated_at: "2026-08-14T10:00:00Z",
    media: [],
    segments: [],
    repost_override: { mode: "inherit" },
    renditions: [
      {
        id: "daily-cohort-rendition",
        publication_id: "daily-cohort",
        social_account_id: "cohort-account",
        target_key: "bluesky",
        platform: "bluesky",
        profile: "short_text",
        output_profile: "bluesky.post",
        format_locked: false,
        body: "One Rendition advances through every provider outcome.",
        title: "",
        description: "",
        settings: {},
        status: stage.renditionStatus,
        error_retryable: stage.recoveryAction === "retry",
        media: [],
        segments: [],
        delivery,
      },
    ],
  };
}

async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}
