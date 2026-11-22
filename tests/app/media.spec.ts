import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser, createPublication } from "./helpers";
import { execFileSync, execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

test.describe("media copies", () => {
  function silentWave() {
    const samples = 800;
    const bytes = Buffer.alloc(44 + samples * 2);
    bytes.write("RIFF", 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24);
    bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(samples * 2, 40);
    return bytes;
  }

  test("Ordinary Media copies preserve origin and show copy provenance across MIME types", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `media-copy-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Independent Media copies");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const files = [
      {
        name: "source.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      },
      {
        name: "source.mp4",
        mimeType: "video/mp4",
        buffer: await readFile("tests/app/fixtures/product-screenshots/study-sos-demo.mp4"),
      },
      { name: "source.wav", mimeType: "audio/wav", buffer: silentWave() },
    ];
    const originals = [];
    for (const file of files) {
      const response = await request.post("/api/v1/media/upload", {
        headers,
        multipart: { workspace_id: workspace.id, file },
      });
      expect(response.ok(), await response.text()).toBe(true);
      originals.push(await response.json());
    }
    const list = async (source?: string) => {
      const response = await request.get(
        `/api/v1/media?workspace_id=${workspace.id}${source ? `&source=${source}` : ""}`,
        { headers },
      );
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()).media as Array<{
        id: string;
        parent_media_id: string;
        source: string;
        mime_type: string;
        original_filename: string;
      }>;
    };
    await authenticatePage(page, auth.token);
    await page.goto("/media");
    for (const [index, file] of files.entries()) {
      await page
        .getByRole("button", { name: `Open details for ${file.name}`, exact: true })
        .click();
      const inspector = page.getByRole("dialog", { name: file.name, exact: true });
      await inspector.getByRole("button", { name: "Duplicate", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await list()).find((item) => item.parent_media_id === originals[index].id)?.source,
        )
        .toBe("media_copy");
      await page.keyboard.press("Escape");
      await expect(inspector).toBeHidden();
      await page.reload();
      await page
        .getByRole("button", { name: `Open details for copy-${file.name}`, exact: true })
        .click();
      const copy = page.getByRole("dialog", { name: `copy-${file.name}`, exact: true });
      await expect(copy.getByText("Copies", { exact: true })).toBeVisible();
      const rows = await list();
      const stored = rows.find((item) => item.parent_media_id === originals[index].id)!;
      expect(stored.id).not.toBe(originals[index].id);
      expect(stored.mime_type).toBe(originals[index].mime_type);
      expect(rows.find((item) => item.id === originals[index].id)?.source).toBe("upload");
      await page.keyboard.press("Escape");
      await expect(copy).toBeHidden();
    }
    expect(await list("media_copy")).toHaveLength(3);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Filters", exact: true });
    await filters.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("option", { name: "Copies", exact: true }).click();
    await filters.getByRole("button", { name: "Apply filters", exact: true }).click();
    for (const file of files) {
      await expect(
        page.getByRole("button", { name: `Open details for copy-${file.name}`, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: `Open details for ${file.name}`, exact: true }),
      ).toBeHidden();
    }
  });
});

test.describe("media corrupt upload", () => {
  test("Media upload reports corrupt PNG failure without a ready library asset", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `media-corrupt-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Image decode admission");
    await authenticatePage(page, auth.token);
    await page.goto("/media");
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    const corruptBytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from("This signature has no image pixels."),
    ]);
    await page.locator('input[type="file"]').setInputFiles({
      name: "corrupt.png",
      mimeType: "image/png",
      buffer: corruptBytes,
    });
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    await expect(page.getByText("image file could not be decoded", { exact: true })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("alert")).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Remove corrupt.png", exact: true }),
    ).toBeInViewport();
    const response = await request.get(`/api/v1/media?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(response.ok()).toBe(true);
    const failedRecords = (await response.json()).media;
    expect(failedRecords).toHaveLength(1);
    expect(failedRecords[0]).toMatchObject({
      processing_status: "failed",
      size: corruptBytes.byteLength,
    });
    expect(
      failedRecords.filter(
        (record: { processing_status: string }) => record.processing_status === "ready",
      ),
    ).toEqual([]);
    await page.getByRole("button", { name: "Remove corrupt.png", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "valid.png",
      mimeType: "image/png",
      buffer: await readFile("tests/app/fixtures/product-screenshots/openpost-logo.png"),
    });
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open details for valid.png", exact: true }),
    ).toBeVisible();
    const recovered = await request.get(`/api/v1/media?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const allRecords = (await recovered.json()).media;
    expect(allRecords).toHaveLength(2);
    expect(
      allRecords.find((record: { id: string }) => record.id === failedRecords[0].id),
    ).toMatchObject({
      processing_status: "failed",
      size: corruptBytes.byteLength,
    });
    const records = allRecords.filter(
      (record: { processing_status: string }) => record.processing_status === "ready",
    );
    expect(records).toHaveLength(1);
    expect(records[0].processing_status).toBe("ready");
    expect(records[0].width).toBeGreaterThan(0);
    expect(records[0].height).toBeGreaterThan(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Open details for corrupt.png", exact: true }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Open details for valid.png", exact: true }).click();
    const inspector = page.getByRole("dialog", { name: "valid.png", exact: true });
    await expect(inspector.getByRole("img").first()).toBeVisible();
    await expect
      .poll(() =>
        inspector
          .getByRole("img")
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
  });
});

