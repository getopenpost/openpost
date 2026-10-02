import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.use({ serviceWorkers: "block" });

test("profile resizing keeps recent activity visible and older dates keyboard reachable", async ({
  page,
  request,
}, testInfo) => {
  const { token } = await registerUser(request, `profile-resize-${randomUUID()}@example.com`);
  await createWorkspace(request, token, "Profile resizing");
  const headers = { Authorization: `Bearer ${token}` };
  const saved = await request.patch("/api/v1/auth/profile", {
    headers,
    data: {
      display_name: "Audit profile resizing",
      public_profile_enabled: true,
      public_profile_visible_fields: ["display_name", "activity"],
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const identity = await (await request.get("/api/v1/auth/me", { headers })).json();
  await authenticatePage(page, token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const scheme of ["light", "dark"] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/u/${identity.username}`);
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Audit profile resizing", exact: true }),
    ).toBeVisible();
    const scroller = page.locator(".activity-scroll");
    const latest = scroller.locator("i[title]").last();
    for (const width of [320, 390, 1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(async () =>
          latest.evaluate((el) => {
            const parent = el.closest(".activity-scroll")!.getBoundingClientRect();
            const cell = el.getBoundingClientRect();
            return cell.left >= parent.left && cell.right <= parent.right + 1;
          }),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await scroller.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`resize-${width}-${scheme}.png`) });
    }
    await scroller.focus();
    await expect(scroller).toBeFocused();
    for (let index = 0; index < 24; index += 1) await page.keyboard.press("ArrowLeft");
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);
    await page.setViewportSize({ width: 390, height: 900 });
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);
    for (let index = 0; index < 24; index += 1) await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () =>
        latest.evaluate((el) => {
          const parent = el.closest(".activity-scroll")!.getBoundingClientRect();
          return el.getBoundingClientRect().right <= parent.right + 1;
        }),
      )
      .toBe(true);
    await page.reload();
    await expect
      .poll(async () =>
        latest.evaluate((el) => {
          const parent = el.closest(".activity-scroll")!.getBoundingClientRect();
          return el.getBoundingClientRect().right <= parent.right + 1;
        }),
      )
      .toBe(true);
  }
  expect(errors).toEqual([]);
});
