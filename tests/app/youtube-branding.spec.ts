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
      const screenshot = await card.screenshot();
      await info.attach("YouTube connection card", {
        body: screenshot,
        contentType: "image/png",
      });
      if (process.env.OPENPOST_YOUTUBE_EVIDENCE_DIRECTORY) {
        await mkdir(process.env.OPENPOST_YOUTUBE_EVIDENCE_DIRECTORY, {
          recursive: true,
        });
        await card.screenshot({
          path: join(
            process.env.OPENPOST_YOUTUBE_EVIDENCE_DIRECTORY,
            `youtube-card-${width}-${scheme}.png`,
          ),
        });
      }
      const geometry = await card.locator("svg").evaluate((svg) => {
        const mark = svg.querySelector("path")! as SVGGraphicsElement;
        const matrix = (svg as SVGGraphicsElement).getScreenCTM()!;
        const triangle = (svg.querySelectorAll("path")[1] as SVGGraphicsElement).getBBox();
        const markBox = mark.getBBox();
        const viewBox = (svg as SVGSVGElement).viewBox.baseVal;
        const box = svg.getBoundingClientRect();
        const cardBox = svg
          .closest('[data-testid="provider-card-youtube"]')!
          .getBoundingClientRect();
        return {
          paintedHeight: markBox.height * matrix.d,
          aspectRatio: box.width / box.height,
          canonicalAspectRatio: viewBox.width / viewBox.height,
          clearSpace: [
            markBox.x,
            markBox.y,
            viewBox.width - markBox.x - markBox.width,
            viewBox.height - markBox.y - markBox.height,
          ],
          triangleWidth: triangle.width,
          triangleColor: getComputedStyle(svg.querySelectorAll("path")[1]).fill,
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
      expect(geometry.cardBottom - geometry.cardTop).toBeLessThanOrEqual(112);
      expect(geometry.paintedHeight).toBeGreaterThanOrEqual(20);
      expect(geometry.paintedHeight).toBeLessThanOrEqual(28);
      expect(geometry.aspectRatio).toBeCloseTo(geometry.canonicalAspectRatio, 2);
      for (const margin of geometry.clearSpace) {
        expect(margin).toBeGreaterThanOrEqual(geometry.triangleWidth - 0.01);
      }
      expect(geometry.triangleColor).toBe("rgb(255, 255, 255)");
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.cardLeft);
      expect(geometry.right).toBeLessThanOrEqual(geometry.cardRight);
      expect(geometry.top).toBeGreaterThanOrEqual(geometry.cardTop);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.cardBottom);
      expect(geometry.color).toBe("rgb(255, 0, 51)");
      const title = card.getByRole("heading", { name: "YouTube", exact: true });
      const action = card.getByRole("button");
      await expect(title).toBeVisible();
      await expect(action).toBeVisible();
      const titleBox = (await title.boundingBox())!;
      const actionBox = (await action.boundingBox())!;
      expect(titleBox.width).toBeGreaterThanOrEqual(48);
      expect(titleBox.x).toBeGreaterThanOrEqual(geometry.right);
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actionBox.x);
      expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(geometry.cardRight);
      expect(
        Math.abs((geometry.top + geometry.bottom) / 2 - (actionBox.y + actionBox.height / 2)),
      ).toBeLessThanOrEqual(1);
      await expect(page.getByText("YouTube", { exact: true }).first()).toBeVisible();
      const accountActions = page
        .getByTestId("account-card-account-youtube")
        .getByRole("button", { name: /^Actions for / });
      await accountActions.click();
      await expect(
        page.getByRole("menuitem", { name: "Account details", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(accountActions).toBeFocused();
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
