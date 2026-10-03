import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("decorative circles follow settled responsive heading geometry @desktop", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const route of [
      "/tools",
      "/tools/logo-maker",
      "/tools/multi-platform-character-counter",
    ]) {
      await page.setViewportSize({ width: 1280, height: 844 });
      await page.goto(route);
      await dismissTelemetryConsent(page);
      await page.evaluate(() => document.fonts.ready);
      const annotations = page.locator("svg.rough-annotation");
      await expect(annotations.first().locator("path")).toHaveCount(1);
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(600);
        for (let index = 0; index < (await annotations.count()); index++) {
          const annotation = annotations.nth(index);
          await annotation.evaluate((node) =>
            node.previousElementSibling!.scrollIntoView({ block: "center" }),
          );
          await expect
            .poll(async () =>
              annotation.evaluate((node) => {
                const svg = node as SVGSVGElement;
                const target = svg.previousElementSibling!.getBoundingClientRect();
                const bounds = svg.getBBox();
                const matrix = svg.getScreenCTM()!;
                const start = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
                const end = new DOMPoint(
                  bounds.x + bounds.width,
                  bounds.y + bounds.height,
                ).matrixTransform(matrix);
                return Math.max(
                  Math.abs((start.x + end.x - target.left - target.right) / 2),
                  Math.abs((start.y + end.y - target.top - target.bottom) / 2),
                );
              }),
            )
            .toBeLessThan(10);
          const geometry = await annotation.evaluate((node) => {
            const svg = node as SVGSVGElement;
            const target = svg.previousElementSibling!;
            const rect = target.getBoundingClientRect();
            const bounds = svg.getBBox();
            const matrix = svg.getScreenCTM()!;
            const start = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
            const end = new DOMPoint(
              bounds.x + bounds.width,
              bounds.y + bounds.height,
            ).matrixTransform(matrix);
            return {
              text: target.textContent,
              target: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
              circle: { left: start.x, top: start.y, right: end.x, bottom: end.y },
            };
          });
          expect(geometry.circle.right - geometry.circle.left).toBeLessThanOrEqual(
            (geometry.target.right - geometry.target.left) * 1.3 + 18,
          );
          expect(geometry.circle.bottom - geometry.circle.top).toBeLessThanOrEqual(
            (geometry.target.bottom - geometry.target.top) * 1.3 + 10,
          );
          expect(geometry.circle.left).toBeLessThanOrEqual(geometry.target.left + 10);
          expect(geometry.circle.right).toBeGreaterThanOrEqual(geometry.target.right - 10);
          expect(geometry.circle.top).toBeLessThanOrEqual(geometry.target.top + 10);
          expect(geometry.circle.bottom).toBeGreaterThanOrEqual(geometry.target.bottom - 10);
          await testInfo.attach(`${route}-${scheme}-${width}-${index}-geometry`, {
            body: JSON.stringify(geometry),
            contentType: "application/json",
          });
          await page.screenshot({
            path: testInfo.outputPath(
              `${route.replaceAll("/", "-")}-${scheme}-${width}-${index}.png`,
            ),
          });
        }
      }
    }
  }
});
