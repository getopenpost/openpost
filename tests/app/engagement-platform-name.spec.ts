import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Inbox platform filter announces its selected platform and keyboard reset", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `platform-name-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Platform filter name");
  await page.route(/\/api\/v1\/accounts(?:\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      json: ["linkedin", "bluesky"].map((platform) => ({
        id: randomUUID(),
        workspace_id: workspace.id,
        platform,
        account_username: `Audit ${platform}`,
        is_active: true,
      })),
    }),
  );
  await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/engagement?**", (route) =>
    route.fulfill({ json: { items: [], total: 0, sync_states: [] } }),
  );
  await authenticatePage(page, auth.token);
  const writes: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/") && !["GET", "HEAD"].includes(req.method()))
      writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  await page.goto("/inbox/engagement");
  const platform = page.getByRole("button").filter({ hasText: /All platforms|LinkedIn|Bluesky/ });
  await expect(platform).toHaveAccessibleName("All platforms");
  await platform.click();
  await page.getByRole("option", { name: "LinkedIn", exact: true }).click();
  await expect(platform).toHaveText("LinkedIn");
  await page.screenshot({ path: testInfo.outputPath("selected-before-assertion.png") });
  await expect(platform).toHaveAccessibleName("LinkedIn");
  await platform.focus();
  await platform.press("Enter");
  await expect(page.getByRole("option", { name: "All platforms", exact: true })).toBeVisible();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(platform).toHaveAccessibleName("All platforms");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
      .toBe(scheme === "dark");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await platform.click();
      await page.getByRole("option", { name: "Bluesky", exact: true }).click();
      await expect(platform).toHaveAccessibleName("Bluesky");
      await expect(platform).toBeFocused();
      await expect(platform).toBeInViewport();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`platform-${width}-${scheme}.png`),
      });
    }
  }
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});
