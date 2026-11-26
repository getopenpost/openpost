import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser, createPublication } from "./helpers";
import { execFileSync } from "node:child_process";

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

test.describe("media history", () => {
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
