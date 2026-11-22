import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createPublication,
  createWorkspace,
  registerUser,
  expectPostText,
} from "./helpers";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fixtureDirectory,
  fixedNow,
  rasterFixtureFiles,
  uploadImageFixture,
} from "./product-capture-fixtures";

test.describe("calendar date selection", () => {
  test("Calendar keeps the chosen date across Month and Week and opens the composer on that date", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const auth = await registerUser(request, `agenda-labels-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Agenda labels");
    expect(
      (
        await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          data: { timezone: "UTC", week_start: 0 },
        })
      ).ok(),
    ).toBe(true);
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "Audit cross-month week",
    );
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='published',actual_run_at='2026-09-28 12:00:00+00:00' WHERE id='${publication.id}';`,
    ]);
    await authenticatePage(page, auth.token);
    await page.goto("/calendar");
    const width = 1168;
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/calendar");
    const picker = page.getByTestId("calendar-date-picker");
    const chosenDate = picker.getByRole("button", { name: "Monday, Sep 28", exact: true });
    await chosenDate.click();
    await expect(chosenDate).toHaveAccessibleDescription("1 post");
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page.locator("main p[aria-live='polite']")).toHaveText(/Sep 27.*Oct 3, 2026/);
    await expect(chosenDate).toHaveAttribute("aria-pressed", "true");
    await chosenDate.focus();
    await page.keyboard.press("ArrowUp");
    const previousWeekDate = picker.getByRole("button", {
      name: "Monday, Sep 21",
      exact: true,
    });
    await expect(previousWeekDate).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(chosenDate).toBeFocused();
    await expect(page.getByRole("button", { name: /Audit cross-month week/ })).toBeVisible();
    const selectionColor = await chosenDate.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const nextMonthDate = picker.getByRole("button", { name: "Thursday, Oct 1", exact: true });
    await nextMonthDate.click();
    await expect(nextMonthDate).toHaveAttribute("aria-pressed", "true");
    await expect(chosenDate).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() => nextMonthDate.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(selectionColor);
    await expect(page.getByRole("heading", { name: "Thursday, Oct 1", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Audit cross-month week/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(
      picker.getByRole("button", { name: "Thursday, Oct 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Create post", exact: true }).click();
    await expect(page).toHaveURL(/date=2026-10-01/);
    expect(errors).toEqual([]);
  });
});

test.describe("calendar agenda", () => {
  test("Calendar selects a day and Today restores it without moving keyboard focus or changing posts", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const auth = await registerUser(request, `agenda-today-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Agenda Today");
    const headers = { Authorization: `Bearer ${auth.token}` };
    expect(
      (
        await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
          headers,
          data: { timezone: "UTC" },
        })
      ).ok(),
    ).toBe(true);
    const ids: string[] = [];
    for (let day = 1; day <= 30; day++) {
      const publication = await createPublication(
        request,
        auth.token,
        workspace.id,
        `Audit agenda day ${day}`,
      );
      ids.push(publication.id);
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `UPDATE publications SET status='published',actual_run_at='2026-09-${String(day).padStart(2, "0")} 12:00:00+00:00' WHERE id='${publication.id}';`,
      ]);
    }
    await authenticatePage(page, auth.token);
    await page.goto("/calendar");
    const width = 320;
    await page.setViewportSize({ width, height: 850 });
    await page.reload();
    const date = page.getByRole("heading", { name: "Wednesday, Sep 30", exact: true });
    const today = page.getByRole("main").getByRole("button", { name: "Today", exact: true });

    const calendar = page.getByTestId("calendar-date-picker");
    await expect(calendar).toBeVisible();
    await expect(
      calendar.getByRole("button", { name: "Tuesday, Sep 1", exact: true }),
    ).toBeVisible();
    await calendar.getByRole("button", { name: "Tuesday, Sep 1", exact: true }).click();
    await expect(page.getByRole("button", { name: /Audit agenda day 1\b/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Audit agenda day 30\b/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create post", exact: true })).toHaveCount(0);
    const second = calendar.getByRole("button", { name: "Wednesday, Sep 2", exact: true });
    await page.keyboard.press("ArrowRight");
    await expect(second).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Audit agenda day 2\b/ })).toBeVisible();
    const target = await second.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
    await today.focus();
    await page.keyboard.press("Enter");
    await expect(date).toBeInViewport();
    await expect(page.getByRole("button", { name: /Audit agenda day 30\b/ })).toBeVisible();
    await expect(today).toBeFocused();
    await expect(today).toBeInViewport();
    const accessibility = await new AxeBuilder({ page })
      .include('[data-testid="calendar-date-picker"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await today.click();
    await expect(date).toBeInViewport();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Audit agenda day 1", exact: true }),
    ).toBeVisible();
    for (const id of [ids[0], ids[29]]) {
      const response = await request.get(`/api/v1/publications/${id}`, { headers });
      expect(response.ok()).toBe(true);
      const publication = await response.json();
      expect(publication.status).toBe("published");
      expect(publication.revision).toBe(1);
    }
    expect(errors).toEqual([]);
  });
});

test.describe("calendar filters", () => {
  test("Calendar explains filtered emptiness and clears filters without changing dates or posts", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-03T12:00:00Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const auth = await registerUser(request, `calendar-filter-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Calendar Filter Recovery");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "Audit scheduled filter recovery",
    );
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='scheduled',scheduled_at='2026-10-03 14:00:00+00:00' WHERE id='${publication.id}';`,
    ]);
    const emptyWorkspace = await createWorkspace(request, auth.token, "Calendar Empty Workspace");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${emptyWorkspace.id}','filter-${accountID}','bluesky','${accountID}','auditfilter',X'00',1);`,
    ]);
    await authenticatePage(page, auth.token);
    await page.goto("/calendar");
    const width = 1280;
    await page.setViewportSize({ width, height: 850 });
    await page.reload();
    await expect(
      page.getByRole("button", { name: /Audit scheduled filter recovery/ }).first(),
    ).toBeVisible();
    for (const view of ["Month", "Week"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      const range = page.getByRole("main").locator('p[aria-live="polite"]');
      const before = await range.innerText();
      await page.getByRole("button", { name: /^Filters\b/ }).click();
      // The status dropdown nests inside the Filters popover; its menu items
      // settle focus asynchronously, so select with pointer clicks.
      await page.getByRole("button", { name: "All posts", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Published", exact: true }).click();
      await page.getByRole("button", { name: /^Filters\b/ }).click();
      await expect(
        page.getByRole("button", { name: /Audit scheduled filter recovery/ }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          "No posts match the selected dates and filters. Try another date range or clear the filters.",
          { exact: true },
        ),
      ).toBeVisible();
      const clear = page
        .getByRole("main")
        .getByRole("button", { name: "Clear filters", exact: true });
      await clear.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: /^Filters\b/ }).click();
      await expect(page.getByRole("button", { name: "All posts", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Audit scheduled filter recovery/ }).first(),
      ).toBeVisible();
      await expect(range).toHaveText(before);
      await expect(clear).toHaveCount(0);
      await page.getByRole("button", { name: /^Filters\b/ }).click();
    }
    await page.setViewportSize({ width: 390, height: 850 });
    await page.getByRole("button", { name: /^Filters\b/ }).click();
    await page.getByRole("button", { name: "All workspaces", exact: true }).click();
    await page
      .getByRole("menuitemcheckbox", { name: "Calendar Filter Recovery", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Filters\b/ }).click();
    await expect(page.getByRole("button", { name: /Audit scheduled filter recovery/ })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "All platforms", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Bluesky", exact: true }).click();
    await page.getByRole("button", { name: "All posts", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Published", exact: true }).click();
    await page.getByRole("button", { name: /^Filters\b/ }).click();
    await page
      .getByRole("main")
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page.getByRole("button", { name: /^Filters\b/ }).click();
    for (const name of ["All workspaces", "All platforms", "All posts"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: /Audit scheduled filter recovery/ }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Filters\b/ }).click();
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No posts on this day", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("button", { name: "Clear filters", exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
    const result = await request.get(`/api/v1/publications/${publication.id}`, { headers });
    const stored = await result.json();
    expect(stored.status).toBe("scheduled");
    expect(stored.revision).toBe(1);
    expect(new Date(stored.scheduled_at).toISOString()).toBe("2026-10-03T14:00:00.000Z");
  });
});

test.describe("calendar week timezone", () => {
  test("Week grid retains both posts in a repeated local hour and changes timezone correctly", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
    await page.setViewportSize({ width: 1440, height: 960 });
    const auth = await registerUser(request, `week-timezone-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Week timezone");
    const headers = { Authorization: `Bearer ${auth.token}` };
    for (const [title, instant] of [
      ["Before clock change", "2026-11-01 05:15:00+00:00"],
      ["After clock change", "2026-11-01 06:45:00+00:00"],
    ]) {
      const publication = await createPublication(request, auth.token, workspace.id, title);
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `UPDATE publications SET status='published',actual_run_at='${instant}' WHERE id='${publication.id}';`,
      ]);
    }
    await authenticatePage(page, auth.token);
    for (const timezone of ["America/New_York", "UTC"]) {
      expect(
        (
          await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
            headers,
            data: { timezone, week_start: 0 },
          })
        ).ok(),
      ).toBe(true);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/calendar");
      await page.reload();
      await page.getByRole("button", { name: "Week", exact: true }).click();
      const grid = page.getByRole("region", { name: "Weekly publishing calendar" });
      await expect
        .poll(() =>
          grid
            .getByText(timezone, { exact: true })
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        )
        .toBe(true);
      const firstHour = timezone === "UTC" ? "05:00" : "01:00";
      const secondHour = timezone === "UTC" ? "06:00" : "01:00";
      const first = grid
        .getByRole("group", { name: `Sunday, Nov 1 ${firstHour}`, exact: true })
        .getByRole("button", { name: "Before clock change", exact: true });
      const second = grid
        .getByRole("group", { name: `Sunday, Nov 1 ${secondHour}`, exact: true })
        .getByRole("button", { name: "After clock change", exact: true });
      await expect(first).toBeVisible();
      await expect(second).toBeVisible();
      await expect(first).toHaveAttribute("style", /25%/);
      await expect(second).toHaveAttribute("style", /75%/);
      await expect(grid.locator("[data-calendar-week-item]")).toHaveCount(2);
      await first.focus();
      await expect(first).toBeFocused();
    }
    expect(errors).toEqual([]);
  });
});

test.describe("post list and details", () => {
  test("publications keeps the main workflow clear across list, search, and calendar", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `publications-ux-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Publication workspace");
    const created = await createPublication(
      request,
      auth.token,
      workspace.id,
      "A clear launch note for the publication workspace",
    );
    await authenticatePage(page, auth.token);

    await page.goto("/publications?tab=drafts");
    await expect(page.getByRole("heading", { name: "Posts", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search posts" })).toBeVisible();
    const selectedTab = page.getByRole("tab", { name: "Drafts", exact: true });
    await expect(selectedTab).toHaveCSS("border-radius", "0px");
    await expect(selectedTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.getByTestId("publication-list")).toContainText("A clear launch note");

    await page.getByRole("searchbox", { name: "Search posts" }).fill("does not exist");
    await expect(page.getByTestId("publication-list")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search posts" }).fill("launch note");
    await expect(page.getByTestId("publication-list")).toContainText("A clear launch note");

    await page
      .getByRole("link", { name: "A clear launch note for the publication workspace", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/publications/${created.id}$`));

    await page.goto("/publications?tab=drafts");
    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole("heading", { name: "Posts", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "List" }).click();
    await expect(page).toHaveURL(/\/publications(?:\?.*)?$/);
    await expect(page.getByRole("tab", { name: "Drafts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Published", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("tab", { name: "Published", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("tab", { name: "Drafts", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Drafts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("publication delivery details keep distinct targets for the same account", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `publication-targets-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Multiple targets");
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "One account, two destinations",
    );
    await authenticatePage(page, auth.token);
    await page.route("**/api/v1/publications?**", async (route) => {
      const response = await route.fetch();
      const publications = await response.json();
      await route.fulfill({
        response,
        json: publications.map((item: { id: string }) =>
          item.id === publication.id
            ? {
                ...item,
                renditions: ["first-channel", "second-channel"].map((target, index) => ({
                  id: `rendition-${index}`,
                  social_account_id: "same-account",
                  platform: "telegram",
                  target_key: target,
                  status: "draft",
                  segments: [],
                  metadata: {},
                })),
              }
            : item,
        ),
      });
    });
    await page.goto("/publications?tab=drafts");
    const list = page.getByTestId("publication-list");
    await expect(list).toContainText("One account, two destinations");
    await list.locator("summary").click();
    await expect(list.getByText("Target first-channel", { exact: true })).toBeVisible();
    await expect(list.getByText("Target second-channel", { exact: true })).toBeVisible();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='scheduled',scheduled_at='2099-01-01 12:00:00+00:00' WHERE id='${publication.id}';`,
    ]);
    await page.goto("/publications?tab=scheduled&view=grid");
    const grid = page.getByTestId("publication-grid");
    await expect(grid).toContainText("One account, two destinations");
    await grid.locator("summary").click();
    await expect(grid.getByText("Target first-channel", { exact: true })).toBeVisible();
    await expect(grid.getByText("Target second-channel", { exact: true })).toBeVisible();
  });

  test("published records show a confirmed local removal action", async ({ page, request }) => {
    const auth = await registerUser(request, `published-delete-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Published cleanup");
    const created = await createPublication(
      request,
      auth.token,
      workspace.id,
      "A removed test post",
    );
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='published', actual_run_at=CURRENT_TIMESTAMP WHERE id='${created.id}';`,
    ]);
    const stored = await request.get(`/api/v1/publications/${created.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect((await stored.json()).status).toBe("published");
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${created.id}`);
    await page.getByRole("button", { name: "Remove from OpenPost", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Posts on social networks will not be deleted");
    await dialog.getByRole("button", { name: "Remove from OpenPost", exact: true }).click();
    await expect(page).toHaveURL(/\/publications(?:\?.*)?$/);
    const result = await request.get(`/api/v1/publications/${created.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(result.status()).toBe(404);
  });
});

test.describe("post gallery and calendar density", () => {
  async function settleCardContrast(page: import("@playwright/test").Page) {
    await expect
      .poll(() =>
        page
          .getByTestId("draft-gallery")
          .locator("article")
          .evaluateAll((cards) => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d")!;
            const luminance = (color: string) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              const channels = [...context.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .map((channel) => {
                  const value = channel / 255;
                  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                });
              return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
            };
            return Math.min(
              ...cards.map((card) => {
                const foreground = luminance(getComputedStyle(card.querySelector("p")!).color);
                const background = luminance(getComputedStyle(card).backgroundColor);
                return (
                  (Math.max(foreground, background) + 0.05) /
                  (Math.min(foreground, background) + 0.05)
                );
              }),
            );
          }),
      )
      .toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => document.fonts.ready);
  }

  test("draft gallery keeps content, selection and search without repeated row chrome", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const auth = await registerUser(request, `draft-gallery-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Draft gallery");
    const mediaID = await uploadImageFixture(
      request,
      auth.token,
      workspace.id,
      "launch.png",
      await readFile(join(fixtureDirectory, rasterFixtureFiles["lisbon-tram"])),
    );
    const text = await createPublication(
      request,
      auth.token,
      workspace.id,
      "The lesson from our first customer interview",
    );
    const visual = await createPublication(
      request,
      auth.token,
      workspace.id,
      "Launch photos from Lisbon",
      {
        mediaIDs: [mediaID],
      },
    );
    await createPublication(
      request,
      auth.token,
      workspace.id,
      "مرحبا بمشروعنا الجديد، وهذه بعض الأفكار للمشاركة",
    );
    for (const content of [
      "A short launch note",
      "What changed this week\nA practical improvement that came from listening to our customers.\nOne less step before sharing an update.",
      "A useful detail from our latest release",
      "What we learned from shipping a smaller feature\nThe result was easier to explain, easier to use, and easier to maintain.\nWe will keep that lesson for the next launch.",
    ])
      await createPublication(request, auth.token, workspace.id, content);
    await page.route(
      (url) => url.pathname === "/api/v1/publications",
      async (route) => {
        const response = await route.fetch();
        const publications = await response.json();
        // A selected destination with no delivery attempt is still an ordinary draft.
        for (const publication of publications) {
          if (publication.id === text.id) {
            publication.review_state = "needs_review";
            publication.renditions = [
              {
                id: "draft-destination",
                social_account_id: "account-not-connected-in-this-fixture",
                platform: "x",
                target_key: "profile",
                status: "draft",
              },
            ];
          }
          if (publication.id === visual.id)
            publication.renditions = [
              {
                id: "failed-target",
                social_account_id: "same-account",
                platform: "pinterest",
                target_key: "board-a",
                status: "failed",
              },
              {
                id: "draft-target",
                social_account_id: "same-account",
                platform: "pinterest",
                target_key: "board-b",
                status: "draft",
              },
            ];
        }
        await route.fulfill({ response, json: publications });
      },
    );
    await authenticatePage(page, auth.token);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(`/publications?tab=drafts&workspace_id=${workspace.id}`);
    const views = page.getByRole("navigation", { name: "Post view" });
    await expect.soft(page.getByTestId("publication-list")).toBeVisible();

    await views.getByRole("link", { name: "Grid", exact: true }).click();
    const gallery = page.getByTestId("draft-gallery");
    await expect(views.getByRole("link", { name: "Grid", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await expect(gallery.locator("article")).toHaveCount(7);
    await expect(gallery.getByRole("link")).toHaveCount(7);
    await expect.soft(gallery.getByText("Needs a new review", { exact: true })).toBeVisible();
    await expect.soft(gallery.getByText("Delivery failed.", { exact: true })).toBeVisible();
    await expect(gallery.getByText("Delivery details", { exact: true })).toHaveCount(0);
    await expect(gallery.getByText("Draft", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Showing 3 of 3 results", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("desktop-sidebar-planner")).toHaveCount(0);
    await expect
      .poll(() =>
        gallery
          .locator("img")
          .first()
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await settleCardContrast(page);
    await expect
      .poll(() =>
        gallery.locator("article").evaluateAll((cards) => {
          const boxes = cards.map((card) => card.getBoundingClientRect());
          return boxes.every((box) => {
            const previous = boxes
              .filter((other) => Math.abs(other.x - box.x) < 1 && other.top < box.top)
              .sort((a, b) => b.top - a.top)[0];
            return (
              !previous || (box.top - previous.bottom >= 15 && box.top - previous.bottom <= 18)
            );
          });
        }),
      )
      .toBe(true);
    await page.context().addCookies([{ name: "PARAGLIDE_LOCALE", value: "ja", url: page.url() }]);
    await page.reload();
    await expect(page.getByRole("link", { name: "グリッド", exact: true })).toBeVisible();
    await page.context().addCookies([{ name: "PARAGLIDE_LOCALE", value: "en", url: page.url() }]);
    await page.reload();
    await page.getByRole("button", { name: "Select drafts", exact: true }).click();
    await gallery.getByRole("checkbox").first().check();
    await expect(gallery.getByRole("checkbox").first()).toBeChecked();
    await views.getByRole("link", { name: "List", exact: true }).click();
    await expect(page.getByTestId("publication-list").locator(":scope > article")).toHaveCount(7);
    await expect(page.getByTestId("publication-list").getByRole("checkbox").first()).toBeChecked();

    await views.getByRole("link", { name: "Grid", exact: true }).click();
    await expect(gallery.getByRole("checkbox").first()).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Schedule selected", exact: false }),
    ).toBeVisible();
    const plainCard = gallery.locator("article").filter({ hasText: "مرحبا" });
    expect((await plainCard.boundingBox())!.height).toBeLessThan(180);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.goto("/media");
    await page
      .getByTestId("sidebar-workspace-navigation")
      .getByRole("button", { name: "Posts", exact: true })
      .click();
    await expect(page).toHaveURL(/view=grid/);
    await expect(gallery.locator("article")).toHaveCount(7);
    await page.reload();
    await expect(gallery.locator("article")).toHaveCount(7);
    await page.goto(`/publications?tab=drafts&view=list&workspace_id=${workspace.id}`);
    await expect(page.getByTestId("publication-list")).toBeVisible();
    await views.getByRole("link", { name: "Grid", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search posts", exact: true });
    await search.fill("customer interview");
    await expect(gallery.locator("article")).toHaveCount(1);
    await gallery.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/publications/${text.id}`));
    await expectPostText(
      page.getByRole("textbox", { name: "Post text", exact: true }),
      "The lesson from our first customer interview",
    );
    expect(errors).toEqual([]);
  });

  test("calendar keeps sparse and busy days recognizable and opens every overflow post", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(new Date(fixedNow));
    const auth = await registerUser(request, `calendar-recognition-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Calendar recognition");
    const titles = [
      "Launch photos in Lisbon",
      "Customer interview lesson",
      "A useful release note",
      "Behind the scenes",
      "Our founder story",
    ];
    for (const [index, title] of titles.entries()) {
      const publication = await createPublication(request, auth.token, workspace.id, title);
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `UPDATE publications SET status='scheduled',scheduled_at='2026-08-${index === 0 ? "21" : "22"} ${String(10 + index).padStart(2, "0")}:00:00+00:00' WHERE id='${publication.id}';`,
      ]);
    }
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(`/calendar?workspace_id=${workspace.id}`);
    const quiet = page.locator('[data-calendar-day="2026-08-21"]');
    const busy = page.locator('[data-calendar-day="2026-08-22"]');
    await expect(quiet.locator("[data-calendar-item]")).toHaveCount(1);
    await expect(busy.locator("[data-calendar-item]")).toHaveCount(2);
    const overflow = busy.getByRole("button", { name: /View 4 posts/ }).last();
    await expect(overflow).toHaveText("+2");
    await expect(page.getByTestId("desktop-sidebar-planner")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 600 });
    await expect(busy.locator("[data-calendar-item]")).toHaveCount(1);
    await expect(overflow).toHaveText("+3");
    expect((await page.locator(".month-shell").boundingBox())!.height).toBeLessThan(600);
    await page.locator('[data-calendar-day="2026-09-06"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-calendar-day="2026-09-06"]')).toBeInViewport();
    await page.setViewportSize({ width: 1440, height: 1080 });
    await expect(overflow).toHaveText("+2");
    await overflow.focus();
    await page.keyboard.press("Enter");
    const agenda = page.getByTestId("calendar-day-drawer");
    await expect(agenda).toBeVisible();
    for (const title of titles.slice(1))
      await expect(agenda.getByText(title, { exact: true })).toBeVisible();
    const touchContext = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
      hasTouch: true,
      storageState: await page.context().storageState(),
    });
    try {
      const touchPage = await touchContext.newPage();
      await touchPage.clock.setFixedTime(new Date(fixedNow));
      await touchPage.goto(page.url());
      await expect(touchPage.getByTestId("calendar-date-picker")).toBeVisible();
      await expect(touchPage.locator(".month-shell")).toBeHidden();
      const day = touchPage
        .getByTestId("calendar-date-picker")
        .getByRole("button", { name: "Saturday, Aug 22", exact: true });
      await day.click();
      const target = (await day.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      await expect(
        touchPage.getByRole("button", { name: /Customer interview lesson/ }),
      ).toBeVisible();
    } finally {
      await touchContext.close();
    }
  });
});

test.describe("post tab history", () => {
  test("publication tab selection keeps the visible URL, reload and history in agreement", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const auth = await registerUser(request, `tab-history-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Tab history");
    await authenticatePage(page, auth.token);
    await page.goto("/publications");
    const scheduled = page.getByRole("tab", { name: "Scheduled", exact: true });
    const published = page.getByRole("tab", { name: "Published", exact: true });
    await expect(scheduled).toHaveAttribute("aria-selected", "true");
    await published.click();
    await expect(published).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/publications\?tab=published$/);
    await scheduled.focus();
    await page.keyboard.press("Enter");
    await expect(scheduled).toHaveAttribute("aria-selected", "true");
    await expect(scheduled).toBeFocused();
    await expect(page).toHaveURL(/\/publications$/);
    await page.reload();
    await expect(scheduled).toHaveAttribute("aria-selected", "true");

    const failed = page.getByRole("tab", { name: "Failed", exact: true });
    const view = page.getByRole("navigation", { name: "Post view" });
    await page.goto("/publications?tab=failed");
    await expect(failed).toHaveAttribute("aria-selected", "true");
    await view.getByRole("link", { name: "Calendar", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(view.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await view.getByRole("link", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/\/publications\?tab=failed$/);
    await expect(failed).toHaveAttribute("aria-selected", "true");
    await published.click();
    await expect(page).toHaveURL(/\/publications\?tab=published$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(view.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/publications\?tab=failed$/);
    await expect(failed).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(view.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.goForward();
    await expect(page).toHaveURL(/\/publications\?tab=published$/);
    await expect(published).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(published).toHaveAttribute("aria-selected", "true");
    expect(errors).toEqual([]);
  });

  test("published detail Back retains explicit Published scope after Drafts entry", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const auth = await registerUser(request, `detail-history-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Detail history");
    const publishedText = "Audit published detail return";
    const draftText = "Audit unrelated draft scope";
    const publication = await createPublication(request, auth.token, workspace.id, publishedText);
    await createPublication(request, auth.token, workspace.id, draftText);
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='published',actual_run_at='2026-10-02 15:11:00+00:00' WHERE id='${publication.id}';`,
    ]);
    await authenticatePage(page, auth.token);
    const published = page.getByRole("tab", { name: "Published", exact: true });
    await page.goto("/publications?tab=drafts");
    await expect(page.getByRole("tab", { name: "Drafts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await published.click();
    await expect(page).toHaveURL(/\/publications\?tab=published$/);
    const publishedLink = page.getByRole("link", { name: publishedText, exact: true });
    await publishedLink.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: publishedText, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy as draft", exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: publishedText, exact: true, level: 1 }),
    ).toBeVisible();
    const back = page.getByRole("button", { name: "Back", exact: true });
    await back.focus();
    await expect(back).toBeFocused();
    await back.click();
    await expect(page).toHaveURL(/\/publications\?tab=published$/);
    await expect(published).toHaveAttribute("aria-selected", "true");
    await expect(publishedLink).toBeVisible();
    await expect(page.getByTestId("publication-list")).not.toContainText(draftText);
    await publishedLink.click();
    await expect(
      page.getByRole("heading", { name: publishedText, exact: true, level: 1 }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/publications\?tab=published$/);
    await expect(published).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(published).toHaveAttribute("aria-selected", "true");
    await expect(publishedLink).toBeVisible();
    await expect(page.getByTestId("publication-list")).not.toContainText(draftText);
    const unchanged = await request.get(
      `/api/v1/publications/${publication.id}?workspace_id=${workspace.id}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    expect(unchanged.ok()).toBe(true);
    expect(await unchanged.json()).toMatchObject({
      status: "published",
      revision: 1,
      actual_run_at: "2026-10-02T15:11:00Z",
    });

    expect(errors).toEqual([]);
  });
});

test.describe("schedule clock", () => {
  const clocks = [
    {
      workspaceZone: "Europe/Lisbon",
      browserZone: "Asia/Tokyo",
      scheduledTime: "04:00 PM",
      publishedTime: "04:11 PM",
      dstTime: "01:57 AM",
      boundarySchedule: "2026-10-02T23:02:00Z",
      boundaryDispatch: "2026-10-02T22:57:00Z",
      dayFrom: "2026-10-02T23:00:00Z",
      dayBefore: "2026-10-03T23:00:00Z",
    },
    {
      workspaceZone: "UTC",
      browserZone: "America/Los_Angeles",
      scheduledTime: "03:00 PM",
      publishedTime: "03:11 PM",
      dstTime: "12:57 AM",
      boundarySchedule: "2026-10-03T00:02:00Z",
      boundaryDispatch: "2026-10-02T23:57:00Z",
      dayFrom: "2026-10-03T00:00:00Z",
      dayBefore: "2026-10-04T00:00:00Z",
    },
  ] as const;

  for (const clock of clocks) {
    test.describe(`${clock.workspaceZone} workspace and ${clock.browserZone} browser`, () => {
      test.use({ timezoneId: clock.browserZone });
      test("planned List and Calendar share the authored clock while published outcomes use actual time", async ({
        page,
        request,
      }) => {
        test.setTimeout(90_000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        const auth = await registerUser(request, `schedule-clock-${randomUUID()}@example.com`);
        const workspace = await createWorkspace(request, auth.token, "Schedule clock");
        const headers = { Authorization: `Bearer ${auth.token}` };
        const settings = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
          headers,
          data: { timezone: clock.workspaceZone },
        });
        expect(settings.ok()).toBe(true);
        const fixtures = [
          {
            text: "Audit schedule with dispatch jitter",
            status: "scheduled",
            scheduledAt: "2026-10-02T15:00:00Z",
            actualAt: "2026-10-02T15:11:00Z",
            day: "Oct 2",
            time: clock.scheduledTime,
          },
          {
            text: "Audit authored midnight boundary",
            status: "scheduled",
            scheduledAt: clock.boundarySchedule,
            actualAt: clock.boundaryDispatch,
            day: "Oct 3",
            time: "12:02 AM",
          },
          {
            text: "Audit publishing through autumn clock change",
            status: "publishing",
            scheduledAt: "2026-10-25T00:57:00Z",
            actualAt: "2026-10-25T01:02:00Z",
            day: "Oct 25",
            time: clock.dstTime,
          },
          {
            text: "Audit published recorded outcome",
            status: "published",
            scheduledAt: "2026-10-02T15:00:00Z",
            actualAt: "2026-10-02T15:11:00Z",
            day: "Oct 2",
            time: clock.publishedTime,
          },
        ];
        const records: Array<{ id: string; scheduledAt: string; actualAt: string }> = [];
        for (const fixture of fixtures) {
          const publication = await createPublication(
            request,
            auth.token,
            workspace.id,
            fixture.text,
          );
          // Read fixtures have no jobs or provider destinations, so no delivery can execute.
          execFileSync("sqlite3", [
            "-cmd",
            ".timeout 5000",
            `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
            `UPDATE publications SET status='${fixture.status}', scheduled_at='${fixture.scheduledAt.replace("T", " ").replace("Z", "+00:00")}', actual_run_at='${fixture.actualAt.replace("T", " ").replace("Z", "+00:00")}', random_delay_minutes=15 WHERE id='${publication.id}';`,
          ]);
          records.push({
            id: publication.id,
            scheduledAt: fixture.scheduledAt,
            actualAt: fixture.actualAt,
          });
        }
        const boundaryRange = await request.get("/api/v1/publications", {
          headers,
          params: {
            workspace_id: workspace.id,
            calendar_from: clock.dayFrom,
            calendar_before: clock.dayBefore,
          },
        });
        expect(boundaryRange.ok()).toBe(true);
        expect((await boundaryRange.json()).map((item: { id: string }) => item.id)).toEqual([
          records[1].id,
        ]);
        await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z"));
        await page.setViewportSize({ width: 390, height: 900 });
        await authenticatePage(page, auth.token);
        await page.goto("/calendar");
        for (const fixture of fixtures) {
          await page
            .getByTestId("calendar-date-picker")
            .getByRole("button", { name: new RegExp(`${fixture.day}$`) })
            .click();
          const item = page.getByRole("button").filter({ hasText: fixture.text });
          await expect(item).toContainText(fixture.time);
          await expect(
            item.locator("xpath=ancestor::section[1]").getByRole("heading"),
          ).toContainText(fixture.day);
        }
        await page.getByRole("link", { name: "List", exact: true }).click();
        await page.getByRole("tab", { name: "Scheduled", exact: true }).click();
        for (const fixture of fixtures.filter((item) => item.status !== "published")) {
          await expect(page.locator("article").filter({ hasText: fixture.text })).toContainText(
            `${fixture.day}, ${fixture.time}`,
          );
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.reload();
        await expect(page.getByRole("tab", { name: "Scheduled", exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        const scheduled = page.locator("article").filter({ hasText: fixtures[0].text });
        await expect(scheduled).toContainText(`Oct 2, ${clock.scheduledTime}`);
        const calendar = page.getByRole("link", { name: "Calendar", exact: true });
        await calendar.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("heading", { name: "Posts", exact: true })).toBeVisible();
        await expect(page.getByRole("button").filter({ hasText: fixtures[0].text })).toContainText(
          clock.scheduledTime,
        );
        const list = page.getByRole("link", { name: "List", exact: true });
        await list.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("tab", { name: "Scheduled", exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(scheduled).toContainText(`Oct 2, ${clock.scheduledTime}`);
        await page.getByRole("tab", { name: "Published", exact: true }).click();
        await expect(page.locator("article").filter({ hasText: fixtures[3].text })).toContainText(
          `${fixtures[3].day}, ${fixtures[3].time}`,
        );
        for (const record of records) {
          const response = await request.get(`/api/v1/publications/${record.id}`, { headers });
          expect(response.ok()).toBe(true);
          const persisted = await response.json();
          expect(persisted.scheduled_at).toBe(record.scheduledAt);
          expect(persisted.actual_run_at).toBe(record.actualAt);
        }
        expect(errors).toEqual([]);
      });
    });
  }
});

test.describe("posting times duplicate", () => {
  test("adding an existing time explains that no weekdays changed", async ({ page, request }) => {
    const auth = await registerUser(request, `existing-time-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Existing weekly time");
    const headers = { Authorization: `Bearer ${auth.token}` };
    for (let day = 0; day < 7; day++) {
      const response = await request.post("/api/v1/posting-schedules", {
        headers,
        data: { workspace_id: workspace.id, utc_hour: 9, utc_minute: 0, day_of_week: day },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/settings?tab=schedule&workspace_id=${workspace.id}`);
    const add = page.getByRole("button", { name: "Add time", exact: true });
    await expect(add).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove the 9:00 AM row", exact: true }),
    ).toBeVisible();
    await add.focus();
    await add.press("Enter");
    const notice = page.getByText("This time already exists for all selected days.", {
      exact: true,
    });
    await expect(notice).toBeVisible();
    await expect(page.getByText("Time row added successfully", { exact: true })).toHaveCount(0);
    const saved = await request.get("/api/v1/posting-schedules", {
      headers,
      params: { workspace_id: workspace.id },
    });
    expect(saved.ok()).toBeTruthy();
    const slots = await saved.json();
    expect(slots).toHaveLength(7);
    expect(slots.map((slot: { day_of_week: number }) => slot.day_of_week).sort()).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    await page.reload();
    await expect(add).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove the 9:00 AM row", exact: true }),
    ).toBeVisible();
    await add.click();
    await expect(notice).toBeVisible();
    await page.locator("#new-time").fill("10:00");
    await add.focus();
    await add.press("Enter");
    await expect(page.getByText("Time row added successfully", { exact: true })).toBeVisible();
    const updated = await request.get("/api/v1/posting-schedules", {
      headers,
      params: { workspace_id: workspace.id },
    });
    expect(updated.ok()).toBeTruthy();
    const updatedSlots: { utc_hour: number; day_of_week: number }[] = await updated.json();
    expect(updatedSlots).toHaveLength(12);
    expect(
      updatedSlots
        .filter((slot) => slot.utc_hour === 10)
        .map((slot) => slot.day_of_week)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(errors).toEqual([]);
  });
});

test.describe("posting times removal", () => {
  test("reloading before the row removal response leaves no partially removed weekdays", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `row-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Weekly removal recovery");
    const headers = { Authorization: `Bearer ${auth.token}` };
    for (let day = 0; day < 7; day++) {
      const created = await request.post("/api/v1/posting-schedules", {
        headers,
        data: { workspace_id: workspace.id, utc_hour: 9, utc_minute: 0, day_of_week: day },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
    }
    await authenticatePage(page, auth.token);
    await page.goto(`/settings?tab=schedule&workspace_id=${workspace.id}`);
    await page.getByRole("button", { name: "Remove the 9:00 AM row", exact: true }).click();
    let admitted!: () => void;
    const mutationCommitted = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let release!: () => void;
    const responseReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/posting-schedules/**", async (route) => {
      if (
        route.request().method() !== "DELETE" &&
        !route.request().url().endsWith("/batch-delete")
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBeTruthy();
      admitted();
      await responseReleased;
      // Reload has already discarded the old document and its waiting response.
      await route.abort().catch(() => {});
    });
    await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
    await mutationCommitted;
    await page.reload();
    release();
    const saved = await request.get("/api/v1/posting-schedules", {
      headers,
      params: { workspace_id: workspace.id },
    });
    expect(saved.ok()).toBeTruthy();
    expect(await saved.json()).toEqual([]);
    await expect(page.getByRole("heading", { name: "Weekly times", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add time", exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "No posting times yet. Add a row above or generate a suggested weekly pattern.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove the 9:00 AM row", exact: true }),
    ).toHaveCount(0);
  });
});

test.describe("repost cycles", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 320, height: 720 },
  ]) {
    test(`edits a repost cycle at ${viewport.width}px`, async ({ page, request }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const auth = await registerUser(
        request,
        `repost-cycle-${viewport.width}-${randomUUID()}@example.com`,
      );
      const workspace = (await createWorkspace(request, auth.token, "Repost cycle")) as {
        id: string;
      };
      await authenticatePage(page, auth.token);
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      let savedBody: unknown;
      await page.route(/\/api\/v1\/repost-automation(?:\?.*)?$/, async (route) => {
        if (route.request().method() === "PUT") {
          savedBody = route.request().postDataJSON();
        }
        const response = settingsResponse(workspace.id);
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(
            savedBody
              ? {
                  ...response,
                  policies: (savedBody as { policies: unknown[] }).policies,
                }
              : response,
          ),
        });
      });

      if (viewport.width === 1440) {
        await page.goto("/workflows");
        await page.getByRole("link", { name: "Launch cycle Automatic reposting Active" }).click();
      } else {
        await page.goto("/settings?tab=reposts");
      }
      await expect(page).toHaveURL(/\/workflows\/reposts/);
      const settings = page.getByTestId("repost-automation-settings");
      await expect(settings).toBeVisible();
      await page.getByRole("tab", { name: "Runs", exact: true }).click();
      await page.getByText("Original launch rule", { exact: true }).click();
      await expect(page.getByText("Waiting · 1/2", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Open post", exact: true })).toHaveAttribute(
        "href",
        "/publications/existing-publication",
      );
      await page.getByRole("tab", { name: "Configure", exact: true }).click();
      const addRepost = settings.getByRole("button", { name: "Add repost" });
      if (viewport.width === 1440) {
        await addRepost.focus();
        await expect(addRepost).toBeFocused();
        await page.keyboard.press("Enter");
      } else {
        await addRepost.click();
      }
      await expect(settings.getByText("Repost 2")).toBeVisible();
      await expect(settings.getByText("Remove the previous repost first")).toBeVisible();
      await settings.getByRole("button", { name: "Save changes" }).click();
      await expect
        .poll(() => savedBody)
        .toEqual({
          workspace_id: workspace.id,
          expected_revision: "saved-revision",
          policies: [
            expect.objectContaining({
              rule: expect.objectContaining({
                stages: [
                  { delay_seconds: 0, unrepost_previous: false },
                  { delay_seconds: 900, unrepost_previous: true },
                ],
              }),
            }),
          ],
        });
      if (viewport.width <= 390) {
        for (const control of [
          settings.getByRole("button", { name: "Add repost" }),
          settings.getByRole("button", { name: "Remove repost 1" }),
          settings.getByRole("button", { name: "Remove repost 2" }),
        ]) {
          const box = await control.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(box?.width).toBeGreaterThanOrEqual(44);
        }
      }
      await settings.getByRole("group", { name: "Repost schedule" }).scrollIntoViewIfNeeded();
      expect(browserErrors).toEqual([]);
    });
  }

  function settingsResponse(workspaceID: string) {
    return {
      workspace_id: workspaceID,
      can_manage: true,
      revision: "saved-revision",
      executions: [
        {
          id: "existing-run",
          policy_id: `${workspaceID}-policy`,
          policy_name: "Original launch rule",
          publication_id: "existing-publication",
          target_account_id: `${workspaceID}-account`,
          status: "pending",
          current_stage: 1,
          total_stages: 2,
          created_at: "2026-09-20T12:00:00Z",
          next_check_at: "2026-09-23T12:00:00Z",
          rule: {},
          history: [],
        },
      ],
      accounts: [
        {
          id: `${workspaceID}-account`,
          workspace_id: workspaceID,
          workspace_name: "Repost cycle",
          username: "launch-account",
          platform: "x",
          cross_workspace: false,
          grant_active: false,
          grant_required: false,
          supports_repost: true,
        },
      ],
      grants: [],
      policies: [
        {
          id: `${workspaceID}-policy`,
          name: "Launch cycle",
          enabled: true,
          source_account_ids: [],
          target_account_ids: [`${workspaceID}-account`],
          rule: {
            delay_seconds: 0,
            evaluation_window_seconds: 3600,
            threshold_mode: "all",
            min_likes: 0,
            min_comments: 0,
            min_reposts: 0,
            min_views: 0,
            require_plateau: false,
            plateau_checks: 2,
          },
        },
      ],
      supported_platforms: ["x"],
    };
  }
});

test.describe("thread reorder", () => {
  test("thread authoring reorder supports keyboard preview, drop, cancel, and undo", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const unique = `authoring-order-${randomUUID()}@example.com`;
    const auth = await registerUser(request, unique);
    const workspace = await createWorkspace(request, auth.token, "Authoring order");
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "First draft post",
    );
    await authenticatePage(page, auth.token);

    const saves: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/v1/publications")) {
        saves.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto(`/publications/${publication.id}`);
    const composer = page.getByTestId("text-thread-composer-content");
    await expect(composer).toBeVisible({ timeout: 30000 });

    await page.locator("#post-textarea-0").fill("First edited post");
    await composer.getByRole("button", { name: "Add post", exact: true }).click();
    await expect(page.locator("#post-textarea-1")).toBeVisible();
    await page.locator("#post-textarea-1").fill("Second edited post");

    // Wait for the edits to autosave, then prove keyboard preview does not save again.
    await expect.poll(() => saves.length, { timeout: 10_000 }).toBeGreaterThan(0);
    saves.length = 0;
    const handles = composer.locator("[data-reorder-key]");
    await expect(handles).toHaveCount(2);
    await handles.nth(0).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await expectPostText(page.locator("#post-textarea-0"), "Second edited post");
    await expectPostText(page.locator("#post-textarea-1"), "First edited post");
    // Autosave debounces for about two seconds; no save may appear within that window.
    await expect(async () => expect(saves).not.toHaveLength(0)).not.toPass({ timeout: 2_500 });

    await page.keyboard.press("Escape");
    await expectPostText(page.locator("#post-textarea-0"), "First edited post");
    await expectPostText(page.locator("#post-textarea-1"), "Second edited post");

    await handles.nth(0).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expectPostText(page.locator("#post-textarea-0"), "Second edited post");
    await expectPostText(page.locator("#post-textarea-1"), "First edited post");

    const undo = composer.getByRole("button", { name: "Undo reorder", exact: true });
    await expect(undo).toBeVisible();
    await page.locator("#post-textarea-0").fill("Second edited after reorder");
    await undo.click();
    await expectPostText(page.locator("#post-textarea-0"), "First edited post");
    await expectPostText(page.locator("#post-textarea-1"), "Second edited after reorder");
    const text = page.locator("#post-textarea-1");
    const textBounds = await text.boundingBox();
    const removeBounds = await composer
      .getByRole("button", { name: "Remove post", exact: true })
      .nth(1)
      .boundingBox();
    const padding = await text.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingRight),
    );
    expect(textBounds).not.toBeNull();
    expect(removeBounds).not.toBeNull();
    expect(textBounds!.x + textBounds!.width - padding).toBeLessThanOrEqual(removeBounds!.x);
    expect(errors).toEqual([]);
  });
});
