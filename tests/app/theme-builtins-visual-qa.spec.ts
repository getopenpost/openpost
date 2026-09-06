import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const SHOT = "/tmp/theme-builtins-visual-qa";
const mobileScreenshotThemeIDs = new Set([
  "workshop",
  "ferrari",
  "apple",
  "supabase",
  "firecrawl",
  "quizlet",
]);

const builtInThemes = [
  { id: "workshop", name: "Workshop", scheme: "light" },
  { id: "studio", name: "Studio", scheme: "light" },
  { id: "studio", name: "Studio", scheme: "dark" },
  { id: "notebook", name: "Notebook", scheme: "light" },
  { id: "playroom", name: "Playroom", scheme: "light" },
  { id: "playroom", name: "Playroom", scheme: "dark" },
  { id: "cloud-garden", name: "Cloud Garden", scheme: "light" },
  { id: "cloud-garden", name: "Cloud Garden", scheme: "dark" },
  { id: "study-hall", name: "Study Hall", scheme: "light" },
  { id: "corkboard", name: "Corkboard", scheme: "light" },
  { id: "midnight", name: "Midnight", scheme: "dark" },
  { id: "ferrari", name: "Ferrari", scheme: "dark" },
  { id: "apple", name: "Apple", scheme: "light" },
  { id: "todoist", name: "Todoist", scheme: "light" },
  { id: "notion", name: "Notion", scheme: "light" },
  { id: "supabase", name: "Supabase", scheme: "dark" },
  { id: "vercel", name: "Vercel", scheme: "light" },
  { id: "firecrawl", name: "Firecrawl", scheme: "light" },
  { id: "linear", name: "Linear", scheme: "dark" },
  { id: "calcom", name: "Cal.com", scheme: "light" },
  { id: "mintlify", name: "Mintlify", scheme: "light" },
  { id: "launchdarkly", name: "LaunchDarkly", scheme: "dark" },
  { id: "posthog", name: "PostHog", scheme: "light" },
  { id: "origin", name: "Origin", scheme: "dark" },
  { id: "column", name: "Column", scheme: "light" },
  { id: "duolingo", name: "Duolingo", scheme: "light" },
  { id: "quizlet", name: "Quizlet", scheme: "light" },
] as const;

test.beforeAll(async () => {
  const { mkdir, rm } = await import("node:fs/promises");
  await rm(SHOT, { force: true, recursive: true });
  await mkdir(SHOT, { recursive: true });
});

async function loginAsFreshUser(request: APIRequestContext, page: Page) {
  const { token } = await registerUser(request, "theme-builtins-visual-qa@example.com");
  await createWorkspace(request, token, "Theme built-ins visual QA");
  await authenticatePage(page, token);
}

