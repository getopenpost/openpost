import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createPublication,
  createWorkspace,
  registerUser,
  expectPostText,
} from "./helpers";
import {
  fixtureDirectory,
  fixedNow,
  rasterFixtureFiles,
  uploadImageFixture,
} from "./product-capture-fixtures";

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
}, info) => {
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
  await page.screenshot({ path: info.outputPath("list-1440-light.png"), animations: "disabled" });

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
  for (const width of [1440, 320]) {
    for (const scheme of ["light"] as const) {
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await settleCardContrast(page);
      if (width === 1440)
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.screenshot({
        path: info.outputPath(`drafts-${width}-${scheme}.png`),
        animations: "disabled",
      });
    }
  }
  await page.context().addCookies([{ name: "PARAGLIDE_LOCALE", value: "ja", url: page.url() }]);
  await page.reload();
  await expect(page.getByRole("link", { name: "グリッド", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath("drafts-320-ja.png"), animations: "disabled" });
  await page.context().addCookies([{ name: "PARAGLIDE_LOCALE", value: "en", url: page.url() }]);
  await page.reload();
  await page.getByRole("button", { name: "Select drafts", exact: true }).click();
  await gallery.getByRole("checkbox").first().check();
  await expect(gallery.getByRole("checkbox").first()).toBeChecked();
  await views.getByRole("link", { name: "List", exact: true }).click();
  await expect(page.getByTestId("publication-list").locator(":scope > article")).toHaveCount(7);
  await expect(page.getByTestId("publication-list").getByRole("checkbox").first()).toBeChecked();
  await page.screenshot({
    path: info.outputPath("list-320-selection.png"),
    animations: "disabled",
  });

  await views.getByRole("link", { name: "Grid", exact: true }).click();
  await expect(gallery.getByRole("checkbox").first()).toBeChecked();
  await expect(page.getByRole("button", { name: "Schedule selected", exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const plainCard = gallery.locator("article").filter({ hasText: "مرحبا" });
  expect((await plainCard.boundingBox())!.height).toBeLessThan(180);
  await page.screenshot({
    path: info.outputPath("drafts-320-selection.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
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
}, info) => {
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
  for (const scheme of ["light"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.screenshot({
      path: info.outputPath(`calendar-${scheme}.png`),
      animations: "disabled",
    });
  }
  for (const height of [600, 720]) {
    await page.setViewportSize({ width: 1280, height });
    await expect(busy.locator("[data-calendar-item]")).toHaveCount(1);
    await expect(overflow).toHaveText("+3");
    expect((await page.locator(".month-shell").boundingBox())!.height).toBeLessThan(600);
    await page.locator('[data-calendar-day="2026-09-06"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-calendar-day="2026-09-06"]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.locator(".month-shell").evaluate((shell) => {
      for (let parent = shell.parentElement; parent; parent = parent.parentElement) {
        parent.scrollTop = 0;
        parent.scrollLeft = 0;
      }
    });
    expect(
      await page
        .locator(".month-shell")
        .evaluate((shell) => shell.scrollWidth <= shell.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`calendar-1280-${height}.png`),
      animations: "disabled",
    });
  }
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
    await touchPage.screenshot({
      path: info.outputPath("calendar-touch-desktop.png"),
      animations: "disabled",
    });
  } finally {
    await touchContext.close();
  }
});
