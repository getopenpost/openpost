import { expect, test, type Page } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

const PALETTE_MIDPOINT = 128;

async function choose(page: Page, name: string, option: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

for (const host of ["dark", "light"] as const)
  test(`explicit preview appearance overrides ${host} host and browser preference @desktop`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.emulateMedia({ colorScheme: host, reducedMotion: "reduce" });
    await page.goto("/tools/linkedin-post-preview");
    await dismissTelemetryConsent(page);
    await expect(
      page.getByRole("button", { name: "Preview appearance", exact: true }),
    ).toBeVisible();
    const theme = page
      .locator("header.marketing-nav")
      .getByRole("button", { name: `Use ${host} theme`, exact: true });
    if (await theme.isVisible()) await theme.click();
    if (host === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    const hostClass = await page.locator("html").getAttribute("class");
    const networks = [
      "LinkedIn",
      "X",
      "Mastodon",
      "Pixelfed",
      "PeerTube",
      "Lemmy",
      "PieFed",
      "Bluesky",
      "Threads",
      "Instagram",
      "Facebook",
      "YouTube",
      "TikTok",
      "Discord",
      "Telegram",
      "Pinterest",
      "Reddit",
      "Google Business Profile",
    ];
    for (const network of networks) {
      await choose(page, "Platform", network);
      for (const view of ["Post card", "Full page"]) {
        await choose(page, "Preview view", view);
        const card = page.locator("[data-preview-viewport] .social-preview").first();
        const native = card.locator(":scope > *").first();
        const samples: Record<string, { card: number; shell: number | null }> = {};
        for (const appearance of ["Light", "Dark"]) {
          await choose(page, "Preview appearance", appearance);
          await expect(card).toHaveAttribute("data-preview-scheme", appearance.toLowerCase());
          await expect(card).toHaveCSS("color-scheme", appearance.toLowerCase());
          await expect(async () => {
            const sample = await native.evaluate((element) => {
              function brightness(node: Element) {
                const value = getComputedStyle(node).backgroundColor;
                const rgb = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
                if (!rgb) throw new Error(`Expected an opaque native surface, received ${value}`);
                return (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / 3;
              }
              const shell = element.closest(".preview-page");
              return { card: brightness(element), shell: shell ? brightness(shell) : null };
            });
            const surfaces = network === "TikTok" ? [] : [sample.card];
            if (view === "Full page") {
              expect(sample.shell).not.toBeNull();
              surfaces.push(sample.shell!);
            }
            for (const surface of surfaces) {
              if (appearance === "Light") expect(surface).toBeGreaterThan(PALETTE_MIDPOINT);
              else expect(surface).toBeLessThan(PALETTE_MIDPOINT);
            }
            samples[appearance] = sample;
          }).toPass({ timeout: 5000 });
        }
        await testInfo.attach(`${network}-${view}-palettes`, {
          body: JSON.stringify(samples),
          contentType: "application/json",
        });
        if (network !== "TikTok")
          expect(
            samples.Light.card - samples.Dark.card,
            `${network} ${view} native palette`,
          ).toBeGreaterThan(80);
        if (view === "Full page")
          expect(
            samples.Light.shell! - samples.Dark.shell!,
            `${network} page palette`,
          ).toBeGreaterThan(80);
      }
    }
    await choose(page, "Platform", "LinkedIn");
    await choose(page, "Preview appearance", "Light");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page
          .getByRole("region", { name: "Scrollable social preview" })
          .evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
          }),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`explicit-light-${host}-${width}.png`),
        fullPage: true,
      });
    }
    expect(await page.locator("html").getAttribute("class")).toBe(hostClass);
  });
