import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expectBalancedDitherButton } from "../helpers/dither-button";

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

test("top navigation keeps the requested section order and active state", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "Documentation sections" });
  await page.goto("/docs/");
  await expect(navigation.getByRole("link")).toHaveText([
    "Guides",
    "Self-hosting",
    "AI assistants",
    "Workflows",
    "Automate",
    "Video Editor",
    "Image Editor",
    "API reference",
  ]);
  await expect(page.locator(".home-paths").getByRole("link")).toHaveText([
    "Install OpenPost on your own server",
    "Connect an AI assistant",
    "Build a workflow",
    "Edit a video",
    "Design an image",
    "Browse the API reference",
  ]);
  for (const [route, section, heading] of [
    ["/", "Guides", "OpenPost documentation"],
    ["/self-hosting", "Self-hosting", "Self-host OpenPost"],
    ["/mcp", "AI assistants", "AI assistants"],
    ["/workflows", "Workflows", "Workflows"],
    ["/automate", "Automate", "Automate"],
    ["/video-editor", "Video Editor", "Video Editor"],
    ["/image-editor", "Image Editor", "Image Editor"],
    ["/api-reference", "API reference", "API reference"],
  ] as const) {
    await page.goto(`/docs${route}`);
    await expect(navigation.getByRole("link", { name: section })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});

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

