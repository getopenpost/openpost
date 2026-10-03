import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

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
  const view = page.getByRole("navigation", { name: "Post view" });
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

test("published detail Back retains explicit Published scope after Drafts entry", async ({
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
  const auth = await registerUser(request, `detail-history-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Detail history");
  const publishedText = "Audit published detail return";
  const draftText = "Audit unrelated draft scope";
  const publication = await createPublication(request, auth.token, workspace.id, publishedText);
  await createPublication(request, auth.token, workspace.id, draftText);
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `UPDATE publications SET status='published',actual_run_at='2026-10-02 15:11:00+00:00' WHERE id='${publication.id}';`,
  ]);
  await authenticatePage(page, auth.token);
  const published = page.getByRole("tab", { name: "Published", exact: true });
  await page.goto("/publications?tab=drafts");
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.goto("/publications?tab=drafts");
      await expect(page.getByRole("tab", { name: "Drafts", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await published.click();
      await expect(page).toHaveURL(/\/publications\?tab=published$/);
      const publishedLink = page.getByRole("link", { name: publishedText, exact: true });
      await publishedLink.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: publishedText, exact: true, level: 1 }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Copy as draft", exact: true })).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: publishedText, exact: true, level: 1 }),
      ).toBeVisible();
      const back = page.getByRole("button", { name: "Back", exact: true });
      await back.focus();
      await expect(back).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`detail-${width}-${scheme}.png`) });
      if (width === 1280) await back.click();
      else await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/publications\?tab=published$/);
      await expect(published).toHaveAttribute("aria-selected", "true");
      await expect(publishedLink).toBeVisible();
      await expect(page.getByTestId("publication-list")).not.toContainText(draftText);
      await page.screenshot({ path: testInfo.outputPath(`detail-back-${width}-${scheme}.png`) });
      await publishedLink.click();
      await expect(
        page.getByRole("heading", { name: publishedText, exact: true, level: 1 }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/publications\?tab=published$/);
      await expect(published).toHaveAttribute("aria-selected", "true");
      await page.reload();
      await expect(published).toHaveAttribute("aria-selected", "true");
      await expect(publishedLink).toBeVisible();
      await expect(page.getByTestId("publication-list")).not.toContainText(draftText);
    }
  }
  const unchanged = await request.get(
    `/api/v1/publications/${publication.id}?workspace_id=${workspace.id}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(unchanged.ok()).toBe(true);
  expect(await unchanged.json()).toMatchObject({
    status: "published",
    revision: 1,
    actual_run_at: "2026-10-02T15:11:00Z",
  });

  expect(errors).toEqual([]);
});
