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
  const auth = await registerUser(
    request,
    `provider-delivery-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Provider delivery E2E",
  )) as { id: string };
  await authenticatePage(page, auth.token);

  await page.route(
    "**/api/v1/publications/provider-delivery-1",
    async (route) => {
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
          status: "published",
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
                next_reconciliation_at: "2026-08-12T11:02:00Z",
              },
            },
          ],
        },
      });
    },
  );
  await page.route(
    "**/api/v1/publications/provider-delivery-1/events?**",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { items: [], next_cursor: "" },
      });
    },
  );

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/publications/provider-delivery-1");
    await expect(page.getByText("Processing at provider")).toBeVisible();
    await expect(page.getByText("Target pinterest:board:launch")).toBeVisible();
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