test.describe("media filter ranges", () => {
  test("Media filters retain reversed ranges for correction and admit valid bounds", async ({
    page,
    request,
  }) => {
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
    await to.scrollIntoViewIfNeeded();
    await expect(apply).toBeDisabled();
    await to.focus();
    await expect(to).toBeFocused();
    await dialog.getByRole("alert").scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("alert")).toBeInViewport();
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
});

test.describe("media history", () => {
  test("Media history retains submitted discovery independently from unfinished search", async ({
    page,
    request,
  }) => {
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
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
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
    const search = page.getByRole("searchbox", {
      name: "Search filename or alt text",
      exact: true,
    });
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
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
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
    const search = page.getByRole("searchbox", {
      name: "Search filename or alt text",
      exact: true,
    });
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
    await page
      .getByRole("button", { name: "Switch workspace: History second", exact: true })
      .click();
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
});

test.describe("media picker upload", () => {
  test("Device upload offers explicit attachment and cancellation without switching to Library", async ({
    page,
    request,
    browser,
  }) => {
    const auth = await registerUser(request, `picker-handoff-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Device attachment handoff");
    await authenticatePage(page, auth.token);
    await page.goto("/templates");
    await page.getByRole("button", { name: "Meme", exact: true }).click();
    await page.getByRole("textbox", { name: "Search templates", exact: true }).fill("Bongo Cat");
    await page.getByRole("textbox", { name: "Search templates", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Use the Bongo Cat template", exact: true }).click();
    await expect(page.getByRole("button", { name: "Image 1", exact: true })).toBeVisible();
    const file = {
      name: "device-overlay.gif",
      mimeType: "image/gif",
      buffer: await readFile("tests/app/fixtures/media-picker-overlay.gif"),
    };
    async function upload() {
      await page.getByRole("button", { name: "Image 1", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Image 1", exact: true });
      await picker.getByRole("tab", { name: "Device", exact: true }).click();
      await picker.locator('input[type="file"]').setInputFiles(file);
      await picker.getByRole("button", { name: "Upload 1 file", exact: true }).click();
      await expect(picker.getByText("1 of 1 selected", { exact: true })).toBeVisible();
      await expect(picker.getByRole("tab", { name: "Device", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(picker.getByRole("button", { name: "Add media", exact: true })).toBeEnabled();
      return picker;
    }
    const first = await upload();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(first.getByRole("button", { name: "Add media", exact: true })).toBeInViewport();
    await expect(first.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
    await first.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(first).toBeHidden();
    await expect(page.getByRole("button", { name: "Image 2", exact: true })).toBeDisabled();
    const second = await upload();
    const confirm = second.getByRole("button", { name: "Add media", exact: true });
    await second.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(second).toBeHidden();
    await expect(page.getByRole("button", { name: "Image 2", exact: true })).toBeEnabled();
    await expect(page.getByRole("img", { name: "Image 1", exact: true })).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("img", { name: "Image 1", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Image 2", exact: true })).toBeEnabled();
    const touchContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: { width: 320, height: 850 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const touch = await touchContext.newPage();
      await authenticatePage(touch, auth.token);
      await touch.goto(page.url());
      await touch.getByRole("button", { name: "Image 2", exact: true }).tap();
      const picker = touch.getByRole("dialog", { name: "Image 2", exact: true });
      await picker.getByRole("tab", { name: "Device", exact: true }).tap();
      await picker.locator('input[type="file"]').setInputFiles(file);
      await picker.getByRole("button", { name: "Upload 1 file", exact: true }).tap();
      const attach = picker.getByRole("button", { name: "Add media", exact: true });
      await expect(attach).toBeEnabled();
      await expect(attach).toBeInViewport();
      expect((await attach.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await picker.getByRole("button", { name: "Cancel", exact: true }).tap();
      await expect(picker).toBeHidden();
      await expect(touch.getByRole("img", { name: "Image 2", exact: true })).toHaveCount(0);
    } finally {
      await touchContext.close();
    }
  });
});

test.describe("media trash", () => {
  async function fixture(page: Page, request: APIRequestContext, referenced = false) {
    const auth = await registerUser(request, `media-trash-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Recoverable media");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const name = `recoverable-${randomUUID()}.png`;
    const upload = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        file: {
          name,
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        },
      },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const media = await upload.json();
    if (referenced)
      await createPublication(request, auth.token, workspace.id, "Owned media reference", {
        contentProfile: "image_post",
        mediaIDs: [media.id],
      });
    await authenticatePage(page, auth.token);
    await page.goto("/media");
    const details = page.getByRole("button", { name: `Open details for ${name}`, exact: true });
    await details.click();
    const inspector = page.getByRole("dialog", { name, exact: true });
    await expect(
      inspector.getByText(`Referenced by ${referenced ? 1 : 0} ${referenced ? "item" : "items"}`, {
        exact: true,
      }),
    ).toBeVisible();
    const confirm = page.locator('[role="dialog"]').filter({ hasText: "Delete media?" });
    const read = async () => {
      const response = await request.get(
        `/api/v1/media?workspace_id=${workspace.id}&lifecycle=all`,
        {
          headers,
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
      const body = await response.json();
      return body.media.find((item: { id: string }) => item.id === media.id);
    };
    return { name, media, details, inspector, confirm, read };
  }

  test("Media trash confirmation explains recovery", async ({ page, request }) => {
    const { inspector, confirm } = await fixture(page, request);
    await inspector.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirm).toContainText(
      "This media item will move to Trash. You can restore it before permanent deletion.",
    );
  });

  test("Media inspector allows pointer cancellation, recoverable deletion and restore", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { inspector, confirm, details, name, read } = await fixture(page, request);
    const original = await read();
    const deleteButton = inspector.getByRole("button", { name: "Delete", exact: true });
    await deleteButton.click();
    await confirm
      .getByRole("button", { name: "Cancel", exact: true, includeHidden: true })
      .click({ timeout: 5000 });
    await expect(confirm).toBeHidden();
    await expect(inspector).toBeVisible();
    await expect(deleteButton).toBeFocused();
    expect(await read()).toEqual(original);
    await deleteButton.click();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(inspector).toBeVisible();
    await expect(deleteButton).toBeFocused();
    expect(await read()).toEqual(original);
    await deleteButton.click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
    await expect(confirm.getByRole("button", { name: "Delete", exact: true })).toBeInViewport();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(inspector).toBeHidden();
    await expect(details).toBeHidden();
    await expect(page.locator("main h1")).toBeFocused();
    const trashed = await read();
    expect(trashed.trashed_at).toBeTruthy();
    expect(trashed.purge_after).toBeTruthy();
    const tabs = page.getByTestId("media-lifecycle-tabs");
    await tabs.getByRole("tab", { name: "Trash", exact: true }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await tabs.getByRole("tab", { name: "Library", exact: true }).click();
    await expect(details).toBeVisible();
    await page.reload();
    await details.click();
    await expect(inspector).toBeVisible();
    const restored = await read();
    expect(restored.id).toBe(original.id);
    expect(restored.original_filename).toBe(original.original_filename);
    expect(restored.trashed_at ?? "").toBe("");
    expect(restored.purge_after ?? "").toBe("");
    expect(errors).toEqual([]);
  });

  test("Referenced media keeps the usage blocker without a delete request", async ({
    page,
    request,
  }) => {
    let deletions = 0;
    page.on("request", (event) => {
      if (event.method() === "POST" && event.url().includes("/media/batch-delete")) deletions++;
    });
    const { inspector, confirm, read } = await fixture(page, request, true);
    const original = await read();
    await inspector.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(
      inspector
        .getByText(
          "Delete is blocked while this asset is used. Remove the usages listed below first.",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    expect(await read()).toEqual(original);
    expect(deletions).toBe(0);
  });
});

test.describe("media video trim", () => {
  test("video preparation commits its accepted trim bounds after keyboard edits", async ({
    page,
    request,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `trim-input-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Trim input admission");
    await authenticatePage(page, auth.token);
    await page.goto("/media");
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles("tests/app/fixtures/product-screenshots/study-sos-demo.mp4");
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit video", exact: true });
    const start = dialog.getByRole("spinbutton", { name: "Start", exact: true });
    const end = dialog.getByRole("spinbutton", { name: "End", exact: true });
    await expect(start).toHaveValue("0", { timeout: 30000 });
    const duration = await dialog
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.duration);
    expect(duration).toBeGreaterThan(1);
    await start.fill("-2");
    await start.press("Tab");
    await expect(start).toHaveValue("0");
    await end.fill("9999");
    await end.press("Tab");
    await expect(end).toHaveValue(String(duration));
    await start.fill("");
    await start.pressSequentially("0.70");
    await expect(start).toHaveValue("0.70");
    await start.press("Tab");
    await expect(start).toHaveValue("0.7");
    await end.fill("0.2");
    await end.press("Tab");
    expect(Number(await end.inputValue())).toBeCloseTo(0.8, 5);
    await start.fill("-2");
    await start.press("Enter");
    await expect(start).toHaveValue("0");
    await start.fill("0.7");
    await start.press("Tab");
    await end.fill(String(duration));
    await end.press("Tab");
    await start.scrollIntoViewIfNeeded();
    await expect(start).toHaveValue("0.7");
    await expect(end).toHaveValue(String(duration));
    for (const name of ["Upload without editing", "Cancel", "Apply edit"]) {
      const action = dialog.getByRole("button", { name, exact: true });
      await expect(action).toBeInViewport({ ratio: 1 });
      expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    await expect(start).toHaveValue("0");
    await expect(end).toHaveValue(String(duration));
    await end.fill("1");
    await end.press("Tab");
    await dialog.getByRole("button", { name: "Apply edit", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Open details for study-sos-demo-edited.mp4",
        exact: true,
      }),
    ).toBeVisible();
    const inventory = await request.get(`/api/v1/media?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(inventory.ok()).toBe(true);
    const { media: items } = await inventory.json();
    expect(items).toHaveLength(1);
    const media = items[0];
    expect(media.original_filename).toBe("study-sos-demo-edited.mp4");
    const stored = await request.get(media.url, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(stored.ok()).toBe(true);
    const outputPath = testInfo.outputPath("trimmed.mp4");
    await writeFile(outputPath, await stored.body());
    const { stdout } = await promisify(execFile)(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_name,codec_type",
        "-of",
        "json",
        outputPath,
      ],
      { timeout: 30_000 },
    );
    const details = JSON.parse(stdout);
    expect(Number(details.format.duration)).toBeCloseTo(1, 1);
    expect(details.streams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codec_type: "video", codec_name: "h264" }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
      ]),
    );
    expect(errors).toEqual([]);
  });
});
