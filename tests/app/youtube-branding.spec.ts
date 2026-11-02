import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { registerUser, createWorkspace } from "./helpers";
import {
  fixtureDirectory,
  rasterFixtureFiles,
  uploadImageFixture,
  prepareProductPage,
} from "./product-capture-fixtures";

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 768, 800, 1440]) {
    test(`YouTube attribution fits ${width}px in ${scheme}`, async ({ page, request }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const auth = await registerUser(request, `youtube-brand-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Brand review");
      const media = await uploadImageFixture(
        request,
        auth.token,
        workspace.id,
        "logo.png",
        await readFile(join(fixtureDirectory, rasterFixtureFiles["openpost-logo"])),
      );
      await prepareProductPage({
        page,
        request,
        auth,
        workspace,
        backgroundMediaID: media,
        logoMediaID: media,
        scheme,
      });
      await page.goto("/accounts");
      await page.getByTestId("provider-search").fill("YouTube");
      await expect(page.getByTestId("provider-list").locator("li")).toHaveCount(1);
      const card = page.getByTestId("provider-card-youtube");
      await expect(card.getByRole("link", { name: "YouTube", exact: true })).toBeVisible();
      const geometry = await card.locator("svg").evaluate((svg) => {
        const mark = svg.querySelector("path")! as SVGGraphicsElement;
        const matrix = (svg as SVGGraphicsElement).getScreenCTM()!;
        const box = svg.getBoundingClientRect();
        const cardBox = svg
          .closest('[data-testid="provider-card-youtube"]')!
          .getBoundingClientRect();
        return {
          paintedHeight: mark.getBBox().height * matrix.d,
          right: box.right,
          left: box.left,
          top: box.top,
          bottom: box.bottom,
          cardLeft: cardBox.left,
          cardRight: cardBox.right,
          cardTop: cardBox.top,
          cardBottom: cardBox.bottom,
          color: getComputedStyle(mark).fill,
        };
      });
      expect(geometry.paintedHeight).toBeGreaterThanOrEqual(100);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.cardLeft);
      expect(geometry.right).toBeLessThanOrEqual(geometry.cardRight);
      expect(geometry.top).toBeGreaterThanOrEqual(geometry.cardTop);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.cardBottom);
      expect(geometry.color).toBe("rgb(255, 0, 51)");
      if (width === 1440) {
        expect(geometry.cardBottom - geometry.cardTop).toBeLessThan(250);
      }
      await expect(page.getByText("YouTube", { exact: true }).first()).toBeVisible();
      const screenshot = await card.screenshot();
      await info.attach("YouTube connection card", { body: screenshot, contentType: "image/png" });
      if (process.env.OPENPOST_YOUTUBE_EVIDENCE_DIRECTORY) {
        await mkdir(process.env.OPENPOST_YOUTUBE_EVIDENCE_DIRECTORY, { recursive: true });
        await card.screenshot({
          path: join(
            process.env.OPENPOST_YOUTUBE_EVIDENCE_DIRECTORY,
            `youtube-card-${width}-${scheme}.png`,
          ),
        });
      }
      await page.goto("/");
      await expect(
        page.locator("#composer-destination-account-youtube [data-slot=social-account-platform]"),
      ).toBeVisible();
      await expect(
        page.locator("#composer-destination-account-youtube [data-slot=social-account-platform]"),
      ).toHaveText("· YouTube");
    });
  }
}
