import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

// Keep the visual sweep on network assets. PWA lifecycle has its own browser suite.
test.use({ serviceWorkers: "block" });

test.describe("touch theme controls", () => {
  test.use({ hasTouch: true });
  test("custom Dither colors survive undo, publish, assignment, and reload", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { token } = await registerUser(request, `dither-accent-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Custom Dither");
    const created = await request.post("/api/v1/themes", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        organization_id: workspace.organization_id,
        name: "Dither violet",
        duplicate_built_in_id: "dither",
      },
    });
    expect(created.ok()).toBe(true);
    await authenticatePage(page, token);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings?tab=appearance");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const hue = page.getByRole("spinbutton", {
      name: "Accent hue",
      exact: true,
    });
    await expect(hue).toHaveValue("45");
    await hue.fill("305");
    await expect(page.getByRole("slider", { name: "Accent hue" })).toHaveAttribute(
      "aria-valuenow",
      "305",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(hue).toHaveValue("45");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(hue).toHaveValue("305");
    await page.getByRole("button", { name: "Choose Canvas color", exact: true }).click();
    const hex = page.getByRole("textbox", { name: "Hex color", exact: true });
    await hex.fill("#faf9fc");
    await hex.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Canvas", exact: true })).toHaveValue("#faf9fc");
    const saved = page.waitForResponse(
      (response) => response.url().endsWith("/draft") && response.request().method() === "PUT",
    );
    const published = page.waitForResponse(
      (response) => response.url().endsWith("/publish") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
    expect((await published).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Apply Dither violet", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Applied Dither violet", exact: true }),
    ).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      await expect
        .poll(() =>
          page.locator("html").evaluate((el) => el.style.getPropertyValue("--action-focal")),
        )
        .toContain("305");
    }
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(hue).toHaveValue("305");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(page.locator('iframe[aria-busy="true"]')).toHaveCount(0);
      await expect(page.getByTestId("theme-preview")).toHaveCSS("opacity", "1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page
        .getByRole("region", { name: "Accent hue", exact: true })
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      for (const control of [
        hue,
        page.getByRole("slider", { name: "Accent hue" }),
        page.getByRole("button", { name: "Choose Canvas color", exact: true }),
      ]) {
        const box = await control.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: `.impeccable/review/dither-polish/custom-accent-${width}.png`,
      });
      await page.getByRole("button", { name: "Choose Canvas color", exact: true }).click();
      await expect(hex).toBeVisible();
      await page.screenshot({
        path: `.impeccable/review/dither-polish/color-picker-${width}.png`,
      });
      await page.keyboard.press("Escape");
    }
  });
});
