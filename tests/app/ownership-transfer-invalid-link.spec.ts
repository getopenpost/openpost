import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("an incomplete transfer keeps its explanation and never retries an absent ID", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `invalid-transfer-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Invalid Transfer");
  await authenticatePage(page, auth.token);
  const resolves: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("organization-ownership-transfers/resolve"))
      resolves.push(request.url());
  });
  await page.goto("/ownership-transfer");
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      const explanation = page.getByText("This ownership-transfer link is incomplete.", {
        exact: true,
      });
      await expect(explanation).toBeVisible();
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      if (await retry.count()) await retry.click();
      await page.screenshot({ path: info.outputPath(`transfer-${width}-${scheme}.png`) });
      await expect(explanation).toBeVisible();
      await expect(retry).toHaveCount(0);
      const recovery = page.getByRole("link", { name: "Return to OpenPost", exact: true });
      await recovery.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/$/);
      await page.goto("/ownership-transfer");
    }
  expect(resolves).toEqual([]);
  const transferID = randomUUID();
  await page.route("**/api/v1/organization-ownership-transfers/resolve?**", (route) =>
    route.fulfill({ status: 503, json: { detail: "Temporary local transfer failure" } }),
  );
  await page.goto(`/ownership-transfer?id=${transferID}`);
  await expect(page.getByText("Temporary local transfer failure", { exact: true })).toBeVisible();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => resolves.length).toBe(2);
  expect(resolves.every((url) => new URL(url).searchParams.get("id") === transferID)).toBe(true);
});
