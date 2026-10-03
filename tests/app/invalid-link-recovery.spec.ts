import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const path of ["/invite", "/cli/authorize", "/preview"]) {
  test(`incomplete ${path} links offer keyboard recovery without requests`, async ({
    page,
    request,
  }, info) => {
    const auth = await registerUser(request, `invalid-links-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Invalid Links");
    await authenticatePage(page, auth.token);
    await page.goto("/invite");
    const forbidden: string[] = [];
    page.on("request", (request) => {
      if (/workspace-invitations|cli\/auth\/(session|approve|deny)/.test(request.url()))
        forbidden.push(request.url());
    });
    for (const width of [1280, 390, 320]) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 850 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const recovery = page.getByRole("link", {
          name: path === "/preview" ? "Open composer" : "Return to OpenPost",
          exact: true,
        });
        await page.screenshot({
          path: info.outputPath(`${path.replaceAll("/", "-")}-${width}-${scheme}.png`),
        });
        await expect(recovery).toBeVisible();
        await expect(recovery).toHaveAttribute("href", "/");
        await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
        await recovery.focus();
        await expect(recovery).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/$/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      }
    }
    expect(forbidden).toEqual([]);
  });
}
