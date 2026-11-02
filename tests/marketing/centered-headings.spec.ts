import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers.js";

for (const route of ["/", "/contact", "/platforms"]) {
  test(`${route} keeps its headline and supporting copy centered @desktop`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.route("https://app.openpo.st/api/v1/github-stars", (route) =>
      route.fulfill({ json: { count: 900 } }),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const widths = route === "/" ? [1867, 1280, 390, 320] : [1440, 390, 320];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await dismissTelemetryConsent(page);
        await page.evaluate(() => document.fonts.ready);
        const heading = page.getByRole("heading", { level: 1 });
        const geometry = await heading.evaluate((node) => {
          const title = node.getBoundingClientRect();
          const parent = node.parentElement!.getBoundingClientRect();
          const copy = node.parentElement!.querySelector("p")!.getBoundingClientRect();
          const center = parent.x + parent.width / 2;
          return {
            headingOffset: Math.abs(title.x + title.width / 2 - center),
            copyOffset: Math.abs(copy.x + copy.width / 2 - center),
            lines: title.height / Number.parseFloat(getComputedStyle(node).lineHeight),
            alignment: getComputedStyle(node).textAlign,
          };
        });
        await page.screenshot({ path: testInfo.outputPath(`${colorScheme}-${width}.png`) });
        expect(geometry.headingOffset).toBeLessThan(1);
        expect(geometry.copyOffset).toBeLessThan(1);
        expect(geometry.alignment).toBe("center");
        if (route === "/" && width >= 1280) expect(geometry.lines).toBeCloseTo(2, 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
      }
    }
    expect(errors).toEqual([]);
  });
}
