import { expect, test, type Page } from "@playwright/test";

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

async function createProject(
  page: Page,
  name: string,
  options: { selectLocalProjects?: boolean } = {},
): Promise<void> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  if (options.selectLocalProjects) {
    await page.getByRole("button", { name: "Local only" }).click();
  }
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Custom project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
}

test("sidebar columns leave the preview visible and bound the timeline", async ({ page }) => {
  await createProject(page, "Panel layout");
  const preview = page.locator("#video-editor-program-panel");

  await page.locator('[data-layout-toggle="expand-column-right"]').click();
  await expect(preview).toBeVisible();
  const tools = await page.locator("#video-editor-tools-panel").boundingBox();
  const timeline = await page.locator("footer").boundingBox();
  expect(tools!.y + tools!.height).toBeCloseTo(timeline!.y + timeline!.height, 0);
  expect(timeline!.x + timeline!.width).toBeLessThanOrEqual(tools!.x + 1);
});

test("a collapsed asset tab opens its panel in one click", async ({ page }) => {
  await createProject(page, "Collapsed tabs");
  await page.locator('[data-layout-toggle="collapse-left"]').click();
  await page.locator('[data-left-panel-tab="media"][data-tab-orientation="vertical"]').click();
  await expect(page.locator('[data-layout-toggle="collapse-left"]')).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`property panels stay neutral while controls retain their accent in ${scheme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await createProject(page, "Neutral properties");
    await page
      .getByRole("complementary", { name: "Assets" })
      .getByRole("button", { name: "Add layer" })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    const panels = page.getByTestId("clip-transform-panel").locator("section");
    await expect(panels).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath(`properties-${scheme}.png`) });
    for (const panel of await panels.all()) {
      const colors = await panel.evaluate((element) => {
        const probe = document.createElement("span");
        element.append(probe);
        probe.style.backgroundColor = "var(--card)";
        const neutral = getComputedStyle(probe).backgroundColor;
        probe.style.backgroundColor = "var(--action-ordinary-hover)";
        const hover = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { actual: getComputedStyle(element).backgroundColor, neutral, hover };
      });
      expect(colors.actual).toBe(colors.neutral);
      expect(colors.actual).not.toBe(colors.hover);
    }
    const opacity = page.getByRole("slider", { name: "Opacity", exact: true });
    await opacity.focus();
    await opacity.press("ArrowLeft");
    await expect(opacity).toHaveAttribute("aria-valuenow", "99");
    const accents = await opacity.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.transition = "none";
      element.append(probe);
      const color = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const focus = color("--ring");
      const editor = color("--video-editor-focus");
      const primary = color("--action-focal");
      probe.remove();
      return { focus, editor, primary };
    });
    const hue = (color: string) => {
      const coordinates = /^oklch\([\d.]+\s+[\d.]+\s+([\d.]+)\)$/.exec(color);
      expect(coordinates, `expected a computed OKLCH color, received ${color}`).not.toBeNull();
      return Number(coordinates![1]);
    };
    expect(hue(accents.focus), "focus follows the active theme's hue").toBe(hue(accents.primary));
    expect(accents.editor, "editor selections follow the same focus accent").toBe(accents.focus);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("[data-program-monitor]")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: testInfo.outputPath(`properties-${scheme}-${width}.png`) });
    }
  });

  test(`panel transitions preserve geometry and size in ${scheme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await createProject(page, "Panel transitions");
    await page
      .getByRole("complementary", { name: "Assets" })
      .getByRole("button", { name: "Add layer" })
      .click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await expect(page.locator("[data-program-monitor]")).toBeVisible();
    const assets = page.locator("#video-editor-assets-panel");
    const tools = page.locator("#video-editor-tools-panel");
    const preview = page.locator("#video-editor-program-panel");
    const footer = page.locator("footer");
    const leftDock = page.locator('[data-layout-toggle="expand-column-left"]');
    const rightDock = page.locator('[data-layout-toggle="expand-column-right"]');
    const player = await preview.locator("[data-program-monitor]").elementHandle();
    async function assertLayout(leftFull: boolean, rightFull: boolean) {
      await expect(preview).toBeVisible();
      await expect(async () => {
        const [a, t, f] = await page.evaluate(() =>
          ["#video-editor-assets-panel", "#video-editor-tools-panel", "footer"].map((selector) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );
        expect(f.x).toBeCloseTo(leftFull ? a.x + a.width : a.x, 0);
        expect(f.x + f.width).toBeCloseTo(rightFull ? t.x : t.x + t.width, 0);
        expect(a.y + a.height).toBeCloseTo(leftFull ? f.y + f.height : f.y, 0);
        expect(t.y + t.height).toBeCloseTo(rightFull ? f.y + f.height : f.y, 0);
      }).toPass({ timeout: 3000 });
      expect(await player!.evaluate((node) => node.isConnected)).toBe(true);
    }
    await assertLayout(true, false);
    const resize = page.getByRole("separator", { name: "Assets", exact: true });
    await resize.press("ArrowRight");
    await expect.poll(async () => (await assets.boundingBox())!.width).toBeGreaterThan(336);
    const resizedWidth = (await assets.boundingBox())!.width;
    expect(resizedWidth).toBeGreaterThan(336);
    const timelineResize = page.getByRole("separator", { name: "Timeline", exact: true });
    const beforeHeight = (await footer.boundingBox())!.height;
    const grip = (await timelineResize.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y - 40, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => (await footer.boundingBox())!.height)
      .toBeGreaterThan(beforeHeight + 30);
    for (let repeat = 0; repeat < 2; repeat++) {
      await rightDock.click();
      await assertLayout(true, true);
      await leftDock.click();
      await assertLayout(false, true);
      await rightDock.click();
      await assertLayout(false, false);
      await leftDock.click();
      await assertLayout(true, false);
      await page.locator('[data-layout-toggle="collapse-left"]').click();
      await assertLayout(true, false);
      await page.locator('[data-layout-toggle="expand-left"]').click();
      await page.locator('[data-layout-toggle="collapse-right"]').click();
      await assertLayout(true, false);
      await page.locator('[data-layout-toggle="expand-right"]').click();
      expect((await assets.boundingBox())!.width).toBeCloseTo(resizedWidth, 0);
    }
    await rightDock.focus();
    await page.keyboard.press("Enter");
    await expect(rightDock).toBeFocused();
    await assertLayout(true, true);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await page.screenshot({ path: testInfo.outputPath(`columns-${scheme}.png`) });
    await page.locator('[data-layout-toggle="theater"]').click();
    await assertLayout(false, false);
    await page.keyboard.press("Escape");
    await assertLayout(true, true);
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[data-layout-toggle="theater"]')!.click();
      document.querySelector<HTMLElement>("[data-program-monitor]")!.focus();
    });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(page.locator("[data-program-monitor]")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Alt+ArrowRight");
    await expect(page.locator('[data-layout-toggle="theater"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await assertLayout(true, false);
    await rightDock.click();
    await page.reload();
    await expect(rightDock).toHaveAttribute("aria-pressed", "true");
    await expect(leftDock).toHaveAttribute("aria-pressed", "true");
    expect((await assets.boundingBox())!.width).toBeCloseTo(resizedWidth, 0);
    for (const workspace of ["Color", "Motion", "Edit"]) {
      await page
        .getByRole("tablist", { name: "Editor workspaces" })
        .getByRole("tab", { name: workspace, exact: true })
        .click();
      await expect(page.locator("#editor-workspace-panel")).toBeVisible();
    }
    await expect(rightDock).toHaveAttribute("aria-pressed", "true");
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 1024) {
        for (const name of ["Assets", "Edit", "Program"]) {
          const tab = page
            .getByRole("navigation", { name: "Editor panels" })
            .getByRole("button", { name, exact: true });
          await tab.click();
          await expect(tab).toHaveAttribute("aria-pressed", "true");
          await expect(
            name === "Assets" ? assets : name === "Edit" ? tools : preview,
          ).toBeVisible();
        }
      }
      await expect(preview).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: testInfo.outputPath(`panels-${scheme}-${width}.png`) });
    }
    expect(errors).toEqual([]);
  });
}
