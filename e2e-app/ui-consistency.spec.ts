import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const tinyPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const coreRoutes = [
  "/activity",
  "/accounts",
  "/media",
  "/prompts",
  "/settings",
  "/calendar",
];
const viewports = [
  { name: "compact phone portrait", width: 320, height: 568 },
  { name: "phone portrait", width: 390, height: 844 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

const portuguesePortraitRoutes = [
  {
    viewport: { width: 320, height: 568 },
    routes: [
      {
        path: "/activity",
        heading: "Publicações",
        action: "Atualizar",
        actionRole: "button",
      },
      {
        path: "/accounts",
        heading: "Contas sociais",
        action: "Criar publicação",
        actionRole: "link",
      },
      {
        path: "/media",
        heading: "Multimédia",
        action: "Enviar",
        actionRole: "button",
      },
    ],
  },
  {
    viewport: { width: 390, height: 844 },
    routes: [
      {
        path: "/prompts",
        heading: "Prompts de escrita",
        action: "Adicionar prompt",
        actionRole: "button",
      },
      {
        path: "/calendar",
        supportingHeading: "Calendário de publicação",
        action: "Hoje",
        actionRole: "button",
      },
    ],
  },
] as const;

async function createAuthenticatedWorkspace(
  page: Page,
  request: APIRequestContext,
  seed: string,
) {
  const auth = await registerUser(
    request,
    `ui-consistency-${seed}@example.com`,
  );
  await createWorkspace(request, auth.token, `UI consistency ${seed}`);
  await authenticatePage(page, auth.token);
}

async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function expectMobileTouchTargets(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 768) return;

  const undersizedTargets = await page
    .locator(
      'button:visible, [role="button"]:visible, [role="tab"]:visible, [role="combobox"]:visible',
    )
    .evaluateAll((elements) => {
      const uniqueElements = Array.from(new Set(elements));

      return uniqueElements.flatMap((element) => {
        let current: Element | null = element;
        while (current) {
          const style = getComputedStyle(current);
          if (
            current.hasAttribute("hidden") ||
            current.hasAttribute("inert") ||
            current.getAttribute("aria-hidden") === "true" ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
            return [];
          }
          current = current.parentElement;
        }

        const bounds = element.getBoundingClientRect();
        if (bounds.width >= 44 && bounds.height >= 44) return [];

        const label =
          element.getAttribute("aria-label") ||
          element.getAttribute("data-testid") ||
          element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ||
          "unlabelled";

        return [
          {
            element: element.tagName.toLowerCase(),
            label,
            width: Number(bounds.width.toFixed(1)),
            height: Number(bounds.height.toFixed(1)),
          },
        ];
      });
    });

  expect(
    undersizedTargets,
    `visible mobile button, tab, and select targets should be at least 44x44px at ${viewport.width}px`,
  ).toEqual([]);
}

async function expectConsistentPageFrame(page: Page) {
  await expect(page.getByTestId("page-header")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCSS("font-size", "20px");
  await expect(
    page.locator('[data-testid="page-loading"]:visible'),
  ).toHaveCount(0, {
    timeout: 15_000,
  });
  await expectNoDocumentOverflow(page);
}

for (const viewport of viewports) {
  test(`core routes keep one stable page heading without document overflow on ${viewport.name}`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const seed = `${viewport.width}-${Date.now().toString(36)}-${testInfo.workerIndex}`;
    await createAuthenticatedWorkspace(page, request, seed);

    for (const route of coreRoutes) {
      await test.step(route, async () => {
        await page.goto(route);
        await expectConsistentPageFrame(page);
        await expectMobileTouchTargets(page);

        if (route === "/calendar") {
          const calendarContent = page.locator("[data-calendar-content]");
          const agenda = calendarContent
            .locator(":scope > section:not(.month-shell)")
            .first();
          const month = page.locator(".month-shell");

          await expect(page.locator("main")).toHaveCount(1);
          await expect(month).toHaveCount(1);
          if (viewport.width < 1280) {
            await expect
              .poll(() =>
                agenda.evaluate((element) => getComputedStyle(element).display),
              )
              .not.toBe("none");
            await expect(month).toBeHidden();
          } else {
            await expect(agenda).toBeHidden();
            await expect(month).toBeVisible();
          }
        }

        if (route === "/accounts") {
          const settingsNavigation = page.getByTestId("settings-navigation");
          await expect(settingsNavigation).toBeVisible();
          if (viewport.width < 1024) {
            await expect(
              settingsNavigation.locator('button[aria-label="Settings"]'),
            ).toContainText("Social accounts");
          } else {
            await expect(
              settingsNavigation.locator('[data-settings-tab="accounts"]'),
            ).toHaveAttribute("aria-current", "page");
          }
        }
      });
    }

    await page.goto("/settings");
    await expectConsistentPageFrame(page);
    const mobileSettingsSelector = page.locator(
      'aside button[aria-label="Settings"]',
    );
    await expect(mobileSettingsSelector).toHaveCount(1);

    if (viewport.width < 1024) {
      await expect(mobileSettingsSelector).toBeVisible();
      await mobileSettingsSelector.click();
      const settingsMenuViewport = page.locator(
        '[data-slot="select-content"] [data-slot="select-viewport"]',
      );
      await expect(settingsMenuViewport).toBeVisible();
      await page.setViewportSize({ width: viewport.width, height: 320 });
      await expect
        .poll(() =>
          settingsMenuViewport.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        )
        .toBe(true);
      await settingsMenuViewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() =>
          settingsMenuViewport.evaluate((element) => element.scrollTop),
        )
        .toBeGreaterThan(0);
      await page.getByRole("option", { name: "Posting schedule" }).click();
      await page.setViewportSize(viewport);
    } else {
      await expect(mobileSettingsSelector).toBeHidden();
      await page.locator('[data-settings-tab="schedule"]').click();
    }

    const scheduleSection = page.locator("#posting-schedule");
    await expect(scheduleSection).toBeVisible();
    await expect(
      scheduleSection.getByRole("heading", {
        level: 2,
        name: "Posting schedule",
      }),
    ).toBeVisible();
    await scheduleSection.locator("#new-time").scrollIntoViewIfNeeded();
    await expect(scheduleSection.locator("#new-time")).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await expectNoDocumentOverflow(page);

    if (viewport.width < 1024) {
      await mobileSettingsSelector.click();
      await page.getByRole("option", { name: "Social accounts" }).click();
    } else {
      await page.locator('[data-settings-tab="accounts"]').click();
    }
    await expect(page).toHaveURL(/\/settings\?tab=accounts$/);
    await expect(page.getByTestId("settings-navigation")).toBeVisible();
    await expectNoDocumentOverflow(page);

    await page.goto("/settings?tab=accounts");
    await expect(page).toHaveURL(/\/settings\?tab=accounts$/);
    await expect(page.getByTestId("settings-navigation")).toBeVisible();
  });
}

