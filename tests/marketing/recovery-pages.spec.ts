import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test(`static recovery stays illustrated and usable without JavaScript at 320 ${colorScheme}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      colorScheme,
      viewport: { width: 320, height: 800 },
    });
    const page = await context.newPage();
    await page.goto("/404.html");
    await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
    const illustration = page.locator(".op-recovery-art img");
    await expect(illustration).toBeVisible();
    expect(
      await illustration.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    ).toBe(true);
    const home = page.getByRole("link", { name: "Back home", exact: true });
    await expect(home).toHaveAttribute("href", "/");
    await home.focus();
    await expect(home).toBeFocused();
    const presentation = await home.evaluate((link) => {
      const style = getComputedStyle(link);
      const texture = getComputedStyle(link, "::before");
      return {
        height: link.getBoundingClientRect().height,
        texture: texture.maskImage,
        content: texture.content,
        ink: style.color,
        background: style.backgroundColor,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(presentation.height).toBeGreaterThanOrEqual(44);
    expect(presentation.texture).not.toBe("none");
    expect(presentation.content).not.toBe("none");
    expect(presentation.ink).not.toBe(presentation.background);
    expect(presentation.overflow).toBe(false);
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await context.close();
  });
}

test("unknown nested URLs keep their 404 status and load recovery assets from the root", async ({
  page,
}) => {
  const response = await page.goto("/missing-section/missing-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
  await expect(page.locator(".op-recovery-art img")).toBeVisible();
  expect(
    await page
      .locator(".op-recovery-art img")
      .evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
  ).toBe(true);
});

test("static recovery changes Bayer coverage on focus and press without changing its colors", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto("/404.html");
  const home = page.getByRole("link", { name: "Back home", exact: true });
  const paint = () =>
    home.evaluate((link) => ({
      mask: getComputedStyle(link, "::before").maskImage,
      color: getComputedStyle(link).color,
      background: getComputedStyle(link).backgroundColor,
    }));
  const rest = await paint();
  await home.hover();
  const hover = await paint();
  expect(hover.mask).not.toBe(rest.mask);
  expect(hover.color).toBe(rest.color);
  expect(hover.background).toBe(rest.background);
  await page.mouse.move(0, 0);
  await home.focus();
  const focus = await paint();
  expect(focus.mask).toBe(hover.mask);
  await home.hover();
  await page.mouse.down();
  const pressed = await paint();
  expect(pressed.mask).not.toBe(hover.mask);
  expect(pressed.background).toBe(rest.background);
  await page.mouse.up();
  await context.close();
});
