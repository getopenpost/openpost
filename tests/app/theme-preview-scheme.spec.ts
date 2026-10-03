import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320]) {
  for (const initial of ["light", "dark"] as const) {
    test(`paired themes preserve saved ${initial} appearance at ${width}px`, async ({
      page,
      request,
    }, info) => {
      const auth = await registerUser(request, `theme-preview-scheme-${randomUUID()}@example.com`);
      await createWorkspace(request, auth.token, "Theme scheme preview");
      await authenticatePage(page, auth.token);
      const writes: string[] = [];
      page.on("request", (req) => {
        if (/\/api\/v1\/(theme|organization)/.test(req.url()) && req.method() !== "GET")
          writes.push(req.method());
      });

      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: initial, reducedMotion: "reduce" });
      await page.goto("/settings?tab=appearance");
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), initial);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", initial);
      const choice = page.getByRole("button", { name: "Test Workshop", exact: true });
      await choice.focus();
      await page.keyboard.press("Enter");
      const scheme = page.getByRole("button", { name: "Preview color scheme", exact: true });
      await page.screenshot({ path: info.outputPath(`scheme-entry-${width}-${initial}.png`) });
      await expect(scheme).toBeVisible();
      await scheme.focus();
      await page.keyboard.press("Enter");
      const other = initial === "light" ? "dark" : "light";
      await expect(
        page.getByRole("option", { name: other === "light" ? "Light" : "Dark", exact: true }),
      ).toBeVisible();
      await page.keyboard.press(initial === "light" ? "End" : "Home");
      await page.keyboard.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", other);
      await expect(page.getByTestId("theme-preview")).toHaveAttribute("aria-busy", "false");
      expect(await page.evaluate(() => localStorage.getItem("mode-watcher-mode"))).toBe(initial);
      await page.screenshot({ path: info.outputPath(`scheme-switched-${width}-${initial}.png`) });
      await page.getByRole("button", { name: "Stop testing", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither");
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", initial);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither");
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", initial);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      expect(writes).toEqual([]);
    });
  }
}
