import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.use({ hasTouch: true });

// A connected account and a stored external post keep this acceptance flow
// independent of real provider credentials. Setting changes use the real API.
test("account details expose new-provider imports and keep X disabled", async ({
  page,
  request,
}, testInfo) => {
  const { token } = await registerUser(request, `post-imports-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, token, "Imports acceptance");
  const accountID = randomUUID();
  const xID = randomUUID();
  const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  const sql = (statement: string) =>
    execFileSync("sqlite3", ["-cmd", ".timeout 5000", database, statement]);
  sql(`INSERT INTO social_accounts (id, workspace_id, slug, platform, account_id, account_username, access_token_encrypted, granted_scopes, is_active, created_at)
    VALUES ('${accountID}', '${workspace.id}', 'threads-imports', 'threads', '42', 'imports-owner', X'00', 'threads_basic', 1, datetime('now')),
    ('${xID}', '${workspace.id}', 'x-imports', 'x', '43', 'x-owner', X'00', '', 1, datetime('now'));`);
  await authenticatePage(page, token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/settings?tab=accounts");
  const openDetails = async (id: string) => {
    await page.getByTestId(`account-card-${id}`).getByRole("button").click();
    await page.getByRole("menuitem", { name: "Account details", exact: true }).click();
  };
  await openDetails(accountID);
  const drawer = page.getByTestId("account-settings-drawer");
  const imports = drawer.getByRole("region", { name: "Imported posts" });
  await expect(imports).toBeVisible();
  const before = testInfo.outputPath("threads-imports-before.png");
  await imports.screenshot({ path: before });
  const enable = imports.getByRole("button", { name: "Turn on", exact: true });
  await expect(enable).toBeEnabled();
  await enable.focus();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes(`/${accountID}/post-imports`),
  );
  await page.keyboard.press("Enter");
  expect((await saved).status()).toBe(200);
  await expect(imports.getByRole("button", { name: "Turn off", exact: true })).toBeEnabled();
  sql(`INSERT INTO imported_posts (id, workspace_id, social_account_id, platform, provider_post_id, title, text, external_url, published_at, origin, first_seen_at, last_seen_at, created_at, updated_at)
    VALUES ('${randomUUID()}', '${workspace.id}', '${accountID}', 'threads', 'native-new', '', 'A launch written directly on Threads.', 'https://www.threads.net/@imports-owner/post/native-new', datetime('now'), 'external', datetime('now'), datetime('now'), datetime('now'), datetime('now'));`);
  await page.keyboard.press("Escape");
  await page.reload();
  await openDetails(accountID);
  await expect(
    imports.getByRole("link", { name: "A launch written directly on Threads." }),
  ).toBeVisible();
  await imports.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeEnabled();
  await expect(
    imports.getByRole("link", { name: "A launch written directly on Threads." }),
  ).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await openDetails(accountID);
      await expect(
        imports.getByRole("link", { name: "A launch written directly on Threads." }),
      ).toBeVisible();
      await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      const toggle = imports.getByRole("button", { name: "Turn on", exact: true });
      const bounds = await toggle.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      if (width === 390 && scheme === "light") {
        await toggle.tap();
        const disable = imports.getByRole("button", { name: "Turn off", exact: true });
        await expect(disable).toBeEnabled();
        await disable.tap();
        await expect(toggle).toBeEnabled();
      }
      expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const screenshot = testInfo.outputPath(`threads-imports-${width}-${scheme}.png`);
      await imports.screenshot({ path: screenshot });
      await testInfo.attach(`${width}-${scheme}`, { path: screenshot, contentType: "image/png" });
      await page.keyboard.press("Escape");
    }
  }
  await openDetails(xID);
  await expect(
    imports.getByText("X imports are disabled by the provider read-cost policy."),
  ).toBeVisible();
  await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
