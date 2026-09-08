import { test, expect } from "@playwright/test";

test("page options provide working document and assistant links", async ({ page }) => {
  await page.goto("/mcp/cursor");
  const trigger = page.getByRole("button", { name: "Open page options" });
  await trigger.click();
  const chatGPT = page.getByRole("link", { name: "Open in ChatGPT" });
  const href = new URL((await chatGPT.getAttribute("href"))!);
  expect(href.origin).toBe("https://chatgpt.com");
  expect(href.searchParams.get("prompt")).toContain("/mcp/cursor");
  await expect(page.getByRole("link", { name: "Open in Claude" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Cursor" })).toBeVisible();
  const markdown = page.getByRole("link", { name: "View as Markdown" });
  const response = await page.request.get((await markdown.getAttribute("href"))!);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("# Connect Cursor");
  await page.keyboard.press("Escape");
  await expect(chatGPT).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

for (const width of [320, 390]) {
  test(`mobile navigation stays accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/api-reference");
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
    await expect(navigation.getByRole("link", { name: "AI assistants" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test("search filters keep guide and API results separate", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Search documentation/ }).click();
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
  await expect(page.getByRole("button", { name: /Docs API reference/ })).toHaveCount(0);
  await page.getByRole("button", { name: "API reference", exact: true }).click();
  await expect(page.getByRole("button", { name: /Docs API reference/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Docs Guides/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Close/i }).click();
  await expect(page.getByRole("textbox")).not.toBeVisible();
});

test("AI client picker opens every guide and renders its logo", async ({ page }) => {
  await page.goto("/mcp");
  const picker = page.locator(".mcp-clients");
  await expect(picker.getByRole("link")).toHaveCount(16);
  const clients = await picker
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => ({ href: link.getAttribute("href")!, name: link.textContent!.trim() })),
    );
  for (const client of clients) {
    await page.goto("/mcp");
    const link = picker.getByRole("link", { name: client.name, exact: true });
    await expect
      .poll(() => link.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${client.href}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Connect");
    await expect(page.locator("#nd-page")).toContainText("OpenPost");
  }
});

test("mobile anchor links leave the heading below sticky navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mcp");
  await page.locator("#choose-a-setup").getByRole("link", { name: "Choose a setup" }).click();
  await expect(page).toHaveURL(/#choose-a-setup$/);
  await expect
    .poll(() =>
      page.locator("#choose-a-setup").evaluate((heading) => heading.getBoundingClientRect().top),
    )
    .toBeGreaterThanOrEqual(144);
});