test("Portuguese page chrome stays readable across compact portrait widths", async ({
  page,
  request,
}, testInfo) => {
  const seed = `pt-portrait-${Date.now().toString(36)}-${testInfo.workerIndex}`;
  await createAuthenticatedWorkspace(page, request, seed);
  await page.context().addCookies([
    {
      name: "PARAGLIDE_LOCALE",
      value: "pt",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
    },
  ]);

  for (const scenario of portuguesePortraitRoutes) {
    await page.setViewportSize(scenario.viewport);

    for (const route of scenario.routes) {
      await test.step(`${scenario.viewport.width}px ${route.path}`, async () => {
        await page.goto(route.path);
        await expectConsistentPageFrame(page);

        if ("heading" in route) {
          await expect(
            page.getByRole("heading", { level: 1, name: route.heading }),
          ).toBeVisible();
        } else {
          await expect(page.getByText(route.supportingHeading)).toBeVisible();
        }
        await expect(
          page.getByRole(route.actionRole, { name: route.action }).first(),
        ).toBeVisible();
      });
    }

    await test.step(`${scenario.viewport.width}px settings`, async () => {
      await page.goto("/settings");
      await expectConsistentPageFrame(page);

      const settingsSelector = page.locator(
        'aside button[aria-label="Definições"]',
      );
      await expect(settingsSelector).toBeVisible();
      await settingsSelector.click();
      await page.getByRole("option", { name: "Horário de publicação" }).click();

      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Horário de publicação",
        }),
      ).toBeVisible();
      const scheduleSection = page.locator("#posting-schedule");
      await scheduleSection.locator("#new-time").scrollIntoViewIfNeeded();
      await expect(
        scheduleSection.getByRole("button", { name: "Adicionar hora" }),
      ).toBeVisible();
      await expectNoDocumentOverflow(page);
    });
  }
});

