import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Messages distinguishes archived filters from account setup and clears them with the keyboard", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const { token } = await registerUser(request, `messages-recovery-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, token, "Messages recovery");
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','messages-test','bluesky','${accountID}','Audit messages',X'00',1);
     INSERT INTO account_features (social_account_id,workspace_id,feature,enabled,decided_at) VALUES ('${accountID}','${workspace.id}','messaging',1,CURRENT_TIMESTAMP);`,
  ]);
  const headers = { Authorization: `Bearer ${token}` };
  const featuresURL = `/api/v1/account-features?workspace_id=${workspace.id}&account_ids=${accountID}`;
  const featuresBefore = await request.get(featuresURL, { headers });
  expect(featuresBefore.ok()).toBe(true);
  const features = await featuresBefore.json();
  expect(features).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        social_account_id: accountID,
        feature: "messaging",
        supported: true,
        effective_enabled: true,
      }),
    ]),
  );
  await authenticatePage(page, token);
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/") && !["GET", "HEAD"].includes(req.method()))
      writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/inbox/messages");
  await expect(
    page.getByRole("heading", { name: "No conversations yet", exact: true }),
  ).toBeVisible();
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      await expect(page.locator("html")).toHaveCSS("color-scheme", scheme);
      await page.getByRole("button", { name: "All platforms", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("option", { name: "Bluesky", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "No matching conversations", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "All accounts", exact: true }).click();
      await page.getByRole("option", { name: /Audit messages/ }).click();
      await page.getByRole("checkbox", { name: "Archived", exact: true }).focus();
      await page.keyboard.press("Space");
      await expect(page.getByRole("checkbox", { name: "Archived", exact: true })).toBeChecked();
      await expect(
        page.getByRole("heading", { name: "No archived conversations", exact: true }),
      ).toBeVisible();
      const reset = page.getByRole("button", { name: "Clear filters", exact: true });
      await reset.focus();
      await expect(reset).toBeFocused();
      if (width < 768) {
        const bounds = await reset.boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath(`archived-${width}-${scheme}.png`) });
      await page.keyboard.press("Enter");
      await expect(page.getByRole("checkbox", { name: "Archived", exact: true })).not.toBeChecked();
      await expect(page.getByRole("button", { name: "All accounts", exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "No conversations yet", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "All platforms", exact: true })).toHaveText(
        "All platforms",
      );
      await expect(
        page.getByRole("link", { name: "Open account details", exact: true }),
      ).toHaveAttribute("href", "/settings?tab=accounts");
      await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.screenshot({ path: testInfo.outputPath(`setup-${width}-${scheme}.png`) });
    }
  }
  const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  execFileSync("sqlite3", [
    databasePath,
    `UPDATE account_features SET enabled=0 WHERE social_account_id='${accountID}' AND feature='messaging';`,
  ]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Direct messages are off", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page.getByRole("option", { name: /Audit messages/ }).click();
  const archivedRead = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/messages" && url.searchParams.get("archived") === "true";
  });
  await page.getByRole("checkbox", { name: "Archived", exact: true }).check();
  expect((await archivedRead).ok()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Direct messages are off", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open account details", exact: true }),
  ).toHaveAttribute("href", "/settings?tab=accounts");
  await page.screenshot({ path: testInfo.outputPath("disabled-filters-320-dark.png") });
  execFileSync("sqlite3", [
    databasePath,
    `UPDATE account_features SET enabled=1 WHERE social_account_id='${accountID}' AND feature='messaging';`,
  ]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No conversations yet", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open account details", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\?tab=accounts$/);
  await expect(page.getByRole("heading", { name: "Social accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /@Audit messages.*Bluesky/ })).toBeVisible();
  const featuresAfter = await request.get(featuresURL, { headers });
  expect(featuresAfter.ok()).toBe(true);
  expect(await featuresAfter.json()).toEqual(features);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
