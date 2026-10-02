import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320]) {
  test.describe(`${width}px thread actions`, () => {
    test.use({ hasTouch: width < 768 });
    for (const scheme of ["light", "dark"] as const) {
      test(`backward focus reveals the earlier post's actions in ${scheme}`, async ({
        page,
        request,
      }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const auth = await registerUser(request, `thread-toolbar-${randomUUID()}@example.com`);
        const workspace = await createWorkspace(request, auth.token, "Thread toolbar focus");
        await authenticatePage(page, auth.token);
        await page.goto("/");
        await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
        await page.reload();
        if (scheme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        else await expect(page.locator("html")).not.toHaveClass(/dark/);
        const editors = page.getByRole("textbox", { name: "Post text", exact: true });
        await editors.first().fill("Audit first post.");
        await page.getByRole("button", { name: "Add post", exact: true }).click();
        await editors.nth(1).fill("Audit second post.");
        const headers = { Authorization: `Bearer ${auth.token}` };
        let saved: any;
        await expect
          .poll(async () => {
            const list = await (
              await request.get("/api/v1/publications", {
                headers,
                params: { workspace_id: workspace.id },
              })
            ).json();
            const items = Array.isArray(list) ? list : (list.items ?? list.publications ?? []);
            const item = items.find((entry: any) => entry.source_text === "Audit first post.");
            if (!item) return false;
            saved = await (
              await request.get(`/api/v1/publications/${item.id}`, { headers })
            ).json();
            return saved.segments?.[1]?.body === "Audit second post.";
          })
          .toBe(true);
        await page.goto(`/publications/${saved.id}`);
        await editors.nth(1).focus();
        const earlierAction = page.getByRole("button", { name: "Add post", exact: true }).first();
        for (let step = 0; step < 12; step++) {
          if (await earlierAction.evaluate((button) => document.activeElement === button)) break;
          await page.keyboard.press("Shift+Tab");
        }
        await expect(earlierAction).toBeFocused();
        await expect
          .poll(() =>
            earlierAction.evaluate((button) => {
              for (let element: Element | null = button; element; element = element.parentElement) {
                if (getComputedStyle(element).opacity === "0") return false;
              }
              return true;
            }),
          )
          .toBe(true);
        await page.screenshot({ path: testInfo.outputPath("earlier-action-focused.png") });
        const firstMedia = page.getByRole("button", { name: "Add media", exact: true }).first();
        for (let step = 0; step < 8; step++) {
          if (await firstMedia.evaluate((button) => document.activeElement === button)) break;
          await page.keyboard.press("Shift+Tab");
        }
        await expect(firstMedia).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(firstMedia).toBeFocused();
        // Pointer users activate the visible post before using its contextual actions.
        if (width < 768) await editors.nth(1).tap();
        else await editors.nth(1).click();
        const secondMedia = page.getByRole("button", { name: "Add media", exact: true }).nth(1);
        if (width < 768) await secondMedia.tap();
        else await secondMedia.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(secondMedia).toBeFocused();
        if (width < 768) {
          expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
          const bounds = await secondMedia.boundingBox();
          expect(bounds!.width).toBeGreaterThanOrEqual(44);
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: testInfo.outputPath("pointer-recovered.png") });
        const detail = await (
          await request.get(`/api/v1/publications/${saved.id}`, { headers })
        ).json();
        expect(detail.segments.map((segment: { body: string }) => segment.body)).toEqual([
          "Audit first post.",
          "Audit second post.",
        ]);
        expect(errors).toEqual([]);
      });
    }
  });
}
