import { test, expect } from "@playwright/test";

test("page options provide working document and assistant links", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
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
          const link = page.getByRole("link", {
            name: new RegExp(`Open in ${name}$`),
          });
          await expect(link).toBeVisible();
          const href = new URL((await link.getAttribute("href"))!);
          expect(href.origin).toBe(origin);
          expect(href.searchParams.get(parameter)).toContain(
            `${new URL(page.url()).origin}${route}`,
          );
        }
        const document = await page.request.get(route);
        expect(document.ok()).toBe(true);
        expect(await document.text()).toContain(title);
        const markdown = page.getByRole("link", { name: "View as Markdown" });
        const response = await page.request.get((await markdown.getAttribute("href"))!);
        expect(response.ok()).toBe(true);
        expect(new URL(response.url()).pathname).toBe(`${route}.md`);
        expect(await response.text()).toContain(`# ${title}`);
        if (route.includes("quick-cut")) {
          await page.screenshot({
            path: testInfo.outputPath(`options-${width}-${scheme}.png`),
          });
        }
        await page.keyboard.press("Escape");
        await expect(page.getByRole("link", { name: "Open in ChatGPT" })).not.toBeVisible();
        await expect(trigger).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      }
    }
  }
  expect(errors).toEqual([]);
});

for (const width of [320, 390]) {
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
  await page.getByRole("textbox").fill("publication");
  await page.getByRole("button", { name: "All docs", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Guides", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Guides", exact: true }).click();
  await expect(page.getByRole("button", { name: "Guides", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: /Docs Guides/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Docs Automate/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Automate", exact: true }).click();
  await expect(page.getByRole("button", { name: /Docs Automate/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Docs Guides/ })).toHaveCount(0);
  await page.getByRole("button", { name: "API reference", exact: true }).click();
  await expect(page.getByRole("button", { name: /Docs API reference/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Docs Automate/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Close/i }).click();
  await expect(page.getByRole("textbox")).not.toBeVisible();
});

test("moved guides keep their public routes", async ({ request }) => {
  for (const [oldPath, replacement] of [
    ["/guides/video-editor", "/video-editor"],
    ["/guides/image-editor", "/image-editor"],
    ["/guides/quick-cut", "/video-editor/quick-cut-and-recorder"],
    ["/guides/recording", "/video-editor/quick-cut-and-recorder"],
    ["/guides/automation", "/automate"],
    ["/guides/sdk", "/automate/sdk"],
    ["/guides/cli", "/automate/cli"],
    ["/mcp/tools", "/mcp/mcp-guide"],
  ] as const) {
    const response = await request.get(`/docs${oldPath}`);
    expect(response.ok(), oldPath).toBe(true);
    expect(new URL(response.url()).pathname).toBe(`/docs${replacement}`);
  }
});

test("moved Markdown guides keep their agent-readable routes", async ({ request }) => {
  for (const [oldPath, replacement] of [
    ["/guides/sdk.md", "/automate/sdk/index.md"],
    ["/guides/cli.md", "/automate/cli/index.md"],
    ["/automate/sdk.md", "/automate/sdk/index.md"],
    ["/automate/api.md", "/automate/api/index.md"],
    ["/automate/cli.md", "/automate/cli/index.md"],
    ["/automate/n8n.md", "/automate/n8n/index.md"],
  ] as const) {
    const response = await request.get(`/docs${oldPath}`);
    expect(response.ok(), oldPath).toBe(true);
    expect(new URL(response.url()).pathname).toBe(`/docs${replacement}`);
  }
});

test("AI client links open the matching setup heading", async ({ page }) => {
  await page.goto("/docs/mcp");
  const clients = await page
    .locator(
      '#nd-page a[href^="/docs/mcp/chat-assistants#"], #nd-page a[href^="/docs/mcp/coding-assistants#"]',
    )
    .evaluateAll((links) =>
      links.map((link) => ({ href: link.getAttribute("href")!, name: link.textContent!.trim() })),
    );
  expect(clients.length).toBeGreaterThan(0);
  for (const client of clients) {
    await page.goto("/docs/mcp");
    await page.locator(`#nd-page a[href="${client.href}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${client.href}$`));
    const anchor = new URL(client.href, "https://openpo.st").hash;
    await expect(page.locator(anchor)).toBeVisible();
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
    const icon = page.locator(".docs-title-icon img");
    await expect
      .poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  }
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1440]) {
    test(`export screenshots expand with the keyboard in ${scheme} at ${width}px`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({
        colorScheme: scheme,
        reducedMotion: width === 1440 ? "no-preference" : "reduce",
      });
      await page.goto("/docs/image-editor/export-and-publish");
      const screenshot = page.locator(".setup-screenshot");
      await screenshot.scrollIntoViewIfNeeded();
      const image = screenshot.locator("img:visible").first();
      await expect(image).toHaveAttribute(
        "src",
        new RegExp(`image-export-detail-${scheme}\\.webp`),
      );
      const expand = screenshot.getByRole("button", { name: /Expand image/ });
      await expect(expand).toBeVisible();
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(errors).toEqual([]);
    });
  }
}

test("older provider URLs resolve to the individual guides", async ({ request }) => {
  for (const network of socialNetworks) {
    const response = await request.get(`/docs/providers/${network}`);
    expect(response.ok()).toBe(true);
    expect(new URL(response.url()).pathname).toBe(`/docs/self-hosting/integrations/${network}`);
  }
  for (const group of ["meta-platforms", "bluesky-mastodon", "discord-telegram"]) {
    const response = await request.get(`/docs/self-hosting/integrations/${group}`);
    expect(response.ok()).toBe(true);
    expect(new URL(response.url()).pathname).toBe("/docs/self-hosting/integrations");
  }
});

test("older workspace URL reaches the current guide", async ({ request }) => {
  const response = await request.get("/docs/usage/workspaces");
  expect(response.ok()).toBe(true);
  expect(new URL(response.url()).pathname).toBe("/docs/guides/workspaces");
});

test("retired self-hosting guide URL opens the current guide without a hydration error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/self-hosting/integrations/instagram");
  await expect(page).toHaveURL(/\/docs\/self-hosting\/integrations\/instagram$/);
  await expect(page.getByRole("heading", { name: "Instagram", level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
