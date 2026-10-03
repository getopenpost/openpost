import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Media distinguishes matching inventory from workspace storage", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `media-scope-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Media summary scopes");
  for (const [name, path, mimeType] of [
    [
      "matching-picture.png",
      "tests/app/fixtures/product-screenshots/openpost-logo.png",
      "image/png",
    ],
    ["other-video.mp4", "tests/app/fixtures/product-screenshots/study-sos-demo.mp4", "video/mp4"],
  ]) {
    const response = await request.post("/api/v1/media/upload", {
      headers: { Authorization: `Bearer ${auth.token}` },
      multipart: {
        workspace_id: workspace.id,
        file: { name, mimeType, buffer: await readFile(path) },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await authenticatePage(page, auth.token);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/media");
  const summary = page.getByText(
    /^Matching assets: [12] · Workspace storage:|^[12] assets · .* stored/,
  );
  await expect(summary).toContainText(/(?:2 assets|Matching assets: 2)/);
  const workspaceSize =
    (await summary.innerText()).match(/\d+(?:\.\d+)? (?:B|KB|MB|GB)/)?.[0] ?? "";
  expect(workspaceSize).toBeTruthy();
  const search = page.getByRole("textbox", { name: "Search filename or alt text" });
  await search.fill("matching-picture");
  await search.press("Enter");
  await expect(page.getByTestId("media-result-count")).toContainText("1 result");
  await page.screenshot({ path: testInfo.outputPath("filtered-summary-before-assertion.png") });
  await expect(page.getByText(/^Matching assets: 1 · Workspace storage:/)).toBeVisible();
  await expect(summary).toContainText(workspaceSize);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
      .toBe(scheme === "dark");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(page.getByText(/^Matching assets: 1 · Workspace storage:/)).toBeInViewport();
      await search.focus();
      await expect(search).toBeFocused();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`summary-${width}-${scheme}.png`),
      });
    }
  }
  await search.fill("");
  await search.press("Enter");
  await expect(page.getByText(/^Matching assets: 2 · Workspace storage:/)).toBeVisible();
  expect(errors).toEqual([]);
});