test("AI client links open the matching setup guide", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/docs/mcp");
  const clients = await page
    .locator('#nd-page a[href^="/docs/mcp/"]')
    .evaluateAll((links) =>
      links
        .map((link) => ({ href: link.getAttribute("href")!, name: link.textContent!.trim() }))
        .filter(
          (link) =>
            !["mcp-guide", "skills", "chat-assistants", "coding-assistants"].includes(
              link.href.split("/").at(-1)!,
            ),
        ),
    );
  expect(clients.length).toBeGreaterThan(0);
  for (const client of clients) {
    await page.goto("/docs/mcp");
    await page.locator(`#nd-page a[href="${client.href}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${client.href}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: `Connect ${client.name}`, exact: true }),
    ).toBeVisible();
    await expect(page.locator("#nd-page")).toContainText("OpenPost");
  }
});

test("mobile anchor links leave the heading below sticky navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/mcp");
  await page
    .locator("#choose-your-client")
    .getByRole("link", { name: "Choose your client" })
    .click();
  await expect(page).toHaveURL(/#choose-your-client$/);
  await expect
    .poll(() =>
      page
        .locator("#choose-your-client")
        .evaluate((heading) => heading.getBoundingClientRect().top),
    )
    .toBeGreaterThanOrEqual(144);
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
  await page.goto("/docs/self-hosting/integrations");
  await expect(page.getByRole("link", { name: "Image credits" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("images from Postiz");
  const directory = page.locator("#nd-page table").first();
  await expect(directory.getByRole("link")).toHaveCount(socialNetworks.length);
  for (const network of socialNetworks) {
    await page.goto("/docs/self-hosting/integrations");
    await directory.locator(`a[href$="/${network}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/integrations/${network}$`));
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

test("export screenshots expand and close with the keyboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/docs/image-editor/export-and-publish");
  const screenshot = page.locator(".setup-screenshot");
  await screenshot.scrollIntoViewIfNeeded();
  const image = screenshot.locator("img:visible").first();
  await expect(image).toHaveAttribute("src", /image-export-detail-dark\.webp/);
  await expect
    .poll(() => image.evaluate((item: HTMLImageElement) => item.naturalWidth))
    .toBeGreaterThan(0);
  const expand = screenshot.getByRole("button", { name: /Expand image/ });
  await expand.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Minimize image" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(expand).toBeFocused();
  await expand.click();
  await dialog.getByRole("button", { name: "Minimize image" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(expand).toBeFocused();
  expect(errors).toEqual([]);
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

test("Automate groups are always-visible sidebar sections", async ({ page }) => {
  await page.goto("/docs/automate/sdk");
  const sidebar = page.locator("#nd-sidebar");
  for (const section of ["TypeScript SDK", "HTTP API", "Command-line interface", "n8n workflows"]) {
    await expect(sidebar.getByRole("link", { name: section, exact: true }).first()).toBeVisible();
    await expect(sidebar.getByRole("button", { name: section, exact: true })).toHaveCount(0);
  }
  await expect(sidebar.getByRole("link", { name: "Build a publishing workflow" })).toBeVisible();
});

const workflowGuides = [
  ["/first-workflow", "Build your first workflow"],
  ["/editor", "Build steps on the canvas"],
  ["/triggers", "Choose a trigger"],
  ["/variables", "Pass step outputs with variables"],
  ["/ai", "Generate text and decide branches with AI"],
  ["/connections", "Call APIs with saved connections"],
  ["/testing", "Test previews, nodes, and live runs"],
  ["/review-and-schedule", "Review and schedule posts"],
  ["/runs", "Inspect and stop runs"],
  ["/examples/feed-digest", "Prepare a weekly feed digest"],
  ["/examples/relevant-releases", "Share only relevant releases"],
  ["/examples/api-to-post", "Turn an API response into a post"],
] as const;

test("workflow guides are reachable from their own section and sidebar", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.goto("/docs/");
  await page
    .getByRole("navigation", { name: "Documentation sections" })
    .getByRole("link", { name: "Workflows", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Workflows", exact: true }),
  ).toBeVisible();
  const sidebar = page.locator("#nd-sidebar");
  const checked = new Set<string>();
  for (const [suffix, heading] of workflowGuides) {
    await sidebar.getByRole("link", { name: heading, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/docs/workflows${suffix}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    const links = await page
      .locator('#nd-page a[href^="/docs/"]')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")!));
    for (const href of links) {
      if (checked.has(href)) continue;
      checked.add(href);
      expect((await request.get(href)).ok(), href).toBe(true);
    }
  }
});

test("Grok Bot instructions fit a phone and copy without visual wrapping", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedText = text;
        },
      },
    });
  });
  await page.goto("/docs/mcp/grok-bot");
  const instructions = page.locator("pre").filter({ hasText: "Purpose" });
  expect(
    await instructions.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  const source = readFileSync(
    new URL("../../apps/docs/content/docs/mcp/grok-bot.mdx", import.meta.url),
    "utf8",
  );
  const expected = source.split("```text\nPurpose\n")[1].split("\n```")[0];
  await instructions
    .locator("xpath=ancestor::figure")
    .getByRole("button", { name: "Copy Text", exact: true })
    .click();
  await expect
    .poll(() => page.locator("html").getAttribute("data-copied-text"))
    .toBe(`Purpose\n${expected}`);
});

for (const [route, property] of [
  ["workflows/create-workflow", "workspace_id"],
  ["publications/create-publication", "Idempotency-Key"],
]) {
  test(`schema ${property} link has a discoverable name and keyboard action`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.copiedPropertyLink = text;
          },
        },
      });
    });
    await page.goto(`/docs/api-reference/${route}`);
    const field = page.getByText(property, { exact: true }).first();
    const button = field.locator("xpath=../..").getByRole("button").last();
    await expect(button).toHaveAccessibleName(`Copy link to ${property}`);
    await button.focus();
    await button.press("Enter");
    await expect
      .poll(async () => {
        const value = await page.locator("html").getAttribute("data-copied-property-link");
        return value ? new URL(value).searchParams.get("s-highlight") : null;
      })
      .toBe(property);
    await expect(button).toBeFocused();
  });
}

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

test("quickstart navigation has readable contrast and named icons", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/docs/guides/quickstart");
  const result = await new AxeBuilder({ page })
    .include("#nd-docs-layout")
    .withRules(["color-contrast", "svg-img-alt"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);
});

test("the primary action shares the dither interaction", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/docs/");
  const button = page.getByRole("link", { name: "Open OpenPost", exact: true });
  const mask = () => button.evaluate((el) => getComputedStyle(el, "::before").maskImage);
  await page.mouse.move(0, 0);
  await expect.poll(mask).toContain("data:image/svg+xml");
  await expectBalancedDitherButton(button);
  const rest = await mask();
  await button.hover();
  expect(await mask()).not.toBe(rest);
  await page.mouse.move(0, 0);
  expect(await mask()).toBe(rest);
  await button.focus();
  expect(await mask()).not.toBe(rest);
  await expectBalancedDitherButton(button);
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
