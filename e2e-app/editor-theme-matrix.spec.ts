import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const SCREENSHOT_DIRECTORY = "/tmp/openpost-editor-theme-matrix";
const captureScreenshots = process.env.OPENPOST_EDITOR_THEME_SCREENSHOTS === "1";

const themeSchemes = [
  { id: "workshop", scheme: "light" },
  { id: "workshop", scheme: "dark" },
  { id: "studio", scheme: "light" },
  { id: "notebook", scheme: "light" },
  { id: "playroom", scheme: "light" },
  { id: "cloud-garden", scheme: "light" },
  { id: "study-hall", scheme: "light" },
  { id: "corkboard", scheme: "light" },
  { id: "midnight", scheme: "dark" },
  { id: "ferrari", scheme: "dark" },
  { id: "apple", scheme: "light" },
  { id: "todoist", scheme: "light" },
  { id: "notion", scheme: "light" },
  { id: "supabase", scheme: "dark" },
  { id: "vercel", scheme: "light" },
  { id: "firecrawl", scheme: "light" },
  { id: "linear", scheme: "dark" },
  { id: "calcom", scheme: "light" },
  { id: "mintlify", scheme: "light" },
  { id: "launchdarkly", scheme: "dark" },
  { id: "posthog", scheme: "light" },
  { id: "origin", scheme: "dark" },
  { id: "column", scheme: "light" },
  { id: "duolingo", scheme: "light" },
  { id: "quizlet", scheme: "light" },
] as const;

const narrowThemeIDs = new Set([
  "workshop",
  "ferrari",
  "apple",
  "supabase",
  "firecrawl",
  "quizlet",
]);

test.beforeAll(async () => {
  if (!captureScreenshots) return;
  const { mkdir, rm } = await import("node:fs/promises");
  await rm(SCREENSHOT_DIRECTORY, { force: true, recursive: true });
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true });
});

async function installLocalWorkspacePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        if (!("queryPermission" in prototype)) {
          Object.defineProperty(prototype, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (!("requestPermission" in prototype)) {
          Object.defineProperty(prototype, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
}

async function createVideoProject(page: Page): Promise<string> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Theme matrix");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await page
    .getByRole("complementary", { name: "Assets" })
    .getByRole("button", { name: "Add layer" })
    .click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  return page.url();
}

async function createImageDesign(page: Page): Promise<string> {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
    timeout: 20_000,
  });
  return page.url();
}

async function assignTheme(
  request: APIRequestContext,
  token: string,
  workspaceID: string,
  themeID: string,
): Promise<void> {
  const response = await request.put(`/api/v1/theme-assignments/${workspaceID}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { reference: { kind: "built_in", id: themeID, version: 1 } },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function expectEditorBoundary(page: Page, editor: "image" | "video"): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth,
      ),
    )
    .toBe(true);

  const boundary = await page.evaluate((kind) => {
    const root = document.querySelector<HTMLElement>(`.${kind}-editor-theme`);
    const protectedSurface = document.querySelector<HTMLElement>("[data-editor-protected]");
    if (!root || !protectedSurface) return null;
    const rootStyle = getComputedStyle(root);
    const protectedStyle = getComputedStyle(protectedSurface);
    return {
      rootBackground: rootStyle.backgroundColor,
      rootForeground: rootStyle.color,
      protectedBackground: protectedStyle.backgroundColor,
      protectedRole: protectedSurface.dataset.editorProtected,
    };
  }, editor);

  expect(boundary).toEqual(
    expect.objectContaining({
      rootBackground: expect.stringMatching(/^(?:rgba?|oklch)\(/),
      rootForeground: expect.stringMatching(/^(?:rgba?|oklch)\(/),
      protectedBackground: expect.stringMatching(/^(?:rgba?|oklch)\(/),
      protectedRole: expect.any(String),
    }),
  );
}

async function openEditor(
  page: Page,
  url: string,
  editor: "image" | "video",
  theme: (typeof themeSchemes)[number],
  width: number,
): Promise<void> {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: theme.scheme });
  await page.goto(url);
  if (editor === "video") {
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
    await expect(page.locator("[data-editor-protected]").first()).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible({
      timeout: 20_000,
    });
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme-id", theme.id);
  await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", theme.scheme);
  await expectEditorBoundary(page, editor);

  if (captureScreenshots && (width !== 320 || narrowThemeIDs.has(theme.id))) {
    await page.screenshot({
      path: `${SCREENSHOT_DIRECTORY}/${editor}-${width}-${theme.id}-${theme.scheme}.png`,
      animations: "disabled",
    });
  }
}

test("both editors honor every built-in theme while preserving protected output geometry", async ({
  page,
  request,
}) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401 (Unauthorized)")) {
      errors.push(message.text().slice(0, 300));
    }
  });

  const { token } = await registerUser(request, "editor-theme-matrix@example.com");
  const workspace = await createWorkspace(request, token, "Editor theme matrix");
  await authenticatePage(page, token);
  const videoURL = await createVideoProject(page);
  const imageURL = await createImageDesign(page);

  for (const theme of themeSchemes) {
    await assignTheme(request, token, workspace.id, theme.id);
    for (const width of [1440, 390] as const) {
      await openEditor(page, videoURL, "video", theme, width);
      await openEditor(page, imageURL, "image", theme, width);
    }
    if (narrowThemeIDs.has(theme.id)) {
      await openEditor(page, videoURL, "video", theme, 320);
      await openEditor(page, imageURL, "image", theme, 320);
    }
  }

  expect(errors, errors.join(" | ")).toEqual([]);
});
