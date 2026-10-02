import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("publication tab selection keeps the visible URL, reload and history in agreement", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const auth = await registerUser(request, `tab-history-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Tab history");
  await authenticatePage(page, auth.token);
  await page.goto("/publications");
  const scheduled = page.getByRole("tab", { name: "Scheduled", exact: true });
  const published = page.getByRole("tab", { name: "Published", exact: true });
  await expect(scheduled).toHaveAttribute("aria-selected", "true");
  await published.click();
  await expect(published).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/publications\?tab=published$/);
  await scheduled.focus();
  await page.keyboard.press("Enter");
  await expect(scheduled).toHaveAttribute("aria-selected", "true");
  await testInfo.attach("selected-before-reload", {
    contentType: "application/json",
    body: JSON.stringify({
      url: page.url(),
      scheduledSelected: await scheduled.getAttribute("aria-selected"),
    }),
  });
  await page.screenshot({ path: testInfo.outputPath("scheduled-before-reload.png") });
  await expect(page).toHaveURL(/\/publications$/);
  await page.reload();
  await page.screenshot({ path: testInfo.outputPath("after-reload.png") });
  await expect(scheduled).toHaveAttribute("aria-selected", "true");

  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      await expect(page.locator("html")).toHaveCSS("color-scheme", scheme);
      await expect(scheduled).toHaveAttribute("aria-selected", "true");
      await published.click();
      await expect(page).toHaveURL(/\/publications\?tab=published$/);
      await scheduled.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/publications$/);
      await expect(scheduled).toBeFocused();
      await expect(scheduled).toHaveAttribute("aria-selected", "true");
      await page.reload();
      await expect(scheduled).toHaveAttribute("aria-selected", "true");
      await page.screenshot({ path: testInfo.outputPath(`scheduled-${width}-${scheme}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  }

  const failed = page.getByRole("tab", { name: "Failed", exact: true });
  const view = page.getByRole("navigation", { name: "Publication view" });
  await page.goto("/publications?tab=failed");
  await expect(failed).toHaveAttribute("aria-selected", "true");
  await view.getByRole("link", { name: "Calendar", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(view.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await view.getByRole("link", { name: "List", exact: true }).click();
  await expect(page).toHaveURL(/\/publications\?tab=failed$/);
  await expect(failed).toHaveAttribute("aria-selected", "true");
  await published.click();
  await expect(page).toHaveURL(/\/publications\?tab=published$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(view.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/publications\?tab=failed$/);
  await expect(failed).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(view.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goForward();
  await expect(page).toHaveURL(/\/publications\?tab=published$/);
  await expect(published).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(published).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});
