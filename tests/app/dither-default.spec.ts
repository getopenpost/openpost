import { expect, test } from "@playwright/test";
import {
  assignBuiltInTheme,
  authenticatePage,
  createPublication,
  createWorkspace,
  registerUser,
} from "./helpers";

test("the default Dither workspace keeps real app controls usable in both schemes", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { token } = await registerUser(request, `dither-default-${Date.now()}@example.com`);
  const workspace = await createWorkspace(request, token, "Dither studio");
  const publication = "A smaller release, with clearer controls and fewer repeated steps.";
  await createPublication(request, token, workspace.id, publication);
  await authenticatePage(page, token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const surface of [
        { path: "/media", name: "media", heading: "Media" },
        { path: "/publications?tab=drafts", name: "publications", heading: "Publications" },
        { path: "/image-editor", name: "image-editor", heading: "Image Editor" },
        { path: "/video-editor", name: "video-editor", heading: "Video Editor" },
      ]) {
        await page.goto(surface.path);
        await expect(
          page.getByRole("heading", { name: surface.heading, exact: true }).first(),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither");
        await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
        if (surface.name === "media") {
          await expect(page.getByRole("heading", { name: "No media found" })).toBeVisible();
          const field = page.locator('[data-slot="empty-state"] [data-slot="dither-field"]');
          await expect(field).toBeVisible();
          await page.emulateMedia({ forcedColors: "active" });
          await expect(field).toBeHidden();
          await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
          await page.emulateMedia({ forcedColors: "none" });
        }
        if (surface.name === "publications") {
          await expect(page.getByText(publication, { exact: true }).first()).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `.impeccable/review/dither-default/${surface.name}-${width}-${scheme}.png`,
          animations: "disabled",
          fullPage: true,
        });
      }
    }
  }
  await assignBuiltInTheme(request, token, workspace.id, "workshop");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/media");
  await expect(page.locator("html")).toHaveAttribute("data-theme-id", "workshop");
  await expect(page.getByRole("heading", { name: "No media found" })).toBeVisible();
  await page.screenshot({
    path: ".impeccable/review/dither-default/before-workshop-media.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
