import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";
import { themeColorContrastRatio } from "../../apps/web/src/lib/themes/validation";

// Keep the visual sweep on network assets. PWA lifecycle has its own browser suite.
test.use({ serviceWorkers: "block" });

test("Dither keeps the app's main routes usable on desktop and phones", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { token } = await registerUser(request, `dither-polish-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, token, "Dither studio");
  await createPublication(request, token, workspace.id, "A small release with clearer controls.");
  await authenticatePage(page, token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const surfaces = [
    ["/", "composer"],
    ["/publications?tab=drafts", "publications"],
    ["/calendar", "calendar"],
    ["/inbox/engagement", "inbox"],
    ["/inbox/messages", "messages"],
    ["/inbox/notifications", "notifications"],
    ["/media", "media"],
    ["/grow", "grow"],
    ["/prompts", "prompts"],
    ["/settings?tab=accounts", "accounts"],
    ["/settings?tab=general", "workspace"],
    ["/settings?tab=profile", "profile"],
    ["/settings?tab=appearance", "appearance"],
    ["/editors", "editors"],
    ["/image-editor", "image-editor"],
    ["/video-editor", "video-editor"],
    ["/quick-cut", "quick-cut"],
    ["/record", "record"],
  ];
  for (const [width, scheme] of [
    [1440, "light"],
    [390, "dark"],
    [320, "light"],
  ] as const) {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const [path, name] of surfaces) {
      await page.goto(path);
      await expect
        .poll(
          async () => ({
            theme: await page.locator("html").getAttribute("data-theme-id"),
            errors,
          }),
          { message: `${name} at ${width}px starts with Dither` },
        )
        .toEqual({ theme: "dither", errors: [] });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(
        path === "/record"
          ? page.getByRole("button", { name: "Start recording", exact: true })
          : page.getByRole("heading").first(),
      ).toBeVisible();
      if (path === "/" && width === 1440) {
        const newPost = page.getByTestId("sidebar-new-post");
        const newPostMenu = page.getByTestId("sidebar-new-post-menu");
        await expect
          .poll(async () => {
            const [main, menu] = await Promise.all([
              newPost.boundingBox(),
              newPostMenu.boundingBox(),
            ]);
            return Boolean(
              main &&
              menu &&
              main.height > 0 &&
              Math.round(main.height) === Math.round(menu.height),
            );
          })
          .toBe(true);
      }
      await page.evaluate(() => document.fonts.ready);
      if (path === "/quick-cut") {
        await expect(
          page.getByText("No projects yet. Create one to start cutting.", { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
      }
      if (path === "/record") {
        const colors = await page
          .getByRole("region", { name: "Your preview will appear here after recording starts." })
          .evaluate((el) => {
            const text = el.querySelector("p");
            if (!text) throw new Error("Recorder preview text is unavailable");
            return {
              background: getComputedStyle(el).backgroundColor,
              text: getComputedStyle(text).color,
            };
          });
        expect
          .soft(themeColorContrastRatio(colors.text, colors.background), "Recorder preview text")
          .toBeGreaterThanOrEqual(4.5);
      }
      expect
        .soft(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${name} at ${width}px`,
        )
        .toBe(true);
      await page.screenshot({
        path: `.impeccable/review/dither-polish/${name}-${width}-${scheme}.png`,
      });
    }
  }
  expect(errors).toEqual([]);
});

test.describe("touch theme controls", () => {
  test.use({ hasTouch: true });
  test("custom Dither colors survive undo, publish, assignment, and reload", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { token } = await registerUser(request, `dither-accent-${Date.now()}@example.com`);
    const workspace = await createWorkspace(request, token, "Custom Dither");
    const created = await request.post("/api/v1/themes", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        organization_id: workspace.organization_id,
        name: "Dither violet",
        duplicate_built_in_id: "dither",
      },
    });
    expect(created.ok()).toBe(true);
    await authenticatePage(page, token);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings?tab=appearance");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const hue = page.getByRole("spinbutton", { name: "Accent hue", exact: true });
    await expect(hue).toHaveValue("45");
    await hue.fill("305");
    await expect(page.getByRole("slider", { name: "Accent hue" })).toHaveAttribute(
      "aria-valuenow",
      "305",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(hue).toHaveValue("45");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(hue).toHaveValue("305");
    await page.getByRole("button", { name: "Choose Canvas color", exact: true }).click();
    const hex = page.getByRole("textbox", { name: "Hex color", exact: true });
    await hex.fill("#faf9fc");
    await hex.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Canvas", exact: true })).toHaveValue("#faf9fc");
    const saved = page.waitForResponse(
      (response) => response.url().endsWith("/draft") && response.request().method() === "PUT",
    );
    const published = page.waitForResponse(
      (response) => response.url().endsWith("/publish") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
    expect((await published).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Apply Dither violet", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Applied Dither violet", exact: true }),
    ).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await expect
        .poll(() =>
          page.locator("html").evaluate((el) => el.style.getPropertyValue("--action-focal")),
        )
        .toContain("305");
    }
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(hue).toHaveValue("305");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(page.locator('iframe[aria-busy="true"]')).toHaveCount(0);
      await expect(page.getByTestId("theme-preview")).toHaveCSS("opacity", "1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page
        .getByRole("region", { name: "Accent hue", exact: true })
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      for (const control of [
        hue,
        page.getByRole("slider", { name: "Accent hue" }),
        page.getByRole("button", { name: "Choose Canvas color", exact: true }),
      ]) {
        const box = await control.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: `.impeccable/review/dither-polish/custom-accent-${width}.png`,
      });
      await page.getByRole("button", { name: "Choose Canvas color", exact: true }).click();
      await expect(hex).toBeVisible();
      await page.screenshot({ path: `.impeccable/review/dither-polish/color-picker-${width}.png` });
      await page.keyboard.press("Escape");
    }
  });
});

test("Dither button gradients respond to hover, focus, and press with reduced motion support", async ({
  page,
  request,
}) => {
  const { token } = await registerUser(request, `dither-effects-${Date.now()}@example.com`);
  await createWorkspace(request, token, "Dither effects");
  await authenticatePage(page, token);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "no-preference" });
    await page.goto("/media");
    const button = page.getByRole("button", { name: "Upload", exact: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    await expect(button).toBeEnabled();
    const texture = () =>
      button.evaluate((el) => {
        const style = getComputedStyle(el, "::before");
        return {
          opacity: Number(style.opacity),
          position: style.backgroundPosition,
          gradient: style.backgroundImage,
          duration: style.transitionDuration,
          mask: style.maskImage,
        };
      });
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await texture()).opacity).toBe(0.14);
    expect((await texture()).gradient).toContain("linear-gradient");
    expect((await texture()).mask).toContain("data:image/svg+xml");
    await button.hover();
    await expect.poll(async () => (await texture()).position).toMatch(/^0(?:%|px) 0px$/);
    await expect.poll(async () => (await texture()).opacity).toBe(0.18);
    await page.mouse.down();
    await expect.poll(async () => (await texture()).opacity).toBe(0.22);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await page.keyboard.press("Tab");
    await button.focus();
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    await expect.poll(async () => (await texture()).opacity).toBe(0.18);
    await button.screenshot({
      path: `.impeccable/review/dither-polish/button-focus-${scheme}.png`,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      (await texture()).duration.split(",").every((duration) => parseFloat(duration) < 0.001),
    ).toBe(true);
    await page.emulateMedia({ forcedColors: "active" });
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el, "::before").display))
      .toBe("none");
    await page.emulateMedia({ forcedColors: "none" });
  }
});
