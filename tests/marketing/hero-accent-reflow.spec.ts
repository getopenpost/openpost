import { expect, test, type Locator } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

async function readAnnotationGeometry(annotation: Locator) {
  return annotation.evaluate((node) => {
    const svg = node as SVGSVGElement;
    const target = svg.previousElementSibling!;
    const rect = target.getBoundingClientRect();
    const bounds = svg.getBBox();
    const matrix = svg.getScreenCTM()!;
    const start = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
    const end = new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(
      matrix,
    );
    return {
      text: target.textContent,
      target: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
      circle: { left: start.x, top: start.y, right: end.x, bottom: end.y },
    };
  });
}

test("decorative circles follow settled responsive heading geometry @desktop", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  // Exercise the narrow end of the decorative ellipse's random radius variation.
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
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
        for (let index = 0; index < (await annotations.count()); index++) {
          const annotation = annotations.nth(index);
          await annotation.evaluate((node) =>
            node.previousElementSibling!.scrollIntoView({ block: "center" }),
          );
          await expect
            .poll(async () => {
              const { circle, target } = await readAnnotationGeometry(annotation);
              return {
                centered:
                  Math.max(
                    Math.abs((circle.left + circle.right - target.left - target.right) / 2),
                    Math.abs((circle.top + circle.bottom - target.top - target.bottom) / 2),
                  ) < 10,
                boundedWidth: circle.right - circle.left <= (target.right - target.left) * 1.3 + 18,
                boundedHeight:
                  circle.bottom - circle.top <= (target.bottom - target.top) * 1.3 + 10,
                left: circle.left <= target.left + 10,
                right: circle.right >= target.right - 10,
                top: circle.top <= target.top + 10,
                bottom: circle.bottom >= target.bottom - 10,
              };
            })
            .toEqual({
              centered: true,
              boundedWidth: true,
              boundedHeight: true,
              left: true,
              right: true,
              top: true,
              bottom: true,
            });
          const geometry = await readAnnotationGeometry(annotation);
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
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
      }
    }
  }
});
