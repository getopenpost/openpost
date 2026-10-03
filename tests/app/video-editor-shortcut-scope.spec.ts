import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Program shuttle runs outside Source and focused playhead sliders keep their keys", async ({
  page,
  request,
}, info) => {
  test.setTimeout(90_000);
  const auth = await registerUser(request, `shuttle-scope-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Shuttle scope");
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[\da-f-]+\?storage=cloud/);
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Assets", exact: true })
    .getByRole("button", { name: "Add layer", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  const program = page.getByRole("application", { name: "Program", exact: true });
  const position = page.getByRole("slider", { name: "Timeline playhead", exact: true });
  await program.focus();
  await page.keyboard.press("l");
  await expect
    .poll(async () => Number(await position.getAttribute("aria-valuenow")))
    .toBeGreaterThan(10);
  await page.keyboard.press("k");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const paused = Number(await position.getAttribute("aria-valuenow"));
  await position.focus();
  await page.keyboard.press("l");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(Number(await position.getAttribute("aria-valuenow"))).toBe(paused);
  await program.focus();
  await page.keyboard.press("j");
  await expect
    .poll(async () => Number(await position.getAttribute("aria-valuenow")))
    .toBeLessThan(paused);
  await page.keyboard.press("k");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("program-shuttle-guard.png") });
});
