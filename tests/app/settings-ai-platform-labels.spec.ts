import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("AI prompt destinations use the same provider names in navigation and selected content", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `prompt-label-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Prompt labels");
  const me = await request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(me.ok()).toBe(true);
  const { id } = await me.json();
  const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    database,
    `UPDATE users SET is_admin = 1 WHERE id = '${id}';`,
  ]);
  await authenticatePage(page, auth.token);
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/admin/ai-prompts") && req.method() !== "GET")
      writes.push(req.method());
  });
  const providers = ["Pixelfed", "PeerTube", "Lemmy", "PieFed"];
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page
        .evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme)
        .catch(() => undefined);
      await page.goto("/settings?tab=ai-prompts");
      const navigation = page.getByRole("complementary", { name: "AI prompts", exact: true });
      await expect(navigation).toBeVisible();
      await page.screenshot({ path: info.outputPath(`entry-${width}-${scheme}.png`) });
      for (const provider of providers) {
        if (width >= 1024) {
          const choice = navigation.getByRole("button", { name: provider, exact: true });
          await expect(choice).toBeVisible();
          await choice.focus();
          await page.keyboard.press("Enter");
        } else {
          const choice = navigation.getByRole("button", { name: "AI prompts", exact: true });
          await choice.focus();
          await page.keyboard.press("Enter");
          await page.getByRole("option", { name: provider, exact: true }).click();
        }
        await expect(page.getByRole("heading", { name: provider, exact: true })).toBeVisible();
        await expect(
          page.getByText(`Instructions added when OpenPost generates a ${provider} rendition.`, {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("textbox", { name: "Prompt instructions", exact: true }),
        ).not.toHaveValue("");
      }
      await page.screenshot({ path: info.outputPath(`selected-${width}-${scheme}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  expect(writes).toEqual([]);
});
