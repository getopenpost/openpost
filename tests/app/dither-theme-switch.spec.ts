import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

type Palette = { color: string; background: string };
type DitherWindow = Window & {
  ditherCapture?: { states: Palette[]; observer: MutationObserver };
};

test("theme thumbnails keep each palette paired while switching schemes", async ({
  page,
  request,
}) => {
  const { token } = await registerUser(request, `dither-switch-${randomUUID()}@example.com`);
  await createWorkspace(request, token, "Dither studio");
  await authenticatePage(page, token);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/settings?tab=appearance");
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }).first(),
  ).toBeVisible();

  const button = page.locator('[data-theme-library-card="dither"] [data-dither-button="always"]');
  await expect(button).toBeVisible();
  const palette = (node: Element): Palette => ({
    color: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
  });
  const initial = await button.evaluate(palette);
  await page.evaluate(() => {
    const card = document.querySelector('[data-theme-library-card="dither"]')!;
    const states: Palette[] = [];
    const capture = (style: string) => {
      const color = /(?:^|;)\s*color:\s*([^;]+)/.exec(style)?.[1]?.trim();
      const background = /(?:^|;)\s*background:\s*([^;]+)/.exec(style)?.[1]?.trim();
      if (color && background) states.push({ color, background });
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName !== "style") continue;
        capture(record.oldValue ?? "");
        capture((record.target as Element).getAttribute("style") ?? "");
      }
    });
    observer.observe(card, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
      attributeOldValue: true,
    });
    (window as DitherWindow).ditherCapture = { states, observer };
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => button.evaluate((node) => getComputedStyle(node).color))
    .not.toBe(initial.color);
  await expect
    .poll(() => button.evaluate((node) => getComputedStyle(node).backgroundColor))
    .not.toBe(initial.background);
  const final = await button.evaluate(palette);
  const states = await page.evaluate(() => {
    const capture = (window as DitherWindow).ditherCapture;
    capture?.observer.disconnect();
    return capture?.states ?? [];
  });
  expect(states).toContainEqual(initial);
  expect(states).toContainEqual(final);
  expect(
    states.every(
      (state) =>
        (state.color === initial.color && state.background === initial.background) ||
        (state.color === final.color && state.background === final.background),
    ),
  ).toBe(true);
});
