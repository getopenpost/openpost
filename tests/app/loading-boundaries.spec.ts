import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.use({ serviceWorkers: "block" });

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

for (const section of ["publications", "messages", "engagement"] as const) {
  for (const width of [1280, 390, 320]) {
    test(`${section} keeps controls while the selected view loads at ${width}px`, async ({
      page,
      request,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: width === 320 ? "dark" : "light" });
      const { token } = await registerUser(
        request,
        `view-loading-${section}-${Date.now()}@example.com`,
      );
      await createWorkspace(request, token, "View loading");
      await authenticatePage(page, token);
      await page.goto(
        section === "publications" ? "/publications?tab=scheduled" : `/inbox/${section}`,
      );
      await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await page.waitForLoadState("networkidle");
      let release!: () => void;
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/v1/**", async (route) => {
        await response;
        await route.continue();
      });
      const control =
        section === "publications"
          ? page.getByRole("tab", { name: "Published", exact: true })
          : page.getByRole("checkbox", { name: "Archived", exact: true });
      try {
        await control.click();
        await expect(page.getByTestId("page-loading")).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`${section}-loading.png`),
          fullPage: true,
        });
        await expect(control).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        if (section !== "publications") {
          const navigation = page.getByTestId("communications-navigation");
          await expect(navigation).toBeVisible();
          if (width === 320) {
            await navigation.hover();
            await page.mouse.wheel(400, 0);
            await expect(
              navigation.getByRole("link", { name: "Notifications", exact: true }),
            ).toBeInViewport({ ratio: 1 });
            await expect(page.getByTestId("page-header")).toBeInViewport({ ratio: 1 });
          }
        }
        await expect(
          page.locator('[data-slot="page-header-actions"]').getByRole("button").first(),
        ).toBeVisible();
      } finally {
        release();
      }
      await expect(page.getByTestId("page-loading")).toHaveCount(0);
      await expect(control).toBeVisible();
    });
  }
}

for (const width of [1280, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`settings keeps navigation during section downloads at ${width}px ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const { token } = await registerUser(request, `loading-boundary-${Date.now()}@example.com`);
      await createWorkspace(request, token, "Loading boundaries");
      await authenticatePage(page, token);
      await page.goto("/settings?tab=general");
      await expect(page.getByTestId("settings-navigation")).toBeVisible();
      await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await page.waitForLoadState("networkidle");
      let release!: () => void;
      const download = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/*.js", async (route) => {
        await download;
        await route.continue();
      });
      try {
        if (width >= 768) await page.locator('[data-settings-tab="accounts"]').click();
        else {
          await page
            .getByTestId("settings-navigation")
            .getByRole("button", { name: "Settings", exact: true })
            .click();
          await page.getByRole("option", { name: "Social accounts", exact: true }).click();
        }
        await expect(page).toHaveURL(/tab=accounts/);
        await expect(page.getByTestId("page-loading")).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath("settings-section-loading.png"),
          fullPage: true,
        });
        await expect(page.getByTestId("settings-navigation")).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Social accounts", exact: true }).first(),
        ).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        if (width >= 768) {
          const general = page.locator('[data-settings-tab="general"]');
          await general.focus();
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(/tab=general/);
          await expect(page.getByTestId("page-loading")).toHaveCount(0);
          await page.locator('[data-settings-tab="accounts"]').click();
          await expect(page.getByTestId("page-loading")).toBeVisible();
        }
      } finally {
        release();
      }
      await expect(page.getByTestId("page-loading")).toHaveCount(0);
      await expect(page.getByTestId("settings-navigation")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("settings-section-settled.png"),
        fullPage: true,
      });
    });
  }
}

for (const surface of ["calendar", "media"] as const) {
  test(`${surface} keeps controls when its data scope changes`, async ({
    page,
    request,
  }, testInfo) => {
    const { token } = await registerUser(
      request,
      `scope-loading-${surface}-${Date.now()}@example.com`,
    );
    await createWorkspace(request, token, "First workspace");
    await createWorkspace(request, token, "Second workspace");
    await authenticatePage(page, token);
    await page.goto(`/${surface}`);
    const control =
      surface === "calendar"
        ? page.getByRole("button", { name: "Next month", exact: true })
        : page.getByTestId("media-filter-bar").getByRole("textbox");
    await expect(control).toBeVisible();
    await page.waitForLoadState("networkidle");
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(surface === "media" ? "**/api/v1/media**" : "**/api/v1/**", async (route) => {
      await response;
      await route.continue();
    });
    try {
      if (surface === "calendar") await control.click();
      else {
        await page
          .locator('[data-slot="page-header-actions"]')
          .getByRole("button", { name: "First workspace", exact: true })
          .click();
        await page.getByRole("option", { name: "Second workspace", exact: true }).click();
      }
      await expect(page.getByTestId("page-loading")).toBeVisible();
      await expect(control).toBeVisible();
      if (surface === "media") {
        await expect(page.getByTestId("media-lifecycle-tabs")).toBeVisible();
        await control.fill("launch");
        await expect(control).toHaveValue("launch");
      }
      await page.screenshot({
        path: testInfo.outputPath(`${surface}-scope-loading.png`),
        fullPage: true,
      });
    } finally {
      release();
    }
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
  });
}

test("Grow can switch back while another account is still loading", async ({ page, request }) => {
  const { token } = await registerUser(request, `grow-loading-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, token, "Grow loading");
  await authenticatePage(page, token);
  const accounts = ["first", "second"].map((name) => ({
    id: name,
    workspace_id: workspace.id,
    platform: "bluesky",
    is_active: true,
    account_username: name,
  }));
  await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: accounts }));
  await page.route("**/api/v1/account-features?**", (route) =>
    route.fulfill({
      json: accounts.map((account) => ({
        social_account_id: account.id,
        feature: "grow",
        effective_enabled: true,
      })),
    }),
  );
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/growth?**", async (route) => {
    const account = new URL(route.request().url()).searchParams.get("account_id");
    if (account === "second") await response;
    await route.fulfill({
      json: {
        items: [],
        follow_updates: [],
        sync_state: {
          workspace_id: workspace.id,
          social_account_id: account,
          status: "ok",
          last_success_at: null,
        },
      },
    });
  });
  await page.goto("/grow");
  const selector = page.getByTestId("grow-account-select");
  await expect(selector).toContainText("first");
  await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
    "aria-busy",
    "false",
  );
  try {
    await selector.click();
    await page.getByRole("option").filter({ hasText: "second" }).click();
    await expect(page.getByTestId("page-loading")).toBeVisible();
    await expect(selector).toBeVisible();
    await selector.click();
    await page.getByRole("option").filter({ hasText: "first" }).click();
    await expect(selector).toContainText("first");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(selector).toContainText("first");
});
