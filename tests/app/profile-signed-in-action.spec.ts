import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.use({ serviceWorkers: "block" });

test("public profile header sends signed-in viewers to their own profile settings", async ({
  page,
  request,
}, testInfo) => {
  const owner = await registerUser(request, `profile-owner-${randomUUID()}@example.com`);
  await createWorkspace(request, owner.token, "Profile owner");
  const headers = { Authorization: `Bearer ${owner.token}` };
  expect(
    (
      await request.patch("/api/v1/auth/profile", {
        headers,
        data: {
          display_name: "Audit public owner",
          public_profile_enabled: true,
          public_profile_visible_fields: ["display_name"],
        },
      })
    ).ok(),
  ).toBe(true);
  const identity = await (await request.get("/api/v1/auth/me", { headers })).json();
  const viewer = await registerUser(request, `profile-viewer-${randomUUID()}@example.com`);
  await createWorkspace(request, viewer.token, "Profile viewer");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const actor of [owner, viewer]) {
    const actorIdentity = await (
      await request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${actor.token}` } })
    ).json();
    await authenticatePage(page, actor.token);
    for (const width of [1280, 390, 320]) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/u/${identity.username}`);
        await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "Audit public owner", exact: true }),
        ).toBeVisible();
        const action = page.locator("header").getByRole("link", { name: "Profile", exact: true });
        await expect(action).toHaveAttribute("href", "/settings?tab=profile");
        await expect(
          page.getByRole("link", { name: "Create your profile", exact: true }),
        ).toHaveCount(0);
        await action.focus();
        await expect(action).toBeFocused();
        await page.screenshot({
          path: testInfo.outputPath(
            `${actor === owner ? "owner" : "viewer"}-${width}-${scheme}.png`,
          ),
        });
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/settings\?tab=profile$/);
        const me = await (await page.request.get("/api/v1/auth/me")).json();
        expect(me.id).toBe(actorIdentity.id);
      }
    }
  }
  await page.context().clearCookies();
  await page.goto(`/u/${identity.username}`);
  await expect(
    page.getByRole("heading", { name: "Audit public owner", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("header").getByRole("link", { name: "Create your profile", exact: true }),
  ).toHaveAttribute("href", "/register");
  await expect(
    page.locator("header").getByRole("link", { name: "Profile", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither");
  expect(errors).toEqual([]);
});
