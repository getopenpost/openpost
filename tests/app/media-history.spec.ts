import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Media history retains submitted discovery independently from unfinished search", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const auth = await registerUser(request, `media-history-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Media history");
  const tagID = randomUUID();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push(`${message.location().url}: ${message.text()}`);
  });
  const mediaIDs = Array.from({ length: 42 }, () => randomUUID());
  const rows = Array.from(
    { length: 41 },
    (_, index) =>
      `('${mediaIDs[index]}','${workspace.id}','synthetic-read-only.mp4','video/mp4','video','Audit return ${String(index).padStart(2, "0")}.mp4',320,320,'1:1',10)`,
  );
  rows.push(
    `('${mediaIDs[41]}','${workspace.id}','synthetic-read-only.mp4','video/mp4','video','Audit return landscape.mp4',640,360,'16:9',10)`,
  );
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO media_attachments (id,workspace_id,file_path,mime_type,dominant_type,original_filename,width,height,aspect_ratio,size) VALUES ${rows.join(",")}; INSERT INTO media_tags(id,workspace_id,name,normalized_name) VALUES ('${tagID}','${workspace.id}','Audit discovery tag','audit discovery tag'); INSERT INTO media_tag_assignments(tag_id,media_id) SELECT '${tagID}',id FROM media_attachments WHERE workspace_id='${workspace.id}';`,
  ]);
  const poster = await request.post("/api/v1/media/upload", {
    headers: { Authorization: `Bearer ${auth.token}` },
    multipart: {
      workspace_id: workspace.id,
      file: {
        name: "audit-history-poster.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    },
  });
  expect(poster.ok(), await poster.text()).toBe(true);
  const posterMedia = await poster.json();
  const fixtureDatabase = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  const posterFile = execFileSync(
    "sqlite3",
    [fixtureDatabase, `SELECT file_path FROM media_attachments WHERE id='${posterMedia.id}';`],
    { encoding: "utf8" },
  ).trim();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    fixtureDatabase,
    `UPDATE media_attachments SET thumbnail_object_key='${basename(posterFile)}' WHERE workspace_id='${workspace.id}' AND dominant_type='video';`,
  ]);
  await authenticatePage(page, auth.token);
  await page.goto("/media");
  const search = page.getByRole("textbox", { name: "Search filename or alt text", exact: true });
  async function applyDiscovery() {
    await search.fill("Audit return");
    await search.press("Enter");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Type", exact: true }).click();
    await page.getByRole("option", { name: "Videos", exact: true }).click();
    await dialog.getByRole("button", { name: "Aspect ratio", exact: true }).click();
    await page.getByRole("option", { name: "Square", exact: true }).click();
    await dialog.getByRole("button", { name: /^Audit discovery tag/ }).click();
    await dialog.getByRole("button", { name: "Apply filters", exact: true }).click();
    await page.getByRole("button", { name: "Newest", exact: true }).click();
    await page.getByRole("option", { name: "Name", exact: true }).click();
    await page.getByRole("button", { name: "Compact list view", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Audit return 40.mp4", { exact: true })).toBeVisible();
    await search.fill("Unsubmitted café 東京");
  }
  await applyDiscovery();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select Audit return 40.mp4", exact: true }).click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("before-navigation.png") });
  const templates = page.getByRole("link", { name: "Templates", exact: true });
  await templates.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByRole("heading", { name: "Templates", exact: true })).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("Unsubmitted café 東京");
  await expect(page.getByText("Audit return 40.mp4", { exact: true })).toBeVisible();
  await expect(page.getByText("Audit return landscape.mp4", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toContainText("3");
  await expect(page.getByRole("button", { name: "Grid view", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Name", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select", exact: true })).toBeVisible();
  await expect(page.getByText("1 selected", { exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("after-back.png") });
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload();
      if (scheme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      await expect(search).toHaveValue("");
      await expect(page.getByRole("button", { name: "Newest", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Compact list view", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Audit discovery tag/ })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await page.keyboard.press("Escape");
      await applyDiscovery();
      await page.setViewportSize({ width, height: 900 });
      await templates.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/templates$/);
      await expect(page.getByRole("heading", { name: "Templates", exact: true })).toBeVisible();
      await page.goBack();
      await expect(search).toHaveValue("Unsubmitted café 東京");
      await expect(page.getByText("Audit return 40.mp4", { exact: true })).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(/\/templates$/);
      await expect(page.getByRole("heading", { name: "Templates", exact: true })).toBeVisible();
      await page.goBack();
      await expect(search).toHaveValue("Unsubmitted café 東京");
      await expect(page.getByText("Audit return 40.mp4", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.screenshot({ path: testInfo.outputPath(`history-${width}-${scheme}.png`) });
    }
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Media history never restores another workspace or actor discovery", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `media-scope-${randomUUID()}@example.com`);
  const first = await createWorkspace(request, auth.token, "History first");
  await createWorkspace(request, auth.token, "History second");
  await authenticatePage(page, auth.token);
  await page.goto("/media");
  const search = page.getByRole("textbox", { name: "Search filename or alt text", exact: true });
  const switcher = page.getByRole("button", {
    name: "Switch workspace: History first",
    exact: true,
  });
  await expect(switcher).toBeVisible();
  await search.fill("First workspace discovery");
  await search.press("Enter");
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await switcher.click();
  await page.getByRole("menuitem", { name: /History second/ }).click();
  await expect(
    page.getByRole("button", { name: "Switch workspace: History second", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("");
  await page.getByRole("button", { name: "Switch workspace: History second", exact: true }).click();
  await page.getByRole("menuitem", { name: /History first/ }).click();
  await expect(search).toHaveValue("");
  await search.fill("Original actor discovery");
  await search.press("Enter");
  await page.getByRole("link", { name: "Templates", exact: true }).click();

  const otherEmail = `media-other-${randomUUID()}@example.com`;
  const other = await registerUser(request, otherEmail);
  const profile = await request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${other.token}` },
  });
  expect(profile.ok()).toBe(true);
  const user = await profile.json();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES ('${first.id}','${user.id}','editor','active');`,
  ]);
  await authenticatePage(page, other.token);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Switch workspace: History first", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("button", { name: "Newest", exact: true })).toBeVisible();
});
