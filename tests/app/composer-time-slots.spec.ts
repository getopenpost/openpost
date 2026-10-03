import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  authenticatePage,
  clickComposerDeliveryAction,
  createWorkspace,
  createPublication,
  registerUser,
} from "./helpers";

test("composer advances saved time slots across hour boundaries", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `slots-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Time slot intervals");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const settings = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
    headers,
    data: { timezone: "UTC", slot_start_hour: 5, slot_end_hour: 23, slot_interval_minutes: 90 },
  });
  expect(settings.ok(), await settings.text()).toBeTruthy();
  await authenticatePage(page, auth.token);
  await page.goto(`/?workspace_id=${workspace.id}`);
  await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toBeVisible();
  await clickComposerDeliveryAction(page, "Schedule");
  const dialog = page.getByTestId("schedule-dialog-shell");
  await dialog.getByRole("button", { name: "Tomorrow 09:00", exact: true }).click();
  const savedTimes = dialog.getByRole("button", { name: "Saved times", exact: true });
  await savedTimes.focus();
  await page.keyboard.press("Enter");
  const slots = page.getByTestId("schedule-dialog-time-list");
  await expect(slots.getByRole("button")).toHaveText([
    "05:00",
    "06:30",
    "08:00",
    "09:30",
    "11:00",
    "12:30",
    "14:00",
    "15:30",
    "17:00",
    "18:30",
    "20:00",
    "21:30",
    "23:00",
  ]);
  await slots.getByRole("button", { name: "06:30", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Publish time", { exact: true })).toHaveValue("06:30");
  await expect(slots).not.toBeVisible();
  await expect(savedTimes).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Schedule", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("ninety-minute-slots.png") });
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await savedTimes.click();
      await expect(slots.getByRole("button")).toHaveCount(13);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await slots.getByRole("button", { name: "06:30", exact: true }).focus();
      await expect(slots.getByRole("button", { name: "06:30", exact: true })).toBeFocused();
      await page.screenshot({ path: info.outputPath(`slots-${width}-${colorScheme}.png`) });
      await page.keyboard.press("Escape");
      await expect(slots).not.toBeVisible();
      await expect(savedTimes).toBeFocused();
      await expect(dialog).toBeVisible();
    }
  }
});

test.describe("schedule history on touch screens", () => {
  test.use({ hasTouch: true });
  test("schedule picker shows published history without selecting a past schedule", async ({
    page,
    request,
  }, info) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    const auth = await registerUser(request, `schedule-history-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Schedule history");
    const draft = await createPublication(request, auth.token, workspace.id, "A shipped update");
    const response = await request.get(`/api/v1/publications/${draft.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(response.ok()).toBeTruthy();
    const publication = await response.json();
    await page.clock.setFixedTime(new Date("2026-10-15T12:00:00Z"));
    await page.route("**/api/v1/accounts?**", async (route) =>
      route.fulfill({
        json: [
          {
            id: "schedule-target",
            workspace_id: workspace.id,
            platform: "bluesky",
            account_id: "did:plc:schedule-target",
            account_username: "schedule_target",
            is_active: true,
          },
        ],
      }),
    );
    await page.route("**/api/v1/capabilities/resolve", async (route) =>
      route.fulfill({
        json: {
          accounts: [
            {
              account_id: "schedule-target",
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
              immediate_readiness: { state: "healthy", publishable: true },
              scheduled_readiness: { state: "healthy", publishable: true },
            },
          ],
        },
      }),
    );

    await page.route("**/api/v1/publications?**", async (route) => {
      if (!new URL(route.request().url()).searchParams.has("calendar_from"))
        return route.continue();
      await route.fulfill({
        json: [
          {
            ...publication,
            status: "published",
            scheduled_at: "2026-10-13T09:00:00Z",
            actual_run_at: "2026-10-14T10:24:00Z",
          },
          {
            ...publication,
            id: "earlier-lesson",
            title: "",
            source_text: "An earlier lesson",
            status: "published",
            actual_run_at: "2026-10-14T11:00:00Z",
          },
          {
            ...publication,
            id: "planned-update",
            title: "A planned update",
            status: "scheduled",
            scheduled_at: "2026-10-16T09:00:00Z",
            actual_run_at: "2026-10-16T09:15:00Z",
          },
        ],
      });
    });
    const savedDraft = {
      ...publication,
      id: "schedule-draft",
      title: "",
      source_text: "The next update",
      renditions: [],
    };
    await page.route("**/api/v1/publications", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({ json: savedDraft });
    });
    await page.route("**/api/v1/publications/schedule-draft", async (route) => {
      await route.fulfill({ json: { ...savedDraft, revision: 2 } });
    });
    await authenticatePage(page, auth.token);
    await page.goto(`/?workspace_id=${workspace.id}`);
    await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Post text", exact: true }).fill("The next update");
    await clickComposerDeliveryAction(page, "Schedule");
    const dialog = page.getByTestId("schedule-dialog-shell");
    await expect(dialog).toBeVisible();
    const yesterday = dialog.locator('[data-bits-day][data-value="2026-10-14"]');
    await expect(yesterday).not.toHaveAttribute("aria-disabled", "true");
    await yesterday.focus();
    await expect(yesterday).toBeFocused();
    await page.keyboard.press("Enter");
    const agenda = dialog.getByTestId("schedule-dialog-agenda");
    await expect(agenda.getByText("A shipped update", { exact: true })).toBeVisible();
    await expect(agenda.getByText("10:24", { exact: true })).toBeVisible();
    await expect(agenda.getByText("Published", { exact: true })).toHaveCount(2);
    await expect(agenda.getByText("An earlier lesson", { exact: true })).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Schedule", exact: true })).toBeDisabled();
    await expect(dialog.locator("input[type=time]")).toHaveCount(0);
    await expect(dialog.getByText(/^Selected /)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Tomorrow 09:00", exact: true }).click();
    await expect(agenda.getByText("A planned update", { exact: true })).toBeVisible();
    await expect(agenda.getByRole("time")).toHaveText("09:00");
    await expect(agenda.getByText("Scheduled", { exact: true })).toBeVisible();
    const time = dialog.getByLabel("Publish time", { exact: true });
    await expect(time).toHaveValue("09:00");
    await time.fill("14:37");
    await expect(time).toHaveValue("14:37");
    await expect(dialog.getByRole("button", { name: "Schedule", exact: true })).toBeEnabled();
    await dialog.locator('[data-bits-day][data-value="2026-10-14"]').click();
    for (const width of [1280, 390, 320]) {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await dialog.locator('[data-bits-day][data-value="2026-10-16"]').click();
        await expect(time).toHaveValue("14:37");
        await expect(
          agenda.getByRole("heading", { name: "Friday, Oct 16", exact: true }),
        ).toBeVisible();
        await expect(agenda.getByText("A planned update", { exact: true })).toBeVisible();
        if (width === 320 && colorScheme === "dark") {
          const accessibility = await new AxeBuilder({ page })
            .include('[data-testid="schedule-dialog-shell"]')
            .analyze();
          expect(accessibility.violations).toEqual([]);
        }
        await dialog.screenshot({
          path: info.outputPath(`schedule-future-${width}-${colorScheme}.png`),
        });
        const savedTimes = dialog.getByRole("button", { name: "Saved times", exact: true });
        await savedTimes.click();
        await expect(page.getByTestId("schedule-dialog-time-list")).toBeVisible();
        await dialog.locator('[data-bits-day][data-value="2026-10-14"]').click();
        await expect(page.getByTestId("schedule-dialog-time-list")).not.toBeVisible();
        await expect(dialog.locator("input[type=time]")).toHaveCount(0);
        await expect(dialog.getByText(/^Selected /)).toHaveCount(0);
        await expect(agenda.getByText("A shipped update", { exact: true })).toBeVisible();
        await expect
          .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
          .toBe(true);
        const dateTarget = dialog.locator('[data-bits-day][data-value="2026-10-14"]');
        const bounds = await dateTarget.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        if (width < 640) {
          const lastPost = agenda.getByRole("listitem").last();
          await expect(lastPost).toContainText("An earlier lesson");
          await lastPost.scrollIntoViewIfNeeded();
          const postBounds = await lastPost.boundingBox();
          const bodyBounds = await page.getByTestId("schedule-dialog-body").boundingBox();
          expect(postBounds).not.toBeNull();
          expect(bodyBounds).not.toBeNull();
          expect(postBounds!.y + postBounds!.height).toBeLessThanOrEqual(
            bodyBounds!.y + bodyBounds!.height,
          );
          await expect(
            dialog.getByRole("button", { name: "Cancel", exact: true }),
          ).toBeInViewport();
        }
        await dialog.screenshot({
          path: info.outputPath(`schedule-history-${width}-${colorScheme}.png`),
        });
      }
    }
    expect(runtimeErrors).toEqual([]);
  });
});
