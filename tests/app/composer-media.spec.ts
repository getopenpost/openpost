import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import {
  authenticatePage,
  composerDestinations,
  createWorkspace,
  registerUser,
  openComposerPlatformSettings,
  createPublication,
} from "./helpers";
import { readFile } from "node:fs/promises";
import { type components } from "@openpost/api-contract";

test.describe("composer account media", () => {
  // Real media, capabilities and draft persistence. Synthetic accounts never publish.
  test("account media controls preserve shared attachments and survive reload", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    const errors: string[] = [];
    // A failed automatic optimization must keep the original editable and savable.
    let preparationAttempts = 0;
    await page.route("**/api/v1/media/*/optimize-image", (route) => {
      preparationAttempts++;
      return route.fulfill({ status: 503, json: { detail: "Optimizer temporarily unavailable" } });
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `account-media-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Account media");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const accounts = [
      { id: randomUUID(), platform: "bluesky", username: "mediasky" },
      { id: randomUUID(), platform: "linkedin", username: "Media person" },
    ];
    for (const account of accounts)
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account.id}','${workspace.id}','media-${account.id}','${account.platform}','${account.id}','${account.username}',X'00',1);`,
      ]);
    const media = [];
    for (const [index, color] of ["#b74c05", "#376e63", "#4469a4"].entries()) {
      const encoded = await sharp({
        create: { width: 640, height: 360, channels: 3, background: color },
      })
        .png()
        .toBuffer();
      // Padding preserves valid PNG pixels while exercising the real byte-limit warning.
      const buffer =
        index === 0 ? Buffer.concat([encoded, Buffer.alloc(4_203_031 - encoded.length)]) : encoded;
      const response = await request.post("/api/v1/media/upload", {
        headers,
        multipart: {
          workspace_id: workspace.id,
          alt_text: index === 2 ? "Library blue photo" : "",
          file: { name: `account-photo-${index}.png`, mimeType: "image/png", buffer },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      media.push(await response.json());
    }
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Account media regression",
        content_profile: "thread",
        source_text: "Shared first",
        segments: [
          {
            body: "Shared first",
            media: [{ media_id: media[0].id, alt_text: "Shared orange photo" }],
          },
          {
            body: "Shared second",
            media: [{ media_id: media[1].id, alt_text: "Shared green photo" }],
          },
        ],
        renditions: accounts.map((account) => ({ social_account_id: account.id })),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    const read = async () =>
      await (await request.get(`/api/v1/publications/${publication.id}`, { headers })).json();
    const tab = (index: number) => page.locator(`#composer-destination-${accounts[index].id}`);
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    await page.getByTestId("composer-validation-control").click();
    await expect(
      page.getByText(
        "Image is 4.2 MB; the maximum is 2 MB. Resize or replace it for this account.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await page
      .getByText("Image is 4.2 MB; the maximum is 2 MB. Resize or replace it for this account.", {
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("image-size-warning.png"), fullPage: true });
    await page.getByRole("button", { name: /Edit:.*Image is 4.2 MB/ }).click();
    const preview = page.getByTestId("composer-account-preview");
    const orange = () => preview.locator(`[data-composer-media-id="${media[0].id}"]`);
    await expect(
      page
        .getByTestId("composer-media-editor")
        .locator(`[data-composer-media-id="${media[0].id}"]`),
    ).toBeFocused();
    await page.getByRole("button", { name: "Edit media", exact: true }).click();
    await expect(orange().getByRole("button", { name: "Remove media", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Shared content", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Editing inherited media creates a media override, without detaching text.
    await orange().getByRole("button", { name: "Alt text", exact: true }).click();
    await orange()
      .getByRole("textbox", { name: "Alt text", exact: true })
      .fill("Bluesky orange photo");
    await orange().getByRole("button", { name: "Done", exact: true }).click();
    await expect
      .poll(async () => {
        const detail = await read();
        const sky = detail.renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
        );
        return {
          alt: sky.segments[0].media[0].alt_text,
          inherited: sky.segments[0].media_inherited,
          body: sky.segments[0].body_override,
          shared: detail.segments[0].media[0].alt_text,
        };
      })
      .toEqual({
        alt: "Bluesky orange photo",
        inherited: false,
        body: undefined,
        shared: "Shared orange photo",
      });
    for (const colorScheme of ["light"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(
          orange().getByRole("button", { name: "Remove media", exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: info.outputPath(`account-media-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    }
    await orange().getByRole("button", { name: "Remove media", exact: true }).click();
    await expect(orange()).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await read()).renditions.find(
            (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
          ).segments[0].media,
      )
      .toEqual([]);
    // Add media always opens acquisition, even with another attachment present.
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("tab", { name: "Library", exact: true }).click();
    await picker.getByRole("button", { name: "Select account-photo-0.png", exact: true }).click();
    await picker.getByRole("button", { name: /^Add/ }).click();
    await expect(orange()).toBeVisible();
    await expect
      .poll(
        async () =>
          (await read()).renditions.find(
            (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
          ).segments[0].media[0]?.id,
      )
      .toBe(media[0].id);
    await page.waitForLoadState("networkidle");
    await page.reload();
    await tab(0).click();
    await expect(orange().locator("img")).toHaveAttribute("alt", "Bluesky orange photo");
    await orange().getByRole("button", { name: "Alt text", exact: true }).click();
    await orange().getByRole("textbox", { name: "Alt text", exact: true }).fill("");
    await orange().getByRole("button", { name: "Done", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await read()).renditions.find(
            (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
          ).segments[0].media[0].alt_text ?? "",
      )
      .toBe("");
    await page.waitForLoadState("networkidle");
    await page.reload();
    await tab(0).click();
    await expect(orange().locator("img")).toHaveAttribute("alt", "");
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    await picker.getByRole("tab", { name: "Library", exact: true }).click();
    await picker.getByRole("button", { name: "Select account-photo-2.png", exact: true }).click();
    await picker.getByRole("button", { name: /^Add/ }).click();
    const blue = preview.locator(`[data-composer-media-id="${media[2].id}"]`);
    await expect(blue.locator("img")).toHaveAttribute("alt", "Library blue photo");
    await expect
      .poll(
        async () =>
          (await read()).renditions
            .find((r: { social_account_id: string }) => r.social_account_id === accounts[0].id)
            .segments[0].media.find((m: { id: string }) => m.id === media[2].id)?.alt_text,
      )
      .toBe("Library blue photo");
    await blue.getByRole("button", { name: "Remove media", exact: true }).click();
    // Joined outputs expose both source images, independently of active text focus.
    await tab(1).click();
    const green = preview.locator(`[data-composer-media-id="${media[1].id}"]`);
    await green.getByRole("button", { name: "Remove media", exact: true }).click();
    await expect
      .poll(async () => {
        const detail = await read();
        const linked = detail.renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[1].id,
        );
        return linked.segments[0].media.map((m: { id: string }) => m.id);
      })
      .toEqual([media[0].id]);
    await page.waitForLoadState("networkidle");
    await page.reload();
    await tab(1).click();
    await expect(green).toHaveCount(0);
    await expect(orange().locator("img")).toHaveAttribute("alt", "Shared orange photo");
    await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
    const sharedOrange = page.locator(`[data-composer-media-id="${media[0].id}"]`);
    await sharedOrange.getByRole("button", { name: "Alt text", exact: true }).click();
    await sharedOrange
      .getByRole("textbox", { name: "Alt text", exact: true })
      .fill("Updated shared photo");
    await sharedOrange.getByRole("button", { name: "Done", exact: true }).click();
    await expect
      .poll(async () => (await read()).segments[0].media[0].alt_text)
      .toBe("Updated shared photo");
    await tab(1).click();
    await expect(orange().locator("img")).toHaveAttribute("alt", "Shared orange photo");
    await tab(0).click();
    await expect(orange().locator("img")).toHaveAttribute("alt", "");
    const detail = await read();
    expect(
      detail.segments.map((s: { media: { id: string; alt_text: string }[] }) =>
        s.media.map((m) => ({ id: m.id, alt: m.alt_text })),
      ),
    ).toEqual([
      [{ id: media[0].id, alt: "Updated shared photo" }],
      [{ id: media[1].id, alt: "Shared green photo" }],
    ]);
    expect(preparationAttempts).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  for (const platform of ["discord", "pixelfed"]) {
    test(`removing a repeated ${platform} attachment respects its segment strategy`, async ({
      page,
      request,
    }) => {
      const auth = await registerUser(request, `repeated-media-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Repeated media");
      const headers = { Authorization: `Bearer ${auth.token}` };
      const accountID = randomUUID();
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','repeat-${accountID}','${platform}','${accountID}','repeat',X'00',1);`,
      ]);
      const upload = await request.post("/api/v1/media/upload", {
        headers,
        multipart: {
          workspace_id: workspace.id,
          file: {
            name: "repeated.png",
            mimeType: "image/png",
            buffer: await sharp({
              create: { width: 640, height: 360, channels: 3, background: "#376e63" },
            })
              .png()
              .toBuffer(),
          },
        },
      });
      expect(upload.ok(), await upload.text()).toBe(true);
      const media = await upload.json();
      const created = await request.post("/api/v1/publications", {
        headers,
        data: {
          workspace_id: workspace.id,
          title: "Repeated attachment",
          content_profile: "thread",
          source_text: "First source",
          segments: [
            { body: "First source", media: [{ media_id: media.id }] },
            { body: "Second source", media: [{ media_id: media.id }] },
          ],
          renditions: [{ social_account_id: accountID }],
        },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const publication = await created.json();
      await authenticatePage(page, auth.token);
      await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
      await page.locator(`#composer-destination-${accountID}`).click();
      const tiles = page
        .getByTestId("composer-account-preview")
        .locator(`[data-composer-media-id="${media.id}"]`);
      await expect(tiles).toHaveCount(platform === "discord" ? 1 : 2, { timeout: 15000 });
      await tiles.first().getByRole("button", { name: "Remove media", exact: true }).click();
      await expect(tiles).toHaveCount(platform === "discord" ? 0 : 1);
      await expect
        .poll(async () => {
          const detail = await (
            await request.get(`/api/v1/publications/${publication.id}`, { headers })
          ).json();
          return detail.renditions[0].segments.map((s: { media: { id: string }[] }) =>
            s.media.map((m) => m.id),
          );
        })
        .toEqual(platform === "discord" ? [[]] : [[], [media.id]]);
    });
  }
});

test.describe("composer alt text failure", () => {
  // Automatic captioning is best effort. A provider failure belongs to the media
  // editor, not to a persistent page toast that covers composer controls.
  test("a failed automatic alt text draft stays inside the media editor", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const auth = await registerUser(request, `alt-text-failure-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Alt text failure");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','alt-${accountID}','bluesky','${accountID}','altcaptions',X'00',1);`,
    ]);
    const buffer = await sharp({
      create: { width: 640, height: 360, channels: 3, background: "#6b7f52" },
    })
      .png()
      .toBuffer();
    const uploaded = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        file: { name: "alt-failure.png", mimeType: "image/png", buffer },
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Alt text failure",
        content_profile: "image_post",
        source_text: "A calm launch photo",
        segments: [{ body: "A calm launch photo" }],
        renditions: [{ social_account_id: accountID }],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const publication = await created.json();
    let captionAttempts = 0;
    await page.route("**/api/v1/media/*/alt-text/generate", (route) => {
      captionAttempts += 1;
      if (captionAttempts === 1) {
        return route.fulfill({ status: 502, json: { detail: "Caption provider unavailable" } });
      }
      return route.fulfill({ json: { alt_text: "A calm launch photo" } });
    });
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("tab", { name: "Library", exact: true }).click();
    await picker.getByRole("button", { name: "Select alt-failure.png", exact: true }).click();
    await picker.getByRole("button", { name: /^Add/ }).click();

    await expect(
      page.getByRole("button", { name: "Add alt text", exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);

    // The failure must not intercept the composer's own actions.
    await page.locator(`#composer-destination-${accountID}`).click();
    await page
      .getByTestId("composer-variant-toolbar")
      .getByRole("button", { name: "More", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Platform settings", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    const tile = page
      .getByTestId("composer-account-preview")
      .locator("[data-composer-media-id]")
      .first();
    const altButton = tile.getByRole("button", { name: "Add alt text", exact: true });
    await altButton.click();
    const failure = tile.getByText(
      "OpenPost could not generate alt text. You can try again or write it yourself.",
      { exact: true },
    );
    await expect(failure).toBeVisible();
    await tile.getByRole("button", { name: "Try again", exact: true }).click();
    const altField = tile.getByRole("textbox", { name: "Alt text", exact: true });
    await expect(altField).toHaveValue("A calm launch photo");
    await expect(failure).not.toBeVisible();

    type SavedMedia = { alt_text?: string };
    type SavedSegment = { media?: SavedMedia[] };
    await expect
      .poll(async () => {
        const saved = (await (
          await request.get(`/api/v1/publications/${publication.id}`, { headers })
        ).json()) as {
          segments: SavedSegment[];
          renditions: Array<{ segments: SavedSegment[] }>;
        };
        return [...saved.segments, ...saved.renditions.flatMap((item) => item.segments)]
          .flatMap((segment) => segment.media ?? [])
          .map((item) => item.alt_text)
          .filter(Boolean);
      })
      .toContain("A calm launch photo");
  });
});

test.describe("composer cover handoff", () => {
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
    for (const scheme of ["light"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      for (const width of [1440, 320]) {
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
    await expect(page.getByRole("img", { name: "A custom cover image is selected." })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Edit this frame", exact: true }).click();
    await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.keyboard.insertText("A real product demo");
    await page.keyboard.press("Escape");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Use as cover", exact: true })
      .click();
    const exportDialog = page.getByRole("dialog", { name: "Export design" });
    await expect(exportDialog.getByRole("img", { name: "Encoded export preview" })).toBeVisible({
      timeout: 30_000,
    });
    await exportDialog.getByRole("button", { name: "Use as cover", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("img", { name: "A custom cover image is selected." }),
    ).toBeVisible({
      timeout: 30_000,
    });
    const saved = async () => (await request.get(setup.path, { headers: setup.headers })).json();
    await expect
      .poll(
        async () =>
          (await saved()).renditions.find(
            (item: any) => item.social_account_id === setup.accounts[0],
          ).settings.thumbnail_media_id,
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
    for (const scheme of ["light"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
      for (const width of [1440, 320]) {
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
    await expect(
      page.getByRole("img", { name: "A custom cover image is selected." }),
    ).toBeVisible();
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
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Use as cover", exact: true })
      .click();
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
});

test.describe("composer image preparation", () => {
  test("optimizes attachments automatically and fits one network while keeping both originals", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `image-preparation-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Image preparation");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const accounts = ["bluesky", "linkedin", "mastodon"].map((platform) => ({
      id: randomUUID(),
      platform,
    }));
    for (const account of accounts)
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account.id}','${workspace.id}','prepare-${account.id}','${account.platform}','${account.id}','prepare',X'00',1);`,
      ]);
    const flat = await sharp({
      create: { width: 1000, height: 800, channels: 3, background: "#b74c05" },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const pixels = Buffer.alloc(1400 * 1100 * 3);
    let seed = 417;
    for (let index = 0; index < pixels.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[index] = seed >>> 24;
    }
    const noisy = await sharp(pixels, { raw: { width: 1400, height: 1100, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const originals = [];
    for (const [index, buffer] of [flat, noisy].entries()) {
      const response = await request.post("/api/v1/media/upload", {
        headers,
        multipart: {
          workspace_id: workspace.id,
          alt_text: "",
          ...(index ? { source: "image_editor_edit", parent_media_id: originals[0].id } : {}),
          file: { name: index ? "detail.png" : "flat.png", mimeType: "image/png", buffer },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      originals.push(await response.json());
    }
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Prepared images",
        content_profile: "short_text",
        source_text: "Image preparation",
        segments: [{ body: "Image preparation" }],
        renditions: accounts.map((account) => ({ social_account_id: account.id })),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    const read = async () =>
      await (await request.get(`/api/v1/publications/${publication.id}`, { headers })).json();
    // Stub only the external caption generation boundary; retain real attachment persistence.
    const captionRequests: string[] = [];
    let releaseFitCaption!: () => void;
    const fitCaptionHeld = new Promise<void>((resolve) => {
      releaseFitCaption = resolve;
    });
    await page.route("**/api/v1/media/*/alt-text/generate", async (route) => {
      captionRequests.push(route.request().url().split("/media/")[1].split("/")[0]);
      const first = captionRequests.length === 1;
      if (!first) await fitCaptionHeld;
      return route.fulfill({ json: { alt_text: first ? "Orange original" : "Fine color detail" } });
    });
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    const add = async (filename: string) => {
      await page.getByRole("button", { name: "Add media", exact: true }).click();
      const picker = page.getByRole("dialog");
      await picker.getByRole("tab", { name: "Library", exact: true }).click();
      await picker.getByRole("button", { name: `Select ${filename}`, exact: true }).click();
      await picker.getByRole("button", { name: /^Add/ }).click();
    };
    const useOriginal = async (label: string) => {
      await page
        .getByTestId("composer-variant-toolbar")
        .getByRole("button", { name: "More", exact: true })
        .click();
      await page.getByRole("menuitem", { name: label, exact: true }).click();
    };
    await add("flat.png");
    await expect
      .poll(async () => (await read()).segments[0].media?.[0]?.id)
      .not.toBe(originals[0].id);
    await expect.poll(async () => (await read()).segments[0].media?.length).toBe(1);
    let detail = await read();
    const optimized = detail.segments[0].media[0];
    expect(optimized.size).toBeLessThan(originals[0].size);
    await expect
      .poll(async () => (await read()).segments[0].media[0].alt_text)
      .toBe("Orange original");
    expect(captionRequests).toContain(optimized.id);
    expect(captionRequests).not.toContain(originals[0].id);
    // Loading the original through a destination menu must keep resolving shared media,
    // even when the tab switches back to All while the request is held.
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.locator(`#composer-destination-${accounts[0].id}`).click();
    let releaseOriginal!: () => void;
    const originalHeld = new Promise<void>((resolve) => {
      releaseOriginal = resolve;
    });
    await page.route("**/api/v1/media/metadata?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("media_ids") !== originals[0].id)
        return route.continue();
      const response = await route.fetch();
      await originalHeld;
      await route.fulfill({ response });
    });
    const originalStarted = page.waitForRequest(
      (req) =>
        req.url().includes("/media/metadata?") &&
        new URL(req.url()).searchParams.get("media_ids") === originals[0].id,
    );
    const originalLoaded = page.waitForResponse(
      (res) =>
        res.url().includes("/media/metadata?") &&
        new URL(res.url()).searchParams.get("media_ids") === originals[0].id,
    );
    await useOriginal("Use original image 1");
    await originalStarted;
    await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
    releaseOriginal();
    await (await originalLoaded).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect.poll(async () => (await read()).segments[0].media[0]?.id).toBe(originals[0].id);
    await page.unroute("**/api/v1/media/metadata?**");
    await expect.poll(async () => (await read()).segments[0].media[0]?.id).toBe(originals[0].id);
    await page.locator(`#composer-destination-${accounts[0].id}`).click();
    const captionStarted = page.waitForRequest("**/api/v1/media/*/alt-text/generate");
    await add("detail.png");
    await captionStarted;
    const fit = page.getByRole("button", { name: "Fit image 2 for Bluesky", exact: true });
    await expect(fit).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await fit.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("before-fit.png"), fullPage: true });
    const preparation = page.waitForRequest(`**/api/v1/media/${originals[1].id}/prepare-image`);
    await fit.click();
    expect((await preparation).postDataJSON()).toMatchObject({
      account_id: accounts[0].id,
      output_profile: "bluesky.post",
    });
    await expect(
      page.getByText("Image fitted for this account. Original kept.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const sky = (await read()).renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
        );
        return sky.segments[0].media.some(
          (m: { size: number; id: string }) => m.id !== originals[0].id && m.size <= 2_000_000,
        );
      })
      .toBe(true);
    detail = await read();
    const sky = detail.renditions.find(
      (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
    );
    const fitted = sky.segments[0].media.find((m: { id: string }) => m.id !== originals[0].id);
    releaseFitCaption();
    await expect
      .poll(
        async () =>
          (await read()).renditions
            .find((r: { social_account_id: string }) => r.social_account_id === accounts[0].id)
            .segments[0].media.find((m: { id: string }) => m.id === fitted.id)?.alt_text,
      )
      .toBe("Fine color detail");
    expect(detail.segments[0].media.map((m: { id: string }) => m.id)).toEqual([originals[0].id]);
    expect(
      detail.renditions
        .find((r: { social_account_id: string }) => r.social_account_id === accounts[1].id)
        .segments[0].media.map((m: { id: string }) => m.id),
    ).toEqual([originals[0].id]);
    const metadata = await (
      await request.get("/api/v1/media/metadata", {
        headers,
        params: { workspace_id: workspace.id, media_ids: fitted.id },
      })
    ).json();
    expect(metadata.media[0].parent_media_id).toBe(originals[1].id);
    for (const [index, bytes] of [flat, noisy].entries()) {
      const stored = await request.get(`/media/${originals[index].id}`, { headers });
      expect(stored.ok()).toBe(true);
      expect(await stored.body()).toEqual(bytes);
    }
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.locator(`#composer-destination-${accounts[0].id}`).click();
    await expect(
      page
        .getByTestId("composer-account-preview")
        .locator(`[data-composer-media-id="${fitted.id}"] img`),
    ).toHaveAttribute("alt", "Fine color detail");
    for (const colorScheme of ["light"] as const)
      for (const width of [1280, 320]) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: info.outputPath(`after-fit-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    await useOriginal("Use original image 2");
    await expect
      .poll(async () =>
        (await read()).renditions
          .find((r: { social_account_id: string }) => r.social_account_id === accounts[0].id)
          .segments[0].media.map((m: { id: string }) => m.id),
      )
      .toEqual([originals[0].id, originals[1].id]);
    await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
    expect((await read()).segments[0].media[0].alt_text).toBe("Orange original");
    // A relink is an authored decision, even when its effective IDs do not change.
    const staleCreated = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Relink during fit",
        content_profile: "short_text",
        source_text: "Same attachment",
        segments: [{ body: "Same attachment", media: [{ media_id: originals[1].id }] }],
        renditions: accounts.map((account) => ({ social_account_id: account.id })),
      },
    });
    expect(staleCreated.ok(), await staleCreated.text()).toBe(true);
    const stalePost = await staleCreated.json();
    await page.goto(`/publications/${stalePost.id}?workspace_id=${workspace.id}`);
    await page.locator(`#composer-destination-${accounts[0].id}`).click();
    await page.getByRole("button", { name: "Shared content", exact: true }).click();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let preparationResponded!: () => void;
    const preparationDrained = new Promise<void>((resolve) => {
      preparationResponded = resolve;
    });
    await page.route(`**/api/v1/media/${originals[1].id}/optimize-image`, async (route) => {
      try {
        await held;
        await route.fulfill({ json: { optimized: false, media: originals[1] } });
      } finally {
        preparationResponded();
      }
    });
    const started = page.waitForRequest(`**/api/v1/media/${originals[1].id}/optimize-image`);
    const staleFit = page.getByRole("button", { name: "Fit image 1 for Bluesky", exact: true });
    await staleFit.click();
    await started;
    await page.getByRole("button", { name: "Shared content", exact: true }).click();
    release();
    await preparationDrained;
    await expect(staleFit).toBeEnabled();
    await expect
      .poll(async () => {
        const detail = await (
          await request.get(`/api/v1/publications/${stalePost.id}`, { headers })
        ).json();
        return detail.renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
        ).segments[0].media_inherited;
      })
      .toBe(true);
    // Preserve settings and a pending caption when restoring shared media.
    const blueBytes = await sharp({
      create: { width: 640, height: 360, channels: 3, background: "#4469a4" },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const blueUpload = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        file: { name: "pending-blue.png", mimeType: "image/png", buffer: blueBytes },
      },
    });
    expect(blueUpload.ok(), await blueUpload.text()).toBe(true);
    const blueOriginal = await blueUpload.json();
    const blueCreated = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Pending blue",
        content_profile: "short_text",
        source_text: "Pending blue",
        segments: [{ body: "Pending blue" }],
        renditions: accounts.map((a) => ({ social_account_id: a.id })),
      },
    });
    expect(blueCreated.ok(), await blueCreated.text()).toBe(true);
    const bluePost = await blueCreated.json();
    const readBlue = async () =>
      await (await request.get(`/api/v1/publications/${bluePost.id}`, { headers })).json();
    await page.unroute("**/api/v1/media/*/alt-text/generate");
    let releaseBlueCaption!: () => void;
    const blueHeld = new Promise<void>((resolve) => {
      releaseBlueCaption = resolve;
    });
    await page.route("**/api/v1/media/*/alt-text/generate", async (route) => {
      await blueHeld;
      await route.fulfill({ json: { alt_text: "Blue original" } });
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`/publications/${bluePost.id}?workspace_id=${workspace.id}`);
    await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
    const blueCaptionStarted = page.waitForRequest("**/api/v1/media/*/alt-text/generate");
    await add("pending-blue.png");
    await blueCaptionStarted;
    await page.locator(`#composer-destination-${accounts[2].id}`).click();
    await page
      .getByTestId("composer-variant-toolbar")
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Platform settings", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Focal point", exact: true })
      .fill("0.25,-0.5");
    await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page
        .getByTestId("composer-variant-toolbar")
        .getByRole("button", { name: "Shared content", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    // Restoring from a destination menu without per-account media still resolves shared media.
    await useOriginal("Use original image 1");
    await expect
      .poll(async () => (await readBlue()).segments[0].media?.[0]?.id)
      .toBe(blueOriginal.id);
    // A deliberate empty caption on one account must not stop captions for All or other accounts.
    await page.locator(`#composer-destination-${accounts[0].id}`).click();
    const blueTile = page
      .getByTestId("composer-account-preview")
      .locator(`[data-composer-media-id="${blueOriginal.id}"]`);
    await blueTile.getByRole("button", { name: "Generating alt text…", exact: true }).click();
    await blueTile
      .getByRole("textbox", { name: "Alt text", exact: true })
      .fill("Temporary description");
    await blueTile.getByRole("textbox", { name: "Alt text", exact: true }).fill("");
    await blueTile.getByRole("button", { name: "Done", exact: true }).click();
    releaseBlueCaption();
    await expect
      .poll(async () => (await readBlue()).segments[0].media?.[0]?.alt_text)
      .toBe("Blue original");
    await expect
      .poll(async () => {
        const detail = await readBlue();
        const sky = detail.renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[0].id,
        );
        const mastodon = detail.renditions.find(
          (r: { social_account_id: string }) => r.social_account_id === accounts[2].id,
        );
        return {
          sky: sky.segments[0].media[0].alt_text ?? "",
          alt: mastodon.segments[0].media[0].alt_text,
          focal: mastodon.segments[0].media[0].settings?.focal_point,
        };
      })
      .toEqual({ sky: "", alt: "Blue original", focal: "0.25,-0.5" });
    expect(errors).toEqual([]);
  });
});

test.describe("composer media reports", () => {
  type MediaInput = { media_id: string; alt_text?: string };
  type CapturedPublication = {
    segments?: { media?: MediaInput[] }[];
    renditions?: { segments?: { media?: MediaInput[] }[] }[];
  };
  type CapabilityRequest = {
    account_settings: NonNullable<
      components["schemas"]["ResolveCapabilitiesInputBody"]["account_settings"]
    >;
    account_segments?: Record<string, { media?: MediaInput[] }[]>;
  };

  for (const { destinationOnly, provider, outputProfile, count } of [
    { destinationOnly: false, provider: "instagram", outputProfile: "instagram.feed", count: 1 },
    { destinationOnly: true, provider: "instagram", outputProfile: "instagram.feed", count: 1 },
    { destinationOnly: true, provider: "instagram", outputProfile: "instagram.story", count: 1 },
    {
      destinationOnly: true,
      provider: "linkedin",
      outputProfile: "linkedin.multi_image",
      count: 6,
    },
    { destinationOnly: true, provider: "threads", outputProfile: "threads.post", count: 2 },
  ]) {
    test(`saved publication media stays editable (${outputProfile}, ${count}, destination only: ${destinationOnly})`, async ({
      page,
      request,
    }, testInfo) => {
      const auth = await registerUser(request, `media-reports-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Media reports");
      const created = await createPublication(
        request,
        auth.token,
        workspace.id,
        "A photo https://example.com",
      );
      const media = {
        id: "image-report",
        mime_type: "image/png",
        size: 1024,
        alt_text: "A scene open in the editor",
        url: "/media/image-report",
        width: 1080,
        height: 1080,
      };
      const attachments = Array.from({ length: count }, (_, index) => ({
        ...media,
        id: index === count - 1 ? media.id : `${media.id}-${index}`,
        url: `/media/${index === count - 1 ? media.id : `${media.id}-${index}`}`,
      }));
      const segment = {
        id: "segment-report",
        position: 0,
        body: created.source_text,
        media: destinationOnly ? [] : attachments,
      };
      const account = {
        id: "instagram-report",
        workspace_id: workspace.id,
        platform: provider,
        account_id: "instagram-report",
        account_name: "Instagram report",
        account_username: "report",
        is_active: true,
      };
      const publication = {
        ...created,
        content_profile: "image_post",
        segments: [segment],
        media: destinationOnly ? [] : attachments,
        renditions: [
          {
            id: "rendition-report",
            social_account_id: account.id,
            platform: provider,
            profile: "image_post",
            output_profile: outputProfile,
            format_locked: true,
            body: segment.body,
            settings: {},
            media: attachments,
            segments: [
              {
                ...segment,
                id: "rendition-segment-report",
                publication_segment_id: segment.id,
                media_inherited: !destinationOnly,
                media: attachments,
              },
            ],
          },
        ],
      };
      await authenticatePage(page, auth.token);
      await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: [account] }));
      // Sidebar lists seed the detail cache, so every read must describe the same saved post.
      await page.route("**/api/v1/publications?**", async (route) => {
        const response = await route.fetch();
        // SAFETY: The real publications list endpoint returns objects with schema-required IDs.
        const publications = (await response.json()) as { id: string }[];
        await route.fulfill({
          response,
          json: publications.map((item) => (item.id === publication.id ? publication : item)),
        });
      });
      const saves: CapturedPublication[] = [];
      await page.route(`**/api/v1/publications/${created.id}`, async (route) => {
        if (route.request().method() === "GET") return route.fulfill({ json: publication });
        saves.push(route.request().postDataJSON());
        return route.fulfill({ json: { ...publication, revision: 2 } });
      });
      await page.route("**/api/v1/media/metadata**", (route) =>
        route.fulfill({
          json: {
            media: attachments.map((item) => ({ ...item, alt_text: "Library description" })),
          },
        }),
      );
      const requests: CapabilityRequest[] = [];
      await page.route("**/api/v1/capabilities/resolve", (route) => {
        requests.push(route.request().postDataJSON());
        return route.fulfill({
          json: {
            accounts: [
              {
                account_id: account.id,
                provider,
                profile: "image_post",
                output_profile: outputProfile,
                label: "Instagram feed",
                compatible: true,
                settings: [],
                issues:
                  count > 1 || outputProfile === "instagram.story"
                    ? [
                        {
                          severity: "error",
                          code: "media_size",
                          message: "Replace this image.",
                          provider,
                          media_id: media.id,
                        },
                      ]
                    : [],
                media: { min_count: 1, max_count: 1, allowed_mimes: ["image/png"] },
                content: {},
                active_constraints: {},
                immediate_readiness: { state: "healthy", publishable: true },
                scheduled_readiness: { state: "healthy", publishable: true },
              },
            ],
          },
        });
      });
      await page.route("**/media/image-report*", (route) =>
        route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEElEQVR4nGL6//8/IAAA//8GBgMAt2YRIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        }),
      );
      await page.goto(`/publications/${created.id}`);
      await expect.poll(() => requests.length).toBeGreaterThan(0);
      expect.soft(requests[0].account_settings[account.id]).not.toHaveProperty("share_to_feed");
      expect.soft(requests[0].account_settings[account.id]).not.toHaveProperty("is_trial_reel");
      await page.screenshot({ path: testInfo.outputPath("loaded-composer.png"), fullPage: true });
      if (destinationOnly) {
        const request = requests.at(-1)!;
        expect(request.account_segments?.[account.id]?.[0]?.media).toEqual(
          attachments.map((item) => ({ media_id: item.id, alt_text: item.alt_text })),
        );
        await page.locator(`#composer-destination-${account.id}`).click();
        if (provider === "threads") {
          const remove = page.getByRole("button", { name: "Remove media", exact: true }).first();
          await remove.scrollIntoViewIfNeeded();
          expect(
            await remove.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return element.contains(
                document.elementFromPoint(
                  bounds.x + bounds.width / 2,
                  bounds.y + bounds.height / 2,
                ),
              );
            }),
          ).toBe(true);
        }
        if (count > 1 || outputProfile === "instagram.story") {
          await page.getByTestId("composer-validation-control").click();
          await page.getByRole("button", { name: /^Edit:.*Replace this image/ }).click();
          const inventory = page.getByTestId("composer-media-editor");
          await expect(inventory.locator("[data-composer-media-id]")).toHaveCount(count);
          await expect(inventory.locator(`[data-composer-media-id="${media.id}"]`)).toBeFocused();
        } else {
          await expect(
            page.getByRole("button", { name: "Remove media", exact: true }),
          ).toBeVisible();
        }
      }
      await page
        .locator(`[data-composer-media-id="${media.id}"]`)
        .getByRole("button", { name: /^(Add alt text|Alt text)$/ })
        .click();
      await expect(page.getByPlaceholder("Alt text…")).toHaveValue(media.alt_text);
      for (const colorScheme of ["light"] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        for (const width of [320]) {
          await page.setViewportSize({ width, height: 800 });
          await expect(page.getByPlaceholder("Alt text…")).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await page
            .getByRole("button", { name: "Done", exact: true })
            .evaluate((element) => element.scrollIntoView({ block: "center" }));
          await page.screenshot({
            path: testInfo.outputPath(`alt-text-${width}-${colorScheme}.png`),
            fullPage: true,
          });
        }
      }
      await page.getByPlaceholder("Alt text…").fill("Updated publication description");
      await page.getByPlaceholder("Alt text…").blur();
      await expect
        .poll(() =>
          saves.some((saved) =>
            saved.renditions?.[0]?.segments?.[0]?.media?.some(
              (item) => item.alt_text === "Updated publication description",
            ),
          ),
        )
        .toBe(true);
    });
  }
});
