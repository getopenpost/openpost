import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { authenticatePage, createWorkspace, registerUser } from "./helpers";

async function createVideoProject(page: Page, name = "Shared editor chrome"): Promise<string> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        if (!("queryPermission" in prototype)) {
          Object.defineProperty(prototype, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (!("requestPermission" in prototype)) {
          Object.defineProperty(prototype, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "This device" }).click();
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Custom project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 20_000,
  });
  return page.url();
}

async function verifySequenceAutoBalance(page: Page, errors: string[]): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  await expect(page.getByRole("application", { name: "Program" }).getByRole("img")).toBeVisible();
  const editTab = page.getByRole("tab", { name: "Edit", exact: true });
  const colorTab = page.getByRole("tab", { name: "Color", exact: true });
  await expect(editTab).toHaveAttribute("aria-selected", "true");
  await colorTab.click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("openpost-video-editor-workspace-v1")))
    .toBe("color");
  await expect(colorTab).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
  await expect(page.getByRole("region", { name: "Color grading" })).toBeVisible({
    timeout: 20_000,
  });
  const autoKey = page.getByRole("button", { name: "Toggle auto-keyframe" });
  await autoKey.click();
  await expect(autoKey).toHaveAttribute("aria-pressed", "true");
  const liftWheel = page.getByRole("slider", { name: "Lift color wheel" });
  await liftWheel.focus();
  await page.keyboard.press("ArrowRight");
  await expect(liftWheel).toHaveAttribute("aria-valuetext", /^1 degrees/);
  await page.getByRole("tab", { name: "Curves", exact: true }).click();
  const curve = page.locator('[role="group"][aria-label="Master curve editor"]:visible');
  const initialCurvePointCount = await curve.locator("[data-curve-point]").count();
  expect(initialCurvePointCount).toBeGreaterThanOrEqual(2);
  await curve.click({ position: { x: 75, y: 35 } });
  await expect(curve.locator("[data-curve-point]")).toHaveCount(initialCurvePointCount + 1);
  await page.getByRole("tab", { name: "Primaries", exact: true }).click();

  await editTab.click();
  await page.getByRole("banner").getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  const timelineItems = page.locator("[data-timeline-item-id]");
  await expect(timelineItems).toHaveCount(2);
  await timelineItems
    .locator('button[aria-pressed="false"]')
    .first()
    .click({
      modifiers: ["ControlOrMeta"],
    });
  await expect(timelineItems.locator('button[aria-pressed="true"]')).toHaveCount(2);
  await colorTab.click();
  await expect(page.getByRole("slider", { name: "Lift color wheel" })).toHaveAttribute(
    "aria-valuetext",
    "Mixed",
  );
  await page.getByRole("slider", { name: "Lift color wheel" }).press("ArrowRight");
  await expect(page.getByRole("slider", { name: "Lift color wheel" })).not.toHaveAttribute(
    "aria-valuetext",
    "Mixed",
  );
  await page
    .getByRole("group", { name: "Color workspace", exact: true })
    .getByRole("button", { name: "Sequence" })
    .click();
  await expect(page.locator("[data-color-target-label]")).toHaveText("Sequence: Main");
  await editTab.click();
  await colorTab.click();
  await expect(page.locator("[data-color-target-label]")).toHaveText("Sequence: Main");
  await page.getByRole("button", { name: "Add adjustment layer" }).click();
  await expect(page.getByRole("region", { name: "Color grading" })).toHaveAttribute(
    "data-sequence-grade-item-id",
    /.+/,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("button", { name: "Add adjustment layer" })).toBeVisible();
  await page.getByRole("button", { name: "Add adjustment layer" }).click();
  await page.getByRole("application", { name: "Program" }).click({ position: { x: 8, y: 8 } });
  await expect(page.locator('[data-scope-sample-ready="true"]')).toBeVisible();
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Auto balance from the current frame" }).click();
  await expect(page.getByText("Auto balance applied.")).toBeVisible({
    timeout: 5_000,
  });
}

test("Sequence Auto Balance samples the composed frame without changing clip selection", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  const { token } = await registerUser(
    request,
    `sequence-color-sampling-${randomUUID()}@example.com`,
  );
  await createWorkspace(request, token, "Sequence color sampling");
  await authenticatePage(page, token);
  await createVideoProject(page, "Sequence color sampling");
  await verifySequenceAutoBalance(page, errors);
  expect(errors).toEqual([]);
});
