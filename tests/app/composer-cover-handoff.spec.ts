import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  registerUser,
  openComposerPlatformSettings,
} from "./helpers";

async function fixture(page: Page, request: APIRequestContext) {
  const auth = await registerUser(request, `cover-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Video covers");
  const accounts = [randomUUID(), randomUUID()];
  for (const [index, id] of accounts.entries()) {
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${id}','${workspace.id}','cover-${id}','youtube','${id}','channel${index}',X'00',1);`,
    ]);
  }
  const headers = { Authorization: `Bearer ${auth.token}` };
  const upload = await request.post("/api/v1/media/upload", {
    headers,
    multipart: {
      workspace_id: workspace.id,
      file: {
        name: "product-demo.mp4",
        mimeType: "video/mp4",
        buffer: await readFile(
          new URL("./fixtures/product-screenshots/study-sos-demo.mp4", import.meta.url),
        ),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const video = await upload.json();
  const created = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "A real product demo",
      content_profile: "video_post",
      source_text: "Keep my actual product demo.",
      social_account_ids: accounts,
      media: [{ media_id: video.id }],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const publication = await created.json();
  let control = "media_picker";
  await page.route("**/api/v1/capabilities/resolve", (route) =>
    route.fulfill({
      json: {
        accounts: accounts.map((id) => ({
          account_id: id,
          provider: "youtube",
          profile: "video_post",
          output_profile: "youtube.video",
          compatible: true,
          text_limit: 5000,
          media: { min_count: 1, max_count: 1, allowed_mimes: ["video/mp4"] },
          settings: [
            {
              key: control === "cover_frame" ? "cover_timestamp_ms" : "thumbnail_media_id",
              label: "Thumbnail",
              type: control === "cover_frame" ? "number" : "text",
              scope: "destination",
              group: "content",
              control,
              required: false,
              message_key: "",
            },
          ],
          issues: [],
          active_constraints: {},
          immediate_readiness: { state: "healthy", publishable: true },
          scheduled_readiness: { state: "healthy", publishable: true },
        })),
      },
    }),
  );
  await authenticatePage(page, auth.token);
  const path = `/api/v1/publications/${publication.id}`;
  await page.goto(`/publications/${publication.id}`);
  const openSettings = async () => {
    await page.locator(`#composer-destination-${accounts[0]}`).click();
    await openComposerPlatformSettings(page);
    await expect(page.getByRole("button", { name: "Use this frame", exact: true })).toBeVisible();
  };
  return {
    headers,
    path,
    video,
    accounts,
    workspace,
    openSettings,
    setControl: (value: string) => {
      control = value;
    },
  };
}

test("an edited source frame returns only to its destination cover and survives reload", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await fixture(page, request);
  await setup.openSettings();
  const candidates = page
    .getByRole("group", { name: "Frames from this video" })
    .getByRole("button");
  await expect(candidates).toHaveCount(5);
  const cdp = await page.context().newCDPSession(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await cdp.send("Emulation.setTouchEmulationEnabled", {
        enabled: width < 1000,
        maxTouchPoints: 1,
      });
      const edit = page.getByRole("button", {
        name: "Edit this frame",
        exact: true,
      });
      await edit.scrollIntoViewIfNeeded();
      const box = (await edit.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`cover-before-${width}-${scheme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await candidates.nth(2).focus();
  await candidates.nth(2).press("Enter");
  await expect(candidates.nth(2)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Edit this frame", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/image-editor\/[^?]+\?.*return_token=/);
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Back to post", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Edit this frame", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "A custom cover image is selected." })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit this frame", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.keyboard.insertText("A real product demo");
  await page.keyboard.press("Escape");
  await page.getByRole("banner").getByRole("button", { name: "Use as cover", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export design" });
  await expect(exportDialog.getByRole("img", { name: "Encoded export preview" })).toBeVisible({
    timeout: 30_000,
  });
  await exportDialog.getByRole("button", { name: "Use as cover", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "A custom cover image is selected." })).toBeVisible({
    timeout: 30_000,
  });
  const saved = async () => (await request.get(setup.path, { headers: setup.headers })).json();
  await expect
    .poll(
      async () =>
        (await saved()).renditions.find((item: any) => item.social_account_id === setup.accounts[0])
          .settings.thumbnail_media_id,
    )
    .toBeTruthy();
  const result = await saved();
  const coverID = result.renditions.find(
    (item: any) => item.social_account_id === setup.accounts[0],
  ).settings.thumbnail_media_id;
  expect(coverID).not.toBe(setup.video.id);
  expect(
    result.renditions.find((item: any) => item.social_account_id === setup.accounts[1]).settings
      .thumbnail_media_id,
  ).toBeFalsy();
  expect(result.segments[0].media.map((item: any) => item.id)).toEqual([setup.video.id]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await dialog
        .getByRole("img", { name: "A custom cover image is selected." })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`cover-after-${width}-${scheme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await setup.openSettings();
  await expect(page.getByRole("img", { name: "A custom cover image is selected." })).toBeVisible();
  expect(
    (await saved()).renditions.find((item: any) => item.social_account_id === setup.accounts[0])
      .settings.thumbnail_media_id,
  ).toBe(coverID);
  expect(errors).toEqual([]);
});

test("timestamp-only covers cannot open the image editor and a changed source rejects an old cover", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const setup = await fixture(page, request);
  setup.setControl("cover_frame");
  await page.reload();
  await setup.openSettings();
  await expect(page.getByRole("button", { name: "Edit this frame", exact: true })).toHaveCount(0);
  setup.setControl("media_picker");
  await page.reload();
  await setup.openSettings();
  await page.getByRole("button", { name: "Edit this frame", exact: true }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  const current = await (await request.get(setup.path, { headers: setup.headers })).json();
  const changed = await request.put(setup.path, {
    headers: setup.headers,
    data: {
      expected_revision: current.revision,
      title: current.title,
      content_profile: "short_text",
      source_text: "I removed the source video.",
      segments: [
        {
          id: current.segments[0].id,
          body: "I removed the source video.",
          media: [],
        },
      ],
      renditions: [],
    },
  });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  await page.getByRole("banner").getByRole("button", { name: "Use as cover", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export design" })
    .getByRole("button", { name: "Use as cover", exact: true })
    .click();
  await expect(page.getByText(/The destination or source video changed/)).toBeVisible({
    timeout: 30_000,
  });
  const after = await (await request.get(setup.path, { headers: setup.headers })).json();
  expect(after.source_text).toBe("I removed the source video.");
  expect(after.segments[0].media ?? []).toEqual([]);
  expect(after.renditions).toEqual([]);
});
