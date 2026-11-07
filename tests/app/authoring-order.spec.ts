import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createPublication,
  createWorkspace,
  registerUser,
  expectPostText,
} from "./helpers";

test("thread authoring reorder supports keyboard preview, drop, cancel, and undo", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const unique = `authoring-order-${randomUUID()}@example.com`;
  const auth = await registerUser(request, unique);
  const workspace = await createWorkspace(request, auth.token, "Authoring order");
  const publication = await createPublication(
    request,
    auth.token,
    workspace.id,
    "First draft post",
  );
  await authenticatePage(page, auth.token);

  const saves: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/v1/publications")) {
      saves.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto(`/publications/${publication.id}`);
  const composer = page.getByTestId("text-thread-composer-content");
  await expect(composer).toBeVisible({ timeout: 30000 });

  await page.locator("#post-textarea-0").fill("First edited post");
  await composer.getByRole("button", { name: "Add post", exact: true }).click();
  await expect(page.locator("#post-textarea-1")).toBeVisible();
  await page.locator("#post-textarea-1").fill("Second edited post");

  // Let the initial content settle, then prove keyboard preview does not autosave.
  await page.waitForTimeout(2200);
  saves.length = 0;
  const handles = composer.locator("[data-reorder-key]");
  await expect(handles).toHaveCount(2);
  await handles.nth(0).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await expectPostText(page.locator("#post-textarea-0"), "Second edited post");
  await expectPostText(page.locator("#post-textarea-1"), "First edited post");
  await page.waitForTimeout(2200);
  expect(saves).toHaveLength(0);

  await page.keyboard.press("Escape");
  await expectPostText(page.locator("#post-textarea-0"), "First edited post");
  await expectPostText(page.locator("#post-textarea-1"), "Second edited post");

  await handles.nth(0).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expectPostText(page.locator("#post-textarea-0"), "Second edited post");
  await expectPostText(page.locator("#post-textarea-1"), "First edited post");

  const undo = composer.getByRole("button", { name: "Undo reorder", exact: true });
  await expect(undo).toBeVisible();
  await page.locator("#post-textarea-0").fill("Second edited after reorder");
  await undo.click();
  await expectPostText(page.locator("#post-textarea-0"), "First edited post");
  await expectPostText(page.locator("#post-textarea-1"), "Second edited after reorder");
  for (const width of [1280, 320])
    for (const colorScheme of ["light"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const text = page.locator("#post-textarea-1");
      const textBounds = await text.boundingBox();
      const removeBounds = await composer
        .getByRole("button", { name: "Remove post", exact: true })
        .nth(1)
        .boundingBox();
      const padding = await text.evaluate((element) =>
        parseFloat(getComputedStyle(element).paddingRight),
      );
      expect(textBounds).not.toBeNull();
      expect(removeBounds).not.toBeNull();
      expect(textBounds!.x + textBounds!.width - padding).toBeLessThanOrEqual(removeBounds!.x);
      await page.screenshot({
        path: testInfo.outputPath(`authoring-${width}-${colorScheme}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  expect(errors).toEqual([]);
});