async function previewTheme(page: Page, theme: (typeof builtInThemes)[number], width: number) {
  await page.emulateMedia({ colorScheme: theme.scheme });

  const gallery = page.getByRole("group", { name: "Built-in themes" });
  const card = gallery.getByRole("button").filter({ hasText: theme.name }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();

  const preview = page.getByTestId("theme-preview");
  await expect(preview).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(() =>
      preview.evaluate((frame) =>
        frame.contentDocument?.documentElement.getAttribute("data-theme-id"),
      ),
    )
    .toBe(theme.id);

  const state = await preview.evaluate((frame) => {
    const documentElement = frame.contentDocument?.documentElement;
    const body = frame.contentDocument?.body;
    return {
      id: documentElement?.getAttribute("data-theme-id"),
      scheme: documentElement?.getAttribute("data-theme-scheme"),
      source: documentElement?.getAttribute("data-theme-source"),
      mobileNavigationVisible: (() => {
        const navigation = body?.querySelector<HTMLElement>("[data-slot='mobile-bottom-nav']");
        if (!navigation || !documentElement) return false;
        const bounds = navigation.getBoundingClientRect();
        return (
          getComputedStyle(navigation).display !== "none" &&
          bounds.bottom <= documentElement.clientHeight
        );
      })(),
      mobileNavigationDebug: (() => {
        const navigation = body?.querySelector<HTMLElement>("[data-slot='mobile-bottom-nav']");
        const scene = body?.querySelector<HTMLElement>("[data-preview-scene]");
        if (!navigation || !documentElement) return null;
        return {
          bottom: navigation.getBoundingClientRect().bottom,
          display: getComputedStyle(navigation).display,
          sceneHeight: scene?.getBoundingClientRect().height,
          viewportHeight: documentElement.clientHeight,
        };
      })(),
      sidebarVisible: (() => {
        const sidebar = body?.querySelector<HTMLElement>("[data-slot='sidebar']");
        return sidebar ? getComputedStyle(sidebar).display !== "none" : false;
      })(),
      buttonIsPill: (() => {
        const button = body?.querySelector<HTMLElement>("[data-slot='button']");
        if (!button) return false;
        return Number.parseFloat(getComputedStyle(button).borderRadius) >= button.offsetHeight / 2;
      })(),
      chartSeriesCount: new Set(
        Array.from(body?.querySelectorAll<HTMLElement>("[data-preview-chart-series]") ?? []).map(
          (series) => getComputedStyle(series).backgroundColor,
        ),
      ).size,
      overflow:
        documentElement && body
          ? Math.max(documentElement.scrollWidth, body.scrollWidth) > documentElement.clientWidth
          : true,
    };
  });

  expect(state).toEqual(
    expect.objectContaining({
      id: theme.id,
      scheme: theme.scheme,
      source: "builtin",
      sidebarVisible: width >= 544,
      chartSeriesCount: 5,
      overflow: false,
    }),
  );
  expect(state.mobileNavigationVisible, JSON.stringify(state.mobileNavigationDebug)).toBe(
    width < 544,
  );
  if (["apple", "calcom", "firecrawl", "quizlet", "supabase"].includes(theme.id)) {
    expect(state.buttonIsPill, `${theme.name} action uses its pill recipe`).toBe(true);
  }

  if (width === 1600 || mobileScreenshotThemeIDs.has(theme.id)) {
    await preview.screenshot({
      path: `${SHOT}/${width}-${theme.id}-${theme.scheme}.png`,
    });
  }
}

test("every built-in renders its supported scheme without overflow", async ({ page, request }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

  await loginAsFreshUser(request, page);
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("heading", { name: "Appearance" }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  for (const width of [1600, 1280, 390, 320] as const) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of builtInThemes) await previewTheme(page, theme, width);
  }

  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("a published organization theme remains visible and assignable after all built-ins", async ({
  page,
  request,
}) => {
  const { token } = await registerUser(request, "theme-organization-catalog-qa@example.com");
  const workspace = (await createWorkspace(request, token, "Theme organization catalog QA")) as {
    id: string;
    organization_id: string;
  };
  const headers = { Authorization: `Bearer ${token}` };
  const name = "Catalog pagination proof";
  const create = await request.post("/api/v1/themes", {
    headers,
    data: {
      organization_id: workspace.organization_id,
      name,
      duplicate_built_in_id: "apple",
    },
  });
  if (!create.ok()) throw new Error(`theme creation failed: ${await create.text()}`);
  const created = (await create.json()) as {
    summary: { reference: { id: string } };
  };
  const themeID = created.summary.reference.id;
  const publish = await request.post(`/api/v1/themes/${themeID}/publish`, {
    headers,
    data: {
      organization_id: workspace.organization_id,
      expected_draft_revision: 1,
      expected_published_revision: 0,
    },
  });
  if (!publish.ok()) throw new Error(`theme publish failed: ${await publish.text()}`);

  await authenticatePage(page, token);
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("heading", { name: "Appearance" }).first()).toBeVisible({
    timeout: 20_000,
  });
  const themeRow = page.getByText(name, { exact: true }).locator("../../..");
  await expect(themeRow).toBeVisible();
  await themeRow.getByRole("button", { name: `Test ${name}` }).click();
  const preview = page.getByTestId("theme-preview");
  await expect
    .poll(() =>
      preview.evaluate((frame) =>
        frame.contentDocument?.documentElement.getAttribute("data-theme-id"),
      ),
    )
    .toBe(themeID);
  await themeRow.getByRole("button", { name: `Apply ${name}` }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme-id")))
    .toBe(themeID);
});
