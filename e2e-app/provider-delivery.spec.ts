import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("publication delivery keeps exact provider target state across desktop and phone widths", async ({
  page,
  request,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `provider-delivery-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Provider delivery E2E")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);

  let retryQueued = false;

  await page.route(/\/api\/v1\/publications\/provider-delivery-1(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: "provider-delivery-1",
        workspace_id: workspace.id,
        created_by: "provider-delivery-user",
        title: "Launch board update",
        intent: "post",
        creation_preset: "post",
        content_profile: "short_text",
        source_text: "The launch is ready.",
        source_url: "",
        goal: "",
        audience: "",
        status: retryQueued ? "scheduled" : "published",
        revision: 2,
        actual_run_at: "2026-08-12T11:00:00Z",
        metadata: {},
        created_at: "2026-08-12T10:59:00Z",
        updated_at: "2026-08-12T11:00:00Z",
        media: [],
        segments: [],
        repost_override: { mode: "inherit" },
        renditions: [
          {
            id: "rendition-board-launch",
            publication_id: "provider-delivery-1",
            social_account_id: "pinterest-account",
            target_key: "pinterest:board:launch",
            platform: "pinterest",
            profile: "short_text",
            output_profile: "pinterest.pin",
            format_locked: false,
            body: "The launch is ready.",
            title: "Launch",
            description: "",
            settings: {},
            status: "publishing",
            error_retryable: false,
            media: [],
            segments: [],
            delivery: {
              target_key: "pinterest:board:launch",
              state: "processing",
              current_attempt_id: "attempt-1",
              current_attempt_number: 1,
              current_attempt_created_at: "2026-08-12T11:00:00Z",
              recovery_action: "reconcile",
              last_reconciled_at: "2026-08-12T11:04:00Z",
              next_reconciliation_at: "2026-08-12T11:02:00Z",
            },
          },
          {
            id: "rendition-safe-retry",
            publication_id: "provider-delivery-1",
            social_account_id: "x-account",
            target_key: "x",
            platform: "x",
            profile: "short_text",
            output_profile: "x.post",
            format_locked: false,
            body: "The launch is ready.",
            title: "",
            description: "",
            settings: {},
            status: retryQueued ? "scheduled" : "failed",
            error_retryable: true,
            media: [],
            segments: [],
            delivery: {
              target_key: "x",
              state: retryQueued ? "queued" : "rejected",
              current_attempt_id: retryQueued ? "attempt-3" : "attempt-2",
              current_attempt_number: retryQueued ? 3 : 2,
              current_attempt_created_at: retryQueued
                ? "2026-08-12T11:05:00Z"
                : "2026-08-12T11:01:00Z",
              error_kind: retryQueued ? undefined : "provider_rejected",
              error_code: retryQueued ? undefined : "rate_limited",
              error_http_status: retryQueued ? undefined : 429,
              recovery_action: retryQueued ? "none" : "retry",
            },
          },
          {
            id: "rendition-manual",
            publication_id: "provider-delivery-1",
            social_account_id: "linkedin-account",
            target_key: "linkedin",
            platform: "linkedin",
            profile: "short_text",
            output_profile: "linkedin.post",
            format_locked: false,
            body: "The launch is ready.",
            title: "",
            description: "",
            settings: {},
            status: "failed",
            error_retryable: false,
            media: [],
            segments: [],
            delivery: {
              target_key: "linkedin",
              state: "manual_resolution",
              current_attempt_id: "attempt-4",
              current_attempt_number: 1,
              current_attempt_created_at: "2026-08-12T11:03:00Z",
              error_kind: "provider_timeout",
              error_code: "deadline_exceeded",
              recovery_action: "manual_resolution",
            },
          },
        ],
      },
    });
  });
  await page.route(
    "**/api/v1/publications/provider-delivery-1/renditions/x-account/retry?**",
    async (route) => {
      retryQueued = true;
      await route.fulfill({
        contentType: "application/json",
        json: { message: "destination retry queued", job_id: "retry-job" },
      });
    },
  );
  await page.route(/\/api\/v1\/publications(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false", "X-Total-Count": "1" },
      json: [
        {
          id: "provider-delivery-1",
          workspace_id: workspace.id,
          created_by: "provider-delivery-user",
          title: "Launch board update",
          intent: "post",
          creation_preset: "post",
          content_profile: "short_text",
          source_text: "The launch is ready.",
          source_url: "",
          goal: "",
          audience: "",
          status: "failed",
          revision: 2,
          actual_run_at: "2026-08-12T11:00:00Z",
          metadata: {},
          created_at: "2026-08-12T10:59:00Z",
          updated_at: "2026-08-12T11:00:00Z",
          media: [],
          segments: [],
          renditions: [
            {
              id: "rendition-safe-retry",
              publication_id: "provider-delivery-1",
              social_account_id: "x-account",
              target_key: "x",
              platform: "x",
              status: retryQueued ? "scheduled" : "failed",
              body: "The launch is ready.",
              title: "",
              description: "",
              settings: {},
              media: [],
              segments: [],
              delivery: {
                target_key: "x",
                state: retryQueued ? "queued" : "rejected",
                current_attempt_id: retryQueued ? "attempt-3" : "attempt-2",
                current_attempt_number: retryQueued ? 3 : 2,
                current_attempt_created_at: retryQueued
                  ? "2026-08-12T11:05:00Z"
                  : "2026-08-12T11:01:00Z",
                error_kind: retryQueued ? undefined : "provider_rejected",
                error_code: retryQueued ? undefined : "rate_limited",
                error_http_status: retryQueued ? undefined : 429,
                recovery_action: retryQueued ? "none" : "retry",
              },
            },
            {
              id: "rendition-board-launch",
              publication_id: "provider-delivery-1",
              social_account_id: "pinterest-account",
              target_key: "pinterest:board:launch",
              platform: "pinterest",
              status: "publishing",
              body: "The launch is ready.",
              title: "Launch",
              description: "",
              settings: {},
              media: [],
              segments: [],
              delivery: {
                target_key: "pinterest:board:launch",
                state: "processing",
                current_attempt_id: "attempt-1",
                current_attempt_number: 1,
                current_attempt_created_at: "2026-08-12T11:00:00Z",
                recovery_action: "reconcile",
                last_reconciled_at: "2026-08-12T11:04:00Z",
                next_reconciliation_at: "2026-08-12T11:02:00Z",
              },
            },
            {
              id: "rendition-manual",
              publication_id: "provider-delivery-1",
              social_account_id: "linkedin-account",
              target_key: "linkedin",
              platform: "linkedin",
              status: "failed",
              body: "The launch is ready.",
              title: "",
              description: "",
              settings: {},
              media: [],
              segments: [],
              delivery: {
                target_key: "linkedin",
                state: "manual_resolution",
                current_attempt_id: "attempt-4",
                current_attempt_number: 1,
                current_attempt_created_at: "2026-08-12T11:03:00Z",
                error_kind: "provider_timeout",
                error_code: "deadline_exceeded",
                recovery_action: "manual_resolution",
              },
            },
          ],
        },
      ],
    });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        { id: "x-account", platform: "x", slug: "openpost" },
        { id: "pinterest-account", platform: "pinterest", slug: "launch-board" },
        { id: "linkedin-account", platform: "linkedin", slug: "openpost-company" },
      ],
    });
  });
  await page.route("**/api/v1/jobs?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Total-Count": "0", "X-Has-More": "false" },
      json: [],
    });
  });
  await page.route("**/api/v1/publications/provider-delivery-1/events?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false" },
      json: [
        {
          id: "manual-attempt-1",
          workspace_id: workspace.id,
          publication_id: "provider-delivery-1",
          rendition_id: "rendition-manual",
          type: "failed",
          status: "failed",
          summary: "Provider delivery failed",
          actor: { kind: "system" },
          platform: "linkedin",
          destination: {
            rendition_id: "rendition-manual",
            social_account_id: "linkedin-account",
            target_key: "linkedin",
            platform: "linkedin",
            label: "openpost-company",
            status: "failed",
          },
          delivery: {
            target_key: "linkedin",
            state: "manual_resolution",
            current_attempt_id: "attempt-4",
            current_attempt_number: 1,
            current_attempt_created_at: "2026-08-12T11:03:00Z",
            error_kind: "provider_timeout",
            error_code: "deadline_exceeded",
            recovery_action: "manual_resolution",
          },
          superseded: false,
          error: {
            kind: "provider_timeout",
            code: "deadline_exceeded",
            retryable: false,
          },
          created_at: "2026-08-12T11:03:30Z",
        },
        {
          id: "failed-attempt-2",
          workspace_id: workspace.id,
          publication_id: "provider-delivery-1",
          rendition_id: "rendition-safe-retry",
          type: "failed",
          status: "failed",
          summary: "Provider delivery failed",
          actor: { kind: "system" },
          platform: "x",
          destination: {
            rendition_id: "rendition-safe-retry",
            social_account_id: "x-account",
            target_key: "x",
            platform: "x",
            label: "@openpost",
            status: retryQueued ? "scheduled" : "failed",
          },
          delivery: {
            target_key: "x",
            state: retryQueued ? "queued" : "rejected",
            current_attempt_id: retryQueued ? "attempt-3" : "attempt-2",
            current_attempt_number: retryQueued ? 3 : 2,
            current_attempt_created_at: retryQueued
              ? "2026-08-12T11:05:00Z"
              : "2026-08-12T11:01:00Z",
            error_kind: retryQueued ? undefined : "provider_rejected",
            error_code: retryQueued ? undefined : "rate_limited",
            error_http_status: retryQueued ? undefined : 429,
            recovery_action: retryQueued ? "none" : "retry",
          },
          superseded: retryQueued,
          error: {
            kind: "provider_rejected",
            code: "rate_limited",
            retryable: true,
          },
          created_at: "2026-08-12T11:01:30Z",
        },
        {
          id: "processing-attempt-1",
          workspace_id: workspace.id,
          publication_id: "provider-delivery-1",
          rendition_id: "rendition-board-launch",
          type: "provider_processing",
          status: "started",
          summary: "Provider processing started",
          actor: { kind: "system" },
          platform: "pinterest",
          destination: {
            rendition_id: "rendition-board-launch",
            social_account_id: "pinterest-account",
            target_key: "pinterest:board:launch",
            platform: "pinterest",
            label: "launch-board",
            status: "publishing",
          },
          delivery: {
            target_key: "pinterest:board:launch",
            state: "processing",
            current_attempt_id: "attempt-1",
            current_attempt_number: 1,
            current_attempt_created_at: "2026-08-12T11:00:00Z",
            recovery_action: "reconcile",
            last_reconciled_at: "2026-08-12T11:04:00Z",
            next_reconciliation_at: "2026-08-12T11:02:00Z",
          },
          superseded: false,
          created_at: "2026-08-12T11:00:15Z",
        },
      ],
    });
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/publications/provider-delivery-1");
    await expect(page.getByText("Processing at provider").first()).toBeVisible();
    await expect(
      page.getByText("OpenPost is checking the provider before another send.").first(),
    ).toBeVisible();
    await expect(page.getByText("Manual review required").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry destination" })).toHaveCount(
      retryQueued ? 0 : 2,
    );
    await expect(page.getByText("Target pinterest:board:launch").first()).toBeVisible();
    const history = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Version history" }) });
    await expect(history.getByText("Provider delivery failed").first()).toBeVisible();
    await expect(history.getByText("@openpost · X")).toBeVisible();
    await expect(history.getByText("Target x", { exact: true }).first()).toBeVisible();
    await expect(history.getByText("Latest effective destination outcome")).toHaveCount(3);
    await expect(history.getByText("Processing at provider")).toBeVisible();
    await expect(
      history.getByText("OpenPost is checking the provider before another send."),
    ).toBeVisible();
    await expect(history.getByText(/Reconciled/)).toBeVisible();
    await expect(history.getByText("Manual review required")).toBeVisible();
    await expect(history.getByRole("button", { name: "Review destination" })).toBeVisible();
    if (!retryQueued) {
      await page.goto("/activity");
      await page.getByRole("tab", { name: "Failed", exact: true }).click();
      const failedActivity = page.getByRole("tabpanel", { name: "Failed", exact: true });
      await expect(failedActivity.getByText("openpost", { exact: true }).first()).toBeVisible();
      await expect(failedActivity.getByText("Rejected", { exact: true }).first()).toBeVisible();
      await expect(
        failedActivity.getByRole("button", { name: "Retry destination" }).first(),
      ).toBeVisible();
      await expect(failedActivity.getByText("Processing at provider")).toBeVisible();
      await expect(
        failedActivity.getByText("OpenPost is checking the provider before another send."),
      ).toBeVisible();
      await expect(failedActivity.getByText(/Reconciled/)).toBeVisible();
      await expect(failedActivity.getByText("Manual review required")).toBeVisible();
      await expect(
        failedActivity.getByRole("button", { name: "Review destination" }).first(),
      ).toBeVisible();
      await page.goto("/publications/provider-delivery-1");
      await expect(page.getByText("provider_rejected · rate_limited").first()).toBeVisible();
      const destinations = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Destinations" }),
      });
      await destinations.getByRole("button", { name: "Retry destination" }).click();
      await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry destination" })).toHaveCount(0);
      await expect(history.getByText(/Earlier outcome/)).toBeVisible();
      await expect(history.getByText(/Provider attempt 3/)).toBeVisible();
      const orderedHistory = await history.locator("ol > li").allTextContents();
      expect(orderedHistory.findIndex((item) => item.includes("Provider attempt 3"))).toBeLessThan(
        orderedHistory.findIndex((item) => item.includes("Provider delivery failed")),
      );
    } else {
      await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`provider-delivery-${viewport.width}.png`),
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBeFalsy();
  }

  expect(consoleErrors).toEqual([]);
});
