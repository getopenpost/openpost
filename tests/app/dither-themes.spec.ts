import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Dither themes render readable controls and charts at desktop and phone widths", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { token } = await registerUser(request, `dither-${Date.now()}@example.com`);
  await createWorkspace(request, token, "Dither studio");
  await authenticatePage(page, token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("heading", { name: "Appearance", exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Test Workshop", exact: true }).click();
  const preview = page.getByTestId("theme-preview");
  await expect(preview).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await preview.screenshot({
    path: ".impeccable/review/dither/before-workshop.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Stop testing", exact: true }).click();

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const id of ["dither", "dither-moss"]) {
        const name = id === "dither" ? "Dither" : "Dither Moss";
        await page.getByRole("button", { name: `Test ${name}`, exact: true }).click();
        await expect(preview).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
        await expect
          .poll(() =>
            preview.evaluate((frame) => ({
              id: frame.contentDocument?.documentElement.dataset.themeId,
              scheme: frame.contentDocument?.documentElement.dataset.themeScheme,
            })),
          )
          .toEqual({ id, scheme: colorScheme });
        await expect
          .poll(
            () =>
              preview.evaluate((frame) => {
                const doc = frame.contentDocument!;
                const title = doc.querySelector('[data-theme-type="title"]')!;
                const actual = frame.contentWindow!.getComputedStyle(title).color;
                const expected = frame
                  .contentWindow!.getComputedStyle(doc.documentElement)
                  .getPropertyValue("--foreground")
                  .trim();
                return actual === expected;
              }),
            { timeout: 10_000 },
          )
          .toBe(true);
        const state = await preview.evaluate((frame) => {
          const doc = frame.contentDocument!;
          const button = doc.querySelector("[data-action-intent='focal']")!;
          const bar = doc.querySelector("[data-preview-chart-series]")!;
          return {
            overflow: doc.documentElement.scrollWidth > doc.documentElement.clientWidth,
            buttonMask: getComputedStyle(button, "::before").maskImage,
            buttonHeight: button.getBoundingClientRect().height,
            chartMask: getComputedStyle(bar).maskImage,
          };
        });
        expect(state.overflow).toBe(false);
        if (width <= 390) expect(state.buttonHeight).toBeGreaterThanOrEqual(44);
        expect(state.buttonMask).toContain("data:image/svg+xml");
        expect(state.chartMask).toContain("data:image/svg+xml");
        await preview.screenshot({
          path: `.impeccable/review/dither/${width}-${id}-${colorScheme}.png`,
          animations: "disabled",
        });
        await page.getByRole("button", { name: "Stop testing", exact: true }).click();
      }
    }
  }

  expect(errors).toEqual([]);
});

test("Dither themes apply, survive reload, and restore Workshop", async ({ page, request }) => {
  test.setTimeout(180_000);
  const { token } = await registerUser(request, `dither-${Date.now()}@example.com`);
  await createWorkspace(request, token, "Dither studio");
  await authenticatePage(page, token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/settings?tab=appearance");
  await expect(page.getByRole("heading", { name: "Appearance", exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither");
  await page.getByRole("button", { name: "Apply Workshop", exact: true }).click();
  for (const name of ["Dither", "Dither Moss", "Workshop"]) {
    const id = name.toLowerCase().replaceAll(" ", "-");
    const apply = page.getByRole("button", { name: `Apply ${name}`, exact: true });
    await apply.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", id, { timeout: 30_000 });
    if (id === "dither") {
      await page.emulateMedia({ forcedColors: "active" });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const button = document.querySelector(
              '[data-slot="button"][data-action-intent="focal"]',
            );
            return button && matchMedia("(forced-colors: active)").matches
              ? getComputedStyle(button, "::before").display
              : "missing";
          }),
        )
        .toBe("none");
      await page.emulateMedia({ forcedColors: "none" });
    }
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", id, { timeout: 30_000 });
  }
  expect(errors).toEqual([]);
});
