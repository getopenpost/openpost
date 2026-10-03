import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Cloud history can inspect a saved version without restoring or changing the open project", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `video-inspect-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Video history inspection");
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Project name", exact: true });
  await title.fill("Earlier launch cut");
  await title.press("Tab");
  await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
    "data-state",
    "saved",
  );
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
  const openHistory = async () => {
    await page.locator("header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
    const history = page.getByRole("dialog", { name: "Version history", exact: true });
    await expect(history.getByText("Loading...", { exact: true })).toHaveCount(0);
    return history;
  };
  let history = await openHistory();
  await history.getByRole("textbox", { name: "Checkpoint name" }).fill("Before rename");
  await history.getByRole("button", { name: "Create checkpoint", exact: true }).click();
  await expect(history.getByText("Before rename", { exact: true })).toBeVisible();
  await history
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await title.fill("Current launch cut");
  await title.press("Tab");
  await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
    "data-state",
    "saved",
  );
  const read = async () => {
    const response = await request.get(
      `/api/v1/video-projects/${projectId}?workspace_id=${workspace.id}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const saved = await read();
  const trackIndex = saved.document.timeline.tracks.findIndex(
    (track: { id: string }) => track.id === "track-video-main",
  );
  expect(trackIndex).toBeGreaterThanOrEqual(0);
  const rename = await request.post(`/api/v1/video-projects/${projectId}/mutations`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      workspace_id: workspace.id,
      mutation_id: randomUUID(),
      base_revision: saved.head_revision,
      device_id: "inspection-fixture",
      operations: [
        {
          kind: "set",
          target: "track:track-video-main.name",
          path: `/timeline/tracks/${trackIndex}/name`,
          value: "Current release track",
        },
      ],
    },
  });
  expect(rename.ok()).toBe(true);
  expect((await rename.json()).outcome).toBe("applied");
  await page.reload();
  await expect(title).toHaveValue("Current launch cut");
  const before = await read();
  history = await openHistory();
  const row = history
    .getByRole("listitem")
    .filter({ has: page.getByText("Before rename", { exact: true }) });
  await page.screenshot({ path: testInfo.outputPath("history-before-inspection.png") });
  await row.getByRole("button", { name: "Inspect version", exact: true }).click();
  await expect(row.getByText("Earlier launch cut", { exact: true })).toBeVisible();
  await expect(row.getByText("Title changed", { exact: true })).toBeVisible();
  await expect(
    row.getByText("Tracks: 0 added, 0 removed, 1 changed", { exact: true }),
  ).toBeVisible();
  await row.getByText("Details", { exact: true }).focus();
  await row.getByText("Details", { exact: true }).press("Enter");
  await expect(row.getByText("Visual 1", { exact: true })).toBeVisible();
  await expect(
    row.getByText("Compared with the latest saved version.", { exact: true }),
  ).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
      .toBe(scheme === "dark");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await row.getByRole("button", { name: "Inspect version", exact: true }).focus();
      await expect(row.getByRole("button", { name: "Inspect version", exact: true })).toBeFocused();
      await row.scrollIntoViewIfNeeded();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`inspection-${width}-${scheme}.png`) });
    }
  }
  await row.getByRole("button", { name: "Inspect version", exact: true }).press("Enter");
  await expect(row.getByText("Earlier launch cut", { exact: true })).toHaveCount(0);
  await expect(await read()).toEqual(before);
  await history
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(title).toHaveValue("Current launch cut");
  await page.reload();
  history = await openHistory();
  await history
    .getByRole("listitem")
    .filter({ has: page.getByText("Before rename", { exact: true }) })
    .getByRole("button", { name: "Inspect version", exact: true })
    .click();
  await expect(history.getByText("Earlier launch cut", { exact: true })).toBeVisible();
  await expect(await read()).toEqual(before);
  const touchContext = await browser.newContext({
    viewport: { width: 320, height: 740 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touchContext.newPage();
  await authenticatePage(touchPage, auth.token);
  await touchPage.goto(`/video-editor/${projectId}?storage=cloud`);
  await touchPage.locator("header").getByRole("button", { name: "More actions" }).tap();
  await touchPage.getByRole("menuitem", { name: "Version history", exact: true }).tap();
  const touchRow = touchPage
    .getByRole("dialog", { name: "Version history", exact: true })
    .getByRole("listitem")
    .filter({ has: touchPage.getByText("Before rename", { exact: true }) });
  const inspect = touchRow.getByRole("button", { name: "Inspect version", exact: true });
  await expect
    .poll(async () => (await inspect.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(44);
  await inspect.tap();
  await expect(touchRow.getByText("Earlier launch cut", { exact: true })).toBeVisible();
  await touchPage.screenshot({ path: testInfo.outputPath("inspection-320-coarse.png") });
  await touchContext.close();
});
