import { test, expect } from "@playwright/test";

test("page options provide working document and assistant links", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [route, title] of [
    ["/docs/mcp/coding-assistants", "Coding assistants"],
    ["/docs/video-editor/quick-cut-and-recorder", "Quick Cut and Recorder"],
  ]) {
    await page.goto(route);
    const trigger = page.getByRole("button", { name: "Open page options" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    for (const [name, origin, parameter] of [
      ["Scira AI", "https://scira.ai", "q"],
      ["ChatGPT", "https://chatgpt.com", "prompt"],
      ["Claude", "https://claude.ai", "q"],
      ["Cursor", "https://cursor.com", "text"],
    ]) {
      const link = page.getByRole("link", { name: new RegExp(`Open in ${name}$`) });
      await expect(link).toBeVisible();
      const href = new URL((await link.getAttribute("href"))!);
      expect(href.origin).toBe(origin);
      expect(href.searchParams.get(parameter)).toContain(`${new URL(page.url()).origin}${route}`);
    }
    const document = await page.request.get(route);
    expect(document.ok()).toBe(true);
    expect(await document.text()).toContain(title);
    const markdown = page.getByRole("link", { name: "View as Markdown" });
    const response = await page.request.get((await markdown.getAttribute("href"))!);
    expect(response.ok()).toBe(true);
    expect(new URL(response.url()).pathname).toBe(`${route}.md`);
    expect(await response.text()).toContain(`# ${title}`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Open in ChatGPT" })).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  expect(errors).toEqual([]);
});

for (const width of [320]) {
  test(`mobile navigation stays accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/docs/api-reference");
    const navigation = page.getByRole("navigation", { name: "Documentation sections" });
    const active = navigation.getByRole("link", { name: "API reference" });
    await expect
      .poll(async () => active.evaluate((element) => element.getBoundingClientRect().right))
      .toBeLessThanOrEqual(width);
    const header = await page.locator("#nd-subnav").boundingBox();
    const tabs = await navigation.boundingBox();
    expect(header!.y + header!.height).toBeLessThanOrEqual(tabs!.y);
    expect(await navigation.evaluate((element) => getComputedStyle(element).scrollbarWidth)).toBe(
      "none",
    );
    await active.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(navigation.getByRole("link", { name: "Image Editor" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test("search filters keep guides, automation, and API reference separate", async ({ page }) => {
  await page.goto("/docs/");
  await page.getByRole("button", { name: /Search documentation/ }).click();
  await expect(page.locator(".docs-search-filters").getByRole("button")).toHaveText([
    "All docs",
    "Guides",
    "Self-hosting",
    "AI assistants",
    "Workflows",
    "Automate",
    "Video Editor",
    "Image Editor",
    "API reference",
  ]);
  await page.getByRole("combobox", { name: "Search" }).fill("publication");
  await page.getByRole("button", { name: "All docs", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Guides", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Guides", exact: true }).click();
  await expect(page.getByRole("button", { name: "Guides", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("option", { name: /^Docs Guides/ }).first()).toBeVisible();
  await expect(page.getByRole("option", { name: /^Docs Automate/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Automate", exact: true }).click();
  await expect(page.getByRole("option", { name: /^Docs Automate/ }).first()).toBeVisible();
  await expect(page.getByRole("option", { name: /^Docs Guides/ })).toHaveCount(0);
  await page.getByRole("button", { name: "API reference", exact: true }).click();
  await expect(page.getByRole("option", { name: /^Docs API reference/ }).first()).toBeVisible();
  await expect(page.getByRole("option", { name: /^Docs Automate/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Close/i }).click();
  await expect(page.getByRole("combobox", { name: "Search" })).not.toBeVisible();
});

const socialNetworks = [
  "bluesky",
  "mastodon",
  "pixelfed",
  "peertube",
  "lemmy",
  "piefed",
  "discord",
  "telegram",
  "linkedin",
  "x",
  "facebook",
  "instagram",
  "threads",
  "youtube",
  "tiktok",
  "pinterest",
];

test("social integration directory opens each network setup guide", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/docs/self-hosting/integrations");
  await expect(page.getByRole("link", { name: "Image credits" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("images from Postiz");
  const directory = page.locator("#nd-page table").first();
  await expect(directory.getByRole("link")).toHaveCount(socialNetworks.length);
  for (const network of socialNetworks) {
    await expect(directory.locator(`a[href$="/${network}"]`)).toHaveCount(1);
  }
  await directory.locator(`a[href$="/${socialNetworks[0]}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/integrations/${socialNetworks[0]}$`));
  for (const network of socialNetworks) {
    if (network !== socialNetworks[0]) {
      await page.goto(`/docs/self-hosting/integrations/${network}`);
    }
    // Brand marks are images or inline SVG; either must actually render.
    const icon = page.locator(".docs-title-icon").locator("img, svg").first();
    await expect(icon, network).toBeVisible();
    await expect
      .poll(() =>
        icon.evaluate((mark) =>
          mark instanceof HTMLImageElement ? mark.naturalWidth : mark.getBoundingClientRect().width,
        ),
      )
      .toBeGreaterThan(0);
  }
});

// Every guide in the reader-facing sections renders its heading.
const sectionGuides = [
  ["/mcp", "AI assistants"],
  ["/mcp/chat-assistants", "Chat assistants"],
  ["/mcp/coding-assistants", "Coding assistants"],
  ["/mcp/mcp-guide", "Connect with MCP"],
  ["/mcp/grok-bot", "Create a Grok Bot for OpenPost"],
  ["/mcp/mcp-guide/media", "Upload media"],
  ["/mcp/mcp-guide/use-cases", "Tasks and troubleshooting"],
  ["/mcp/skills", "Install and use the OpenPost skill"],
  ["/automate", "Automate"],
  ["/automate/sdk", "TypeScript SDK"],
  ["/automate/sdk/publications", "Create and publish posts with the SDK"],
  ["/automate/sdk/reliability", "Handle SDK jobs, conflicts, and errors"],
  ["/automate/api", "HTTP API"],
  ["/automate/api/publications", "Create and publish posts over HTTP"],
  ["/automate/api/media", "Media uploads"],
  ["/automate/api/reliability", "Handle API revisions, retries, and jobs"],
  ["/automate/cli", "Command-line interface"],
  ["/automate/cli/publishing", "Create and publish content"],
  ["/automate/cli/scripts-and-ci", "Scripts and CI"],
  ["/automate/cli/inspect-and-recover", "Inspect and recover"],
  ["/automate/n8n", "n8n workflows"],
  ["/automate/n8n/build-a-workflow", "Build a publishing workflow"],
  ["/automate/n8n/reliability", "Handle n8n retries and failures"],
  ["/image-editor", "Image Editor"],
  ["/image-editor/create-a-design", "Create a design"],
  ["/image-editor/layers", "Layers"],
  ["/image-editor/pages-and-carousels", "Pages and carousels"],
  ["/image-editor/color-and-effects", "Color and effects"],
  ["/image-editor/templates-and-brand", "Templates and brand items"],
  ["/image-editor/export-and-publish", "Export and publish"],
  ["/image-editor/saving-and-recovery", "Saving and recovery"],
  ["/video-editor", "Video Editor"],
  ["/video-editor/start", "Start a project"],
  ["/video-editor/timeline", "Edit on the timeline"],
  ["/video-editor/color-motion-and-effects", "Color, motion, and effects"],
  ["/video-editor/transcript-and-audio", "Transcript, captions, and audio"],
  ["/video-editor/export-and-publish", "Export and publish"],
  ["/video-editor/quick-cut-and-recorder", "Quick Cut and Recorder"],
  ["/video-editor/browser-and-recovery", "Browser support and recovery"],
] as const;

test("every section guide renders without page errors", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [route, heading] of sectionGuides) {
    await page.goto(`/docs${route}`);
    await expect(page.getByRole("heading", { level: 1, name: heading }), route).toBeVisible();
    await expect(page.locator("#nd-page")).not.toContainText("Page not found");
  }
  expect(errors).toEqual([]);
});

test("section overview and guide links resolve", async ({ page, request }) => {
  test.setTimeout(90_000);
  const checked = new Set<string>();
  const resolve = async (from: string, selector: string) => {
    await page.goto(`/docs${from}`);
    const links = await page
      .locator(selector)
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")!));
    for (const href of links) {
      if (checked.has(href)) continue;
      checked.add(href);
      expect((await request.get(href)).ok(), `${from} -> ${href}`).toBe(true);
    }
  };
  await resolve("/image-editor", 'main a[href^="/docs/image-editor/"]');
  await resolve("/video-editor", 'main a[href^="/docs/video-editor/"]');
  for (const [route] of sectionGuides.filter(([route]) => route.startsWith("/automate"))) {
    await resolve(route, 'main a[href^="/docs/automate/"], main a[href^="/docs/api-reference"]');
  }
  await page.goto("/docs/mcp");
  for (const href of [
    "/mcp/chatgpt",
    "/mcp/codex",
    "/mcp/mcp-guide",
    "/mcp/skills",
    "/automate/cli",
    "/automate/sdk",
    "/automate/api",
  ]) {
    await expect(page.locator(`main a[href="/docs${href}"]`).first()).toBeVisible();
    expect((await request.get(`/docs${href}`)).ok(), href).toBe(true);
  }
});

test("mobile sidebar closes with Escape and restores its trigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/docs/guides/quickstart");
  const trigger = page.locator("#nd-subnav").getByRole("button", {
    name: "Open Sidebar",
    exact: true,
  });
  await trigger.focus();
  await trigger.press("Enter");
  const sidebar = page.locator("#nd-sidebar-mobile");
  await expect(sidebar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await sidebar.getByRole("link").first().focus();
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

// One phone-width sweep across representative pages replaces per-section
// width and scheme matrices.
for (const scheme of ["light", "dark"] as const) {
  test(`reader pages fit 320px in ${scheme}`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const route of [
      "/",
      "/guides/quickstart",
      "/self-hosting",
      "/mcp",
      "/mcp/mcp-guide",
      "/automate/sdk/publications",
      "/automate/api/media",
      "/automate/n8n/build-a-workflow",
      "/image-editor/export-and-publish",
      "/video-editor/timeline",
      "/workflows",
      "/workflows/editor",
      "/api-reference",
    ]) {
      await page.goto(`/docs${route}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        route,
      ).toBeLessThanOrEqual(320);
    }
    expect(errors).toEqual([]);
  });
}
