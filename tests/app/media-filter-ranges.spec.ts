import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Media filters retain reversed ranges for correction and admit valid bounds", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `filter-range-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Filter range validation");
  await authenticatePage(page, auth.token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/media");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Filters", exact: true });
  await dialog.getByText("Dimensions and date", { exact: true }).click();
  const minWidth = dialog.getByRole("spinbutton", { name: "Min width", exact: true });
  const maxWidth = dialog.getByRole("spinbutton", { name: "Max width", exact: true });
  const minHeight = dialog.getByRole("spinbutton", { name: "Min height", exact: true });
  const maxHeight = dialog.getByRole("spinbutton", { name: "Max height", exact: true });
  const from = dialog.getByLabel("From", { exact: true });
  const to = dialog.getByLabel("To", { exact: true });
  const apply = dialog.getByRole("button", { name: "Apply filters", exact: true });
  await minWidth.fill("641");
  await maxWidth.fill("640");
  await maxWidth.press("Tab");
  await page.screenshot({ path: testInfo.outputPath("reversed-width.png") });
  await expect(apply).toBeDisabled();
  await expect(maxWidth).toHaveValue("640");
  await expect(maxWidth).toHaveAttribute("aria-invalid", "true");
  await expect(maxWidth).toHaveAccessibleDescription(/Minimum dimensions/);
  await dialog.getByText("Dimensions and date", { exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(apply).toBeDisabled();
  await dialog.getByText("Dimensions and date", { exact: true }).click();
  await maxWidth.fill("641");
  await expect(apply).toBeEnabled();
  await maxWidth.fill("0");
  await expect(apply).toBeEnabled();
  await minHeight.fill("481");
  await maxHeight.fill("480");
  await expect(apply).toBeDisabled();
  await expect(minHeight).toHaveAccessibleDescription(/Minimum dimensions/);
  await maxHeight.fill("481");
  await from.fill("2026-09-30");
  await to.fill("2026-09-29");
  await expect(apply).toBeDisabled();
  await expect(to).toHaveValue("2026-09-29");
  await expect(to).toHaveAccessibleDescription(/To date must/);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
      .toBe(scheme === "dark");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await to.scrollIntoViewIfNeeded();
      await expect(apply).toBeDisabled();
      await to.focus();
      await expect(to).toBeFocused();
      await dialog.getByRole("alert").scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("alert")).toBeInViewport();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`range-${width}-${scheme}.png`),
      });
    }
  }
  await to.fill("2026-09-30");
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await dialog.getByText("Dimensions and date", { exact: true }).click();
  await expect(minWidth).toHaveValue("641");
  await expect(maxWidth).toHaveValue("0");
  await expect(to).toHaveValue("2026-09-30");
  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