test("media card actions use a context menu on a portrait screen", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seed = `media-${Date.now().toString(36)}-${testInfo.workerIndex}`;
  await createAuthenticatedWorkspace(page, request, seed);
  await page.goto("/media");
  await expectConsistentPageFrame(page);

  const filename = `touch-actions-${seed}.png`;
  await page.getByRole("button", { name: "Add media" }).first().click();
  const uploadDialog = page.getByRole("dialog", { name: "Upload media" });
  await uploadDialog.locator('input[type="file"]').first().setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: Buffer.concat([tinyPNG, Buffer.from(seed)]),
  });
  await uploadDialog
    .getByRole("button", { name: "Upload 1 file", exact: true })
    .click();
  await expect(uploadDialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(filename)).toBeVisible();

  const selectControl = page.getByRole("button", {
    name: `Select ${filename}`,
  });
  const assetCard = page.locator('[data-library-kind="asset"]');
  await assetCard.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Media details" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Download" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(selectControl).toBeVisible();
  await expect(selectControl).toHaveAttribute("aria-pressed", "false");
  await selectControl.click();
  await expect(selectControl).toHaveAttribute("aria-pressed", "true");
  await expectNoDocumentOverflow(page);
});

test("media load failures stay distinct from a genuine empty library and can retry", async ({
  page,
  request,
}, testInfo) => {
  const seed = `media-retry-${Date.now().toString(36)}-${testInfo.workerIndex}`;
  await createAuthenticatedWorkspace(page, request, seed);

  let mediaRequests = 0;
  await page.route("**/api/v1/media?**", async (route) => {
    mediaRequests += 1;
    if (mediaRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Media temporarily unavailable" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/media");
  await expect(page.getByRole("alert")).toContainText(
    "Media temporarily unavailable",
  );
  await expect(page.getByText("No media found")).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No media found")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("invitation acceptance ignores a transient failure and retries in place", async ({
  page,
  request,
}, testInfo) => {
  const seed = `invite-retry-${Date.now().toString(36)}-${testInfo.workerIndex}`;
  const auth = await registerUser(
    request,
    `ui-consistency-${seed}@example.com`,
  );
  const workspace = await createWorkspace(request, auth.token, seed);
  await authenticatePage(page, auth.token);

  let acceptanceRequests = 0;
  await page.route("**/api/v1/workspace-invitations/accept", async (route) => {
    acceptanceRequests += 1;
    if (acceptanceRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Invitation service unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspace_id: workspace.id, role: "member" }),
    });
  });

  await page.goto("/invite?token=retry-token");
  await expect(page.getByRole("alert")).toContainText(
    "Invitation service unavailable",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Invitation accepted" }),
  ).toBeVisible();
  expect(acceptanceRequests).toBe(2);
});

test("core routes use one bounded content-shaped loading state", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seed = `loading-${Date.now().toString(36)}-${testInfo.workerIndex}`;
  await createAuthenticatedWorkspace(page, request, seed);

  const delay = async () =>
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 700));

  await page.route("**/api/v1/publications?**", async (route) => {
    await delay();
    await route.continue();
  });
  await page.goto("/activity");
  await expect(page.getByTestId("page-loading")).toHaveAttribute(
    "data-layout",
    "list",
  );
  await expect(page.getByTestId("page-loading")).toHaveCount(1);
  await expect(page.getByTestId("page-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.unroute("**/api/v1/publications?**");

  await page.route("**/api/v1/media?**", async (route) => {
    await delay();
    await route.continue();
  });
  await page.goto("/media");
  await expect(page.getByTestId("page-loading")).toHaveAttribute(
    "data-layout",
    "gallery",
  );
  await expect(page.getByTestId("page-loading")).toHaveCount(1);
  await expect(page.getByTestId("page-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.unroute("**/api/v1/media?**");

  await page.route("**/api/v1/publications?**", async (route) => {
    await delay();
    await route.continue();
  });
  await page.goto("/calendar");
  await expect(page.getByTestId("page-loading")).toHaveAttribute(
    "data-layout",
    "calendar",
  );
  await expect(page.getByTestId("page-loading")).toHaveCount(1);
  await expect(page.locator("main .animate-spin")).toHaveCount(0);
  await expect(page.getByTestId("page-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
});
