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

for (const scheme of ["light", "dark"] as const) {
  test(`Color keeps its viewer and complete wheels usable on a laptop in ${scheme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.setViewportSize({ width: 1280, height: 720 });
    await createProject(page, "Focused Color layout");
    await page.getByRole("button", { name: "Add layer", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
    await page.getByRole("tab", { name: "Color", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Lift color wheel", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`color-laptop-${scheme}.png`) });

    for (const label of ["Show one scope", "Show all scopes"]) {
      const control = page.getByRole("button", { name: label, exact: true });
      const offset = await control.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        const icon = button.firstElementChild!.getBoundingClientRect();
        return {
          x: Math.abs(bounds.x + bounds.width / 2 - icon.x - icon.width / 2),
          y: Math.abs(bounds.y + bounds.height / 2 - icon.y - icon.height / 2),
        };
      });
      expect(offset.x, `${label} icon must be horizontally centered`).toBeLessThanOrEqual(1);
      expect(offset.y, `${label} icon must be vertically centered`).toBeLessThanOrEqual(1);
    }

    const viewer = page.locator("#video-editor-program-panel");
    await expect.poll(async () => (await viewer.boundingBox())!.height).toBeGreaterThanOrEqual(280);
    for (const name of ["Lift", "Gamma", "Gain", "Offset"]) {
      const wheel = page.getByRole("slider", { name: `${name} color wheel`, exact: true });
      await expect.poll(async () => (await wheel.boundingBox())!.width).toBeGreaterThanOrEqual(104);
      const visibleFraction = await wheel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        let top = Math.max(0, bounds.top);
        let bottom = Math.min(innerHeight, bounds.bottom);
        let left = Math.max(0, bounds.left);
        let right = Math.min(innerWidth, bounds.right);
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const rect = ancestor.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            top = Math.max(top, rect.top);
            bottom = Math.min(bottom, rect.bottom);
          }
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            left = Math.max(left, rect.left);
            right = Math.min(right, rect.right);
          }
        }
        return (
          (Math.max(0, bottom - top) * Math.max(0, right - left)) / (bounds.width * bounds.height)
        );
      });
      expect(visibleFraction, `${name} wheel must not be clipped by its panel`).toBeGreaterThan(
        0.98,
      );
    }
    await expect(page.getByRole("toolbar", { name: "On-canvas editing tools" })).toBeHidden();
    const lift = page.getByRole("slider", { name: "Lift color wheel", exact: true });
    const originalLift = await lift.getAttribute("aria-valuetext");
    await lift.press("ArrowRight");
    await expect(lift).not.toHaveAttribute("aria-valuetext", originalLift!);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    await expect(lift).toHaveAttribute("aria-valuetext", originalLift!);
    await page.getByRole("tab", { name: "Curves", exact: true }).click();
    await expect(
      page.getByRole("group", { name: "Master curve editor", exact: true }),
    ).toBeVisible();
    await expect(lift).toBeHidden();
    const curveMarker = page
      .locator("[data-curves-editor] circle, [data-curves-editor] ellipse")
      .nth(1);
    const markerBox = (await curveMarker.boundingBox())!;
    expect(Math.abs(markerBox.width - markerBox.height)).toBeLessThan(1);
    expect(markerBox.width).toBeGreaterThanOrEqual(8);
    expect(markerBox.width).toBeLessThanOrEqual(16);
    await expect(
      page.getByRole("button", { name: "Toggle auto-keyframe", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Before", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Effects", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add effect", exact: true })).toBeVisible();
    const keyframes = page.getByRole("button", { name: "Keyframes", exact: true });
    await keyframes.click();
    await expect(
      page.getByRole("button", { name: "Toggle auto-keyframe", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
    await page.getByRole("tab", { name: "Color", exact: true }).click();
    await expect(keyframes).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "Primaries", exact: true }).click();
    const scopes = page.getByRole("complementary", { name: "Scopes", exact: true });
    const previewWidth = (await viewer.boundingBox())!.width;
    await page.getByRole("button", { name: "Scopes", exact: true }).click();
    await expect(scopes).toBeHidden();
    await expect
      .poll(async () => (await viewer.boundingBox())!.width)
      .toBeGreaterThan(previewWidth);
    await expect(lift).toHaveAttribute("aria-valuetext", originalLift!);
    await page.getByRole("tab", { name: "Curves", exact: true }).click();
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
    await page.getByRole("tab", { name: "Color", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Curves", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(scopes).toBeHidden();
    await page
      .getByRole("banner")
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Save", exact: true }).click();
    await expect(page.getByText("All changes saved locally", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("tab", { name: "Curves", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(scopes).toBeHidden();
    if (scheme === "light") {
      for (const viewport of [
        { width: 1024, height: 768 },
        { width: 640, height: 450 },
        { width: 390, height: 844 },
        { width: 320, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.getByRole("tab", { name: "Secondary Qualifier", exact: true }).click();
        await expect(
          page.getByRole("tabpanel", { name: "Secondary Qualifier", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Add effect · Secondary Qualifier", exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        await page.screenshot({
          path: testInfo.outputPath(`color-qualifier-${viewport.width}.png`),
        });
        await page.getByRole("tab", { name: "Curves", exact: true }).click();
      }
    }
  });
}

test("text content is immediately editable without scrolling past transforms or templates", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await createProject(page, "Text inspector priority");
  await page.getByRole("button", { name: "Add layer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  const inspector = page.locator("#video-editor-tools-panel");
  const content = inspector.locator("textarea");
  await page.screenshot({ path: testInfo.outputPath("text-inspector-laptop.png") });
  await expect(content).toBeInViewport({ ratio: 1 });
  await expect(inspector.getByRole("spinbutton", { name: "Size", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(inspector.getByRole("button", { name: "Text color", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await content.fill("Words come first");
  await content.press("Tab");
  await expect(page.locator("[data-timeline-item-id]")).toContainText("Words come first");
  await inspector.getByRole("button", { name: "Browse styles", exact: true }).click();
  const style = page.getByRole("button", { name: "Apply Clean", exact: true });
  await style.click();
  await expect(style).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
  await expect(content).toHaveValue("Words come first");
  await page.getByRole("banner").getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(style).toHaveAttribute("aria-pressed", "false");
});

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
    await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
      timeout: 20_000,
    });
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

test("Color palettes explain their action and landscape workspaces retain a usable preview", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await createProject(page, "Palette and landscape review");
  await page.getByRole("button", { name: "Add layer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  await page.getByRole("tab", { name: "Color", exact: true }).click();
  for (const palette of ["Secondary Qualifier", "Power Window", "3D LUT"]) {
    await page.getByRole("tab", { name: palette, exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Add effect · ${palette}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No effects on this clip.", { exact: true })).toBeHidden();
  }
  await page.getByRole("tab", { name: "Secondary Qualifier", exact: true }).click();
  await page.getByRole("button", { name: "Add effect · Secondary Qualifier", exact: true }).click();
  await expect(page.locator("[data-effect-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "Add effect · Secondary Qualifier", exact: true }).click();
  await expect(page.locator("[data-effect-id]")).toHaveCount(2);
  for (const width of [640, 390, 320]) {
    await page.setViewportSize({ width, height: width === 640 ? 450 : 844 });
    const program = page.locator("#video-editor-program-panel");
    expect((await program.boundingBox())!.height).toBeGreaterThanOrEqual(190);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(
      page.getByRole("button", { name: "Enter preview fullscreen", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    const transportMenu = program.getByRole("button", { name: "More actions", exact: true });
    await transportMenu.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "Step one frame forward", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(transportMenu).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath(`video-qualifier-${width}.png`) });
  }
  await page.setViewportSize({ width: 640, height: 450 });
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await expect(page.getByRole("button", { name: "New composition", exact: true })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Timeline", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New composition", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const timeline = page.getByRole("region", { name: "Composition timeline", exact: true });
  await timeline.getByRole("button", { name: "Text", exact: true }).first().click();
  expect(
    (await page.locator("#video-editor-program-panel").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(160);
  await page.screenshot({ path: testInfo.outputPath("motion-landscape.png") });
  await page.getByRole("button", { name: "Render full video", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  const dialog = page.getByRole("dialog", { name: "Export video", exact: true });
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "Render now", exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("video-export-320.png") });
});
