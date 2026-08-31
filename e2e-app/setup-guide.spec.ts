import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("an incomplete owner sees server-derived setup guidance in the composer and Accounts after sign-in and refresh", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `setup-guide-${unique}@example.com`);
  await createWorkspace(request, auth.token, `Setup guide ${unique}`);

  await authenticatePage(page, auth.token);
  await page.goto("/");

  const composerGuide = page.getByTestId("workspace-setup-guide-composer");
  await expect(page.getByTestId("workspace-setup-guide-home")).toHaveCount(0);
  await expect(composerGuide).toBeVisible();
  await expect(composerGuide).toContainText("1 of 4 complete");
  await expect(composerGuide).toContainText("Connect a destination");
  await expect(composerGuide).not.toContainText("Plan");
  await expect(composerGuide.getByRole("link", { name: "Resume checkout" })).toHaveCount(0);
  await expect(composerGuide.getByRole("link", { name: "Connect a destination" })).toHaveAttribute(
    "href",
    "/settings?tab=accounts",
  );
  await page.reload();
  await expect(composerGuide).toBeVisible();
  await expect(composerGuide).toContainText("1 of 4 complete");

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(composerGuide).toContainText("1 of 4 complete");
  await page.goto("/settings?tab=accounts");
  const accountsGuide = page.getByTestId("workspace-setup-guide-accounts");
  await expect(accountsGuide).toBeVisible();
  await expect(accountsGuide).toContainText("Connect a destination");
  await expect(accountsGuide).not.toContainText("Plan");
  await expect(accountsGuide.getByRole("link", { name: "Resume checkout" })).toHaveCount(0);
  await expect(page.getByText("Step 2 of 3")).toHaveCount(0);

  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(composerGuide).toBeVisible();
  await expect(composerGuide).toContainText("Connect a destination");
});
