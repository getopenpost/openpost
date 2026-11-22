import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  registerUser,
  openComposerPlatformSettings,
  composerDestinations,
  expectPostText,
  clickComposerDeliveryAction,
  createPublication,
} from "./helpers";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

test.describe("composer destination order", () => {
  test("composer destination order survives edits, reload and inventory return", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const auth = await registerUser(request, `destination-order-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Destination ordering");
    const platforms = ["threads", "x", "mastodon", "bluesky", "linkedin"] as const;
    const accounts = platforms.map((platform) => ({
      id: randomUUID(),
      platform,
    }));
    const db = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
    for (const account of accounts)
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        db,
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account.id}','${workspace.id}','audit-${account.id}','${account.platform}','${account.id}','audit-same-name',X'00',1);`,
      ]);
    // A valid indexed query plan exposes ordering that cannot rely on tied timestamps.
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      db,
      "CREATE INDEX IF NOT EXISTS audit_renditions_read_order ON renditions(publication_id,created_at,id)",
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    let expectedIDs = accounts.map((account) => account.id);
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Audit destination order",
        intent: "post",
        content_profile: "short_text",
        source_text: "Audit original text",
        segments: [{ body: "Audit original text" }],
        renditions: accounts.map((account) => ({
          social_account_id: account.id,
        })),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    const path = `/api/v1/publications/${publication.id}`;
    await page.route("**/api/v1/capabilities/resolve", (route) =>
      route.fulfill({
        json: {
          accounts: accounts.map((account) => ({
            account_id: account.id,
            provider: account.platform,
            profile: "short_text",
            output_profile: `${account.platform}.post`,
            segment_strategy: "native",
            compatible: true,
            text_limit: 3000,
            settings: [],
            issues: [],
            active_constraints: {},
            media: { min_count: 0, max_count: 4, allowed_mimes: [] },
            immediate_readiness: { state: "healthy", publishable: true },
            scheduled_readiness: { state: "healthy", publishable: true },
          })),
        },
      }),
    );
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    const tabs = page.locator('[id^="composer-destination-"]:not(#composer-destination-all)');
    await expect(tabs).toHaveCount(accounts.length);
    const readOrder = () =>
      tabs.evaluateAll((elements) =>
        elements.map((element) => element.id.replace("composer-destination-", "")),
      );
    expect(await readOrder()).toEqual(expectedIDs);
    await page.getByRole("textbox", { name: "Post text", exact: true }).fill("Audit edited text");
    await expect
      .poll(async () => (await (await request.get(path, { headers })).json()).source_text)
      .toBe("Audit edited text");
    const beforeReplacement = await (await request.get(path, { headers })).json();
    expectedIDs = [...expectedIDs].reverse();
    const replacement = await request.put(path, {
      headers,
      data: {
        expected_revision: beforeReplacement.revision,
        renditions: expectedIDs.map((id) => ({ social_account_id: id })),
      },
    });
    expect(replacement.ok(), await replacement.text()).toBe(true);
    expect(
      (await replacement.json()).renditions.map(
        (rendition: { social_account_id: string }) => rendition.social_account_id,
      ),
    ).toEqual(expectedIDs);
    const orderBeforeUpsert = [...expectedIDs];
    const edited = await replacement.json();
    const upsert = await request.put(`${path}/renditions`, {
      headers,
      data: {
        expected_revision: edited.revision,
        renditions: [{ social_account_id: expectedIDs[2] }],
      },
    });
    expect(upsert.ok(), await upsert.text()).toBe(true);
    const updated = await upsert.json();
    expect(
      updated.renditions.map(
        (rendition: { social_account_id: string }) => rendition.social_account_id,
      ),
    ).toEqual(orderBeforeUpsert);
    const addedAccount = { id: randomUUID(), platform: "threads" as const };
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      db,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${addedAccount.id}','${workspace.id}','audit-${addedAccount.id}','threads','${addedAccount.id}','audit-new-name',X'00',1);`,
    ]);
    accounts.push(addedAccount);
    const append = await request.put(`${path}/renditions`, {
      headers,
      data: {
        expected_revision: updated.revision,
        renditions: [{ social_account_id: addedAccount.id }],
      },
    });
    expect(append.ok(), await append.text()).toBe(true);
    expectedIDs.push(addedAccount.id);
    expect(
      (await append.json()).renditions.map(
        (rendition: { social_account_id: string }) => rendition.social_account_id,
      ),
    ).toEqual(expectedIDs);
    for (const width of [1280, 320]) {
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.reload();
        await expect(tabs).toHaveCount(accounts.length);
        expect(await readOrder()).toEqual(expectedIDs);
        for (const [index, id] of expectedIDs.entries()) {
          const platform = accounts.find((account) => account.id === id)!.platform;
          const label = {
            threads: "Threads",
            x: "X",
            mastodon: "Mastodon",
            bluesky: "Bluesky",
            linkedin: "LinkedIn",
          }[platform];
          await expect(tabs.nth(index)).toHaveAccessibleName(
            new RegExp(
              `^@?${id === addedAccount.id ? "audit-new-name" : "audit-same-name"}, ${label}$`,
            ),
          );
        }
        const stored = await (await request.get(path, { headers })).json();
        expect(
          stored.renditions.map(
            (rendition: { social_account_id: string }) => rendition.social_account_id,
          ),
        ).toEqual(expectedIDs);
        await tabs.last().focus();
        await page.keyboard.press("Enter");
        await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
        await page.screenshot({
          path: testInfo.outputPath(`order-${width}-${scheme}.png`),
        });
        await page.goto(`/publications?tab=drafts&workspace_id=${workspace.id}`);
        await expect(page.getByRole("tab", { name: "Drafts", exact: true })).toBeVisible();
        await page.goBack();
        await expect(tabs).toHaveCount(accounts.length);
        expect(await readOrder()).toEqual(expectedIDs);
      }
    }
  });
});

test.describe("composer format persistence", () => {
  // Provider readiness is synthetic; persistence uses the real local API.
  test("a hydrated draft retains format changes, shared media and a new follow-up after reload", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `format-media-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Format and media persistence");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','media-${accountID}','instagram','${accountID}','auditmedia',X'00',1);`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const uploaded = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        file: {
          name: "audit-persistence.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mL6//8/YAAGBgMAKE2v1gAAAABJRU5ErkJggg==",
            "base64",
          ),
        },
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    const media = await uploaded.json();
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Audit media persistence",
        content_profile: "image_post",
        source_text: "Audit shared media",
        segments: [{ body: "Audit shared media" }],
        renditions: [],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const publication = await created.json();
    const path = `/api/v1/publications/${publication.id}`;
    const saveErrors: string[] = [];
    page.on("response", async (response) => {
      if (
        response.request().method() === "PUT" &&
        response.url().endsWith(path) &&
        !response.ok()
      ) {
        saveErrors.push(await response.text());
      }
    });

    await page.route("**/api/v1/capabilities/resolve", (route) =>
      route.fulfill({
        json: {
          accounts: [
            {
              account_id: accountID,
              provider: "instagram",
              profile: "image_post",
              output_profile:
                route.request().postDataJSON().requested_output_profiles?.[accountID] ||
                "instagram.feed",
              label: "Instagram feed",
              compatible: true,
              text_limit: 2200,
              available_formats: [
                {
                  output_profile: "instagram.feed",
                  label: "Feed",
                  compatible: true,
                },
                {
                  output_profile: "instagram.story",
                  label: "Story",
                  compatible: true,
                },
                {
                  output_profile: "instagram.reel",
                  label: "Reel",
                  compatible: true,
                },
              ],
              media: {
                min_count: 1,
                max_count: 10,
                allowed_mimes: ["image/png"],
              },
              settings: [
                {
                  key: "first_comment",
                  label: "First comment",
                  type: "textarea",
                  scope: "segment",
                  group: "conversation",
                  control: "follow_up",
                  required: false,
                  message_key: "",
                },
              ],
              issues: [],
              active_constraints: {},
              immediate_readiness: { state: "healthy", publishable: true },
              scheduled_readiness: { state: "healthy", publishable: true },
            },
          ],
        },
      }),
    );
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    await page.getByRole("button", { name: /^Accounts:/ }).click();
    const destination = page
      .getByTestId("composer-account-row")
      .filter({ hasText: "auditmedia" })
      .getByRole("checkbox");
    await destination.uncheck();
    await destination.check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Add media", exact: true }).click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("tab", { name: "Library", exact: true }).click();
    await picker.getByRole("button", { name: "Select audit-persistence.png", exact: true }).click();
    await picker.getByRole("button", { name: /^Add/ }).click();
    await page.locator(`#composer-destination-${accountID}`).click();
    await openComposerPlatformSettings(page);
    await page
      .getByRole("textbox", { name: "First comment", exact: true })
      .fill("Audit independent follow-up");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect
      .poll(async () => {
        if (saveErrors.length) throw new Error(saveErrors.join("\n"));
        const saved = await (await request.get(path, { headers })).json();
        return {
          sourceMedia: (saved.segments[0].media ?? []).map((item: { id: string }) => item.id),
          bodies: saved.renditions[0]?.segments.map((segment: { body: string }) => segment.body),
        };
      })
      .toEqual({
        sourceMedia: [media.id],
        bodies: ["Audit shared media", "Audit independent follow-up"],
      });
    await page.reload();
    await page.locator(`#composer-destination-${accountID}`).click();
    await openComposerPlatformSettings(page);
    await expect(page.getByRole("textbox", { name: "First comment", exact: true })).toHaveValue(
      "Audit independent follow-up",
    );
    for (const [label, profile] of [
      ["Story", "instagram.story"],
      ["Reel", "instagram.reel"],
    ]) {
      await page.getByRole("button", { name: "Destination format", exact: true }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await expect
        .poll(
          async () =>
            (await (await request.get(path, { headers })).json()).renditions[0].output_profile,
        )
        .toBe(profile);
    }
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.reload();
    const saved = await (await request.get(path, { headers })).json();
    expect(saved.renditions[0].output_profile).toBe("instagram.reel");
    expect(saved.segments[0].media.map((item: { id: string }) => item.id)).toEqual([media.id]);

    await page.screenshot({
      path: testInfo.outputPath("media-follow-up-reloaded.png"),
    });
  });
});

test.describe("composer format previews", () => {
  test.use({ hasTouch: true });
  for (const width of [1280, 320])
    for (const scheme of ["light"] as const) {
      test(`account media follows feed, carousel and Story at ${width}px in ${scheme}`, async ({
        page,
        request,
      }, info) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const errors: string[] = [];
        page.on("pageerror", (error) => {
          // Reloading aborts in-flight route imports, and the app bounds its own
          // chunk recovery; the rendered page is the evidence that it succeeded.
          if (error.message.includes("Failed to fetch dynamically imported module")) return;
          errors.push(error.message);
        });
        const auth = await registerUser(request, `format-preview-${randomUUID()}@example.com`);
        const workspace = await createWorkspace(request, auth.token, "Media format previews");
        const accountID = randomUUID();
        execFileSync("sqlite3", [
          "-cmd",
          ".timeout 5000",
          `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
          `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','format-${accountID}','instagram','${accountID}','formatpreview',X'00',1);`,
        ]);
        const headers = { Authorization: `Bearer ${auth.token}` };
        const media = [];
        for (const name of ["portrait", "landscape"]) {
          const response = await request.post("/api/v1/media/upload", {
            headers,
            multipart: {
              workspace_id: workspace.id,
              alt_text: `${name} fixture`,
              file: {
                name: `preview-${name}.png`,
                mimeType: "image/png",
                buffer: readFileSync(new URL(`./fixtures/compose/${name}.png`, import.meta.url)),
              },
            },
          });
          expect(response.ok(), await response.text()).toBe(true);
          media.push(await response.json());
        }
        const created = await request.post("/api/v1/publications", {
          headers,
          data: {
            workspace_id: workspace.id,
            title: "Format preview",
            content_profile: "image_post",
            source_text: "One shared caption",
            segments: [{ body: "One shared caption", media: [{ media_id: media[0].id }] }],
            renditions: [{ social_account_id: accountID, output_profile: "instagram.feed" }],
          },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const publication = await created.json();
        await page.route("**/api/v1/capabilities/resolve", (route) => {
          const body = route.request().postDataJSON();
          const selected = body.requested_output_profiles?.[accountID] || "instagram.feed";
          return route.fulfill({
            json: {
              accounts: [
                {
                  account_id: accountID,
                  provider: "instagram",
                  profile: selected.endsWith("story")
                    ? "story"
                    : selected.endsWith("carousel")
                      ? "carousel"
                      : "image_post",
                  output_profile: selected,
                  segment_strategy: "preserve",
                  label: "Instagram",
                  text_limit: 2200,
                  media: {
                    min_count: 1,
                    max_count: selected.endsWith("story") ? 1 : 10,
                    allowed_mimes: ["image/png"],
                  },
                  available_formats: [
                    { output_profile: "instagram.feed", label: "Feed", compatible: true },
                    { output_profile: "instagram.carousel", label: "Carousel", compatible: true },
                    { output_profile: "instagram.story", label: "Story", compatible: true },
                  ],
                  settings: [],
                  issues: [],
                  active_constraints: {},
                  compatible: true,
                  immediate_readiness: { state: "healthy", publishable: true },
                  scheduled_readiness: { state: "healthy", publishable: true },
                },
              ],
            },
          });
        });
        await authenticatePage(page, auth.token);
        const url = `/publications/${publication.id}?workspace_id=${workspace.id}`;
        await page.goto(url);
        await page.locator(`#composer-destination-${accountID}`).click();
        const frame = page.getByTestId("composer-account-preview");
        const portrait = frame.getByRole("img", { name: "portrait fixture", exact: true });
        await expect(portrait).toBeVisible();
        await expect
          .poll(async () => {
            const bounds = await portrait.boundingBox();
            return bounds!.width / bounds!.height;
          })
          .toBeCloseTo(0.8, 1);
        await page.screenshot({ path: info.outputPath("feed.png") });
        await page.getByRole("button", { name: "Add media", exact: true }).click();
        const picker = page.getByRole("dialog");
        await picker.getByRole("tab", { name: "Library", exact: true }).click();
        await picker
          .getByRole("button", { name: "Select preview-landscape.png", exact: true })
          .click();
        await picker.getByRole("button", { name: /^Add/ }).click();
        const selectFormat = async (label: string) => {
          await openComposerPlatformSettings(page);
          const dialog = page.getByRole("dialog");
          await dialog.getByRole("button", { name: "Destination format", exact: true }).click();
          await page.getByRole("option", { name: label, exact: true }).click();
          await dialog.getByRole("button", { name: "Done", exact: true }).click();
        };
        await selectFormat("Carousel");
        await frame.getByRole("button", { name: "Next media", exact: true }).click();
        const landscape = frame.getByRole("img", { name: "landscape fixture", exact: true });
        await expect(landscape).toBeVisible();
        await expect(landscape).toHaveCSS("object-fit", "cover");
        await expect
          .poll(async () => {
            const bounds = await landscape.boundingBox();
            return bounds!.width / bounds!.height;
          })
          .toBeCloseTo(0.8, 1);
        await page.screenshot({ path: info.outputPath("carousel.png") });
        const popupEvent = page.waitForEvent("popup");
        await page.getByRole("button", { name: "Full preview", exact: true }).click();
        const popup = await popupEvent;
        await expect(
          popup.getByRole("img", { name: "portrait fixture", exact: true }),
        ).toBeVisible();
        await popup.getByRole("button", { name: "Next media", exact: true }).click();
        await expect(popup.getByRole("img", { name: "landscape fixture", exact: true })).toHaveCSS(
          "object-fit",
          "cover",
        );
        await popup.close();
        await frame.getByRole("button", { name: "Remove media", exact: true }).click();
        await selectFormat("Story");
        const player = frame.getByLabel("Instagram story player", { exact: true });
        await expect(player).toBeVisible();
        await expect(portrait).toHaveCSS("object-fit", "contain");
        const bounds = await player.boundingBox();
        expect(bounds!.width / bounds!.height).toBeCloseTo(9 / 16, 2);
        await expect
          .poll(
            async () => {
              const saved = await (
                await request.get(`/api/v1/publications/${publication.id}`, { headers })
              ).json();
              return {
                format: saved.renditions[0].output_profile,
                shared: saved.segments[0].media.map((item: any) => item.id),
                // Destination media is nullable while the autosave copies it from
                // the canonical segment into the rendition segment.
                account: (saved.renditions[0].segments[0].media ?? []).map((item: any) => item.id),
              };
            },
            { timeout: 30_000 },
          )
          .toEqual({ format: "instagram.story", shared: [media[0].id], account: [media[0].id] });
        await page.reload();
        await page.locator(`#composer-destination-${accountID}`).click();
        await expect(player).toBeVisible();
        await expect(portrait).toBeVisible();
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-testid="composer-account-editor"]')
              .analyze()
          ).violations,
        ).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await player.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath("story.png") });
        expect(errors).toEqual([]);
      });
    }
});

test.describe("composer variant tab", () => {
  function capability(accountId: string, platform: string, profile: string, label: string) {
    return {
      account_id: accountId,
      provider: platform,
      profile,
      output_profile: `${platform}.post`,
      label,
      text_limit: 3000,
      media: {
        min_count: 0,
        max_count: 9,
        allowed_mimes: [],
        requires_public_url: false,
        requires_https_fetchable: false,
      },
      intents: ["post"],
      media_shapes: ["text"],
      settings: [],
      setting_groups: [],
      compatible: true,
      active_constraints: {},
      issues: [],
      capability_revision: "test-v1",
      dynamic_options: {},
      immediate_readiness: { state: "healthy", publishable: true },
      scheduled_readiness: { state: "healthy", publishable: true },
    };
  }

  for (const width of [1280, 390]) {
    for (const scheme of ["light"] as const) {
      test(`customized destination tab carries its own marker at ${width}px in ${scheme}`, async ({
        page,
        request,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const auth = await registerUser(
          request,
          `variant-tab-${width}-${scheme}-${randomUUID()}@example.com`,
        );
        const workspace = await createWorkspace(request, auth.token, "Variant tabs");
        await authenticatePage(page, auth.token);
        await page.route("**/api/v1/accounts?**", (route) =>
          route.fulfill({
            json: [
              {
                id: "variant-first",
                workspace_id: workspace.id,
                platform: "x",
                account_id: "variant-first",
                account_name: "First",
                account_username: "first",
                is_active: true,
              },
              {
                id: "variant-second",
                workspace_id: workspace.id,
                platform: "threads",
                account_id: "variant-second",
                account_name: "Second",
                account_username: "second",
                is_active: true,
              },
            ],
          }),
        );
        await page.route("**/api/v1/capabilities/resolve", (route) =>
          route.fulfill({
            json: {
              accounts: [
                capability("variant-first", "x", "short_text", "X post"),
                capability("variant-second", "threads", "short_text", "Threads post"),
              ],
            },
          }),
        );
        await page.goto("/");
        const editor = page.getByRole("textbox", {
          name: "Post text",
          exact: true,
        });
        await editor.fill("Shared launch update for every destination.");

        const firstTab = page.locator("#composer-destination-variant-first");
        const secondTab = page.locator("#composer-destination-variant-second");
        await expect(firstTab.getByTestId("composer-destination-custom")).toHaveCount(0);
        await expect(secondTab.getByTestId("composer-destination-custom")).toHaveCount(0);

        await firstTab.click();
        await editor.fill("Only the first account uses this text.");
        await expect(editor).toBeEnabled();

        await expect(firstTab.getByTestId("composer-destination-custom")).toBeVisible();
        await expect(secondTab.getByTestId("composer-destination-custom")).toHaveCount(0);
        await expect(composerDestinations(page).getByRole("tab", { name: /custom/ })).toBeVisible();

        const tabs = composerDestinations(page);
        await tabs.screenshot({ path: testInfo.outputPath("variant-tabs.png") });
      });
    }
  }
});

test.describe("composer editable previews", () => {
  test.use({ hasTouch: true });

  for (const width of [1280, 320])
    for (const scheme of ["light"] as const) {
      test(`account previews edit independently at ${width}px in ${scheme}`, async ({
        page,
        request,
      }, info) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const auth = await registerUser(request, `preview-${randomUUID()}@example.com`);
        const workspace = await createWorkspace(request, auth.token, "Editable previews");
        const accounts = [
          { id: randomUUID(), platform: "bluesky", username: "previewsky" },
          { id: randomUUID(), platform: "linkedin", username: "Preview person" },
          { id: randomUUID(), platform: "x", username: "previewx" },
        ];
        for (const account of accounts)
          execFileSync("sqlite3", [
            "-cmd",
            ".timeout 5000",
            `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
            `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account.id}','${workspace.id}','preview-${account.id}','${account.platform}','${account.id}','${account.username}',X'00',1);`,
          ]);
        await page.route("**/api/v1/capabilities/resolve", (route) =>
          route.fulfill({
            json: {
              accounts: accounts.map((account) => ({
                account_id: account.id,
                provider: account.platform,
                profile: "link_share",
                output_profile: `${account.platform}.post`,
                segment_strategy: "preserve",
                label: account.platform,
                text_limit:
                  account.platform === "x" ? 280 : account.platform === "bluesky" ? 300 : 3000,
                media: {
                  min_count: 0,
                  max_count: 4,
                  allowed_mimes: [],
                  requires_public_url: false,
                  requires_https_fetchable: false,
                },
                intents: ["post"],
                media_shapes: ["text"],
                settings:
                  account.platform === "bluesky"
                    ? [
                        {
                          key: "link_url",
                          label: "Link URL",
                          type: "url",
                          control: "url",
                          scope: "destination",
                          group: "content",
                        },
                        {
                          key: "link_title",
                          label: "Link title",
                          type: "text",
                          control: "text",
                          scope: "destination",
                          group: "content",
                        },
                        {
                          key: "link_description",
                          label: "Link description",
                          type: "textarea",
                          control: "textarea",
                          scope: "destination",
                          group: "content",
                        },
                      ]
                    : account.platform === "linkedin"
                      ? [
                          {
                            key: "url",
                            label: "URL",
                            type: "url",
                            control: "url",
                            scope: "destination",
                            group: "content",
                          },
                          {
                            key: "article_title",
                            label: "Article title",
                            type: "text",
                            control: "text",
                            scope: "destination",
                            group: "content",
                          },
                          {
                            key: "article_description",
                            label: "Article description",
                            type: "textarea",
                            control: "textarea",
                            scope: "destination",
                            group: "content",
                          },
                        ]
                      : [
                          {
                            key: "poll_options",
                            label: "Poll",
                            type: "textarea",
                            control: "poll",
                            scope: "segment",
                            group: "content",
                            constraints: {
                              min_items: 2,
                              max_items: 4,
                              max_length: 25,
                            },
                          },
                          {
                            key: "poll_duration_minutes",
                            label: "Duration",
                            type: "number",
                            scope: "segment",
                            group: "content",
                            constraints: { minimum: 5, maximum: 10080 },
                          },
                        ],
                setting_groups: [],
                compatible: true,
                active_constraints: {},
                issues: [],
                capability_revision: "editable-test",
                dynamic_options: {},
                immediate_readiness: { state: "healthy", publishable: true },
                scheduled_readiness: { state: "healthy", publishable: true },
              })),
            },
          }),
        );
        const headers = { Authorization: `Bearer ${auth.token}` };
        const shared =
          width === 320
            ? "Shared introduction"
            : "Shared introduction https://shared.example/start";
        const created = await request.post("/api/v1/publications", {
          headers,
          data: {
            workspace_id: workspace.id,
            title: "Preview flow",
            content_profile: "short_text",
            source_text: shared,
            segments: [
              {
                body: shared,
                settings:
                  width === 320
                    ? {}
                    : {
                        link: {
                          destinations: Object.fromEntries(
                            accounts.map((account) => [account.id, { mode: "post" }]),
                          ),
                        },
                      },
              },
            ],
            renditions: accounts.map((account) => ({
              social_account_id: account.id,
              ...(width === 320 && account.platform === "linkedin"
                ? { segments: [{ body: shared, settings: { url: "https://legacy.example/card" } }] }
                : {}),
            })),
          },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const publication = await created.json();
        const url = `/publications/${publication.id}?workspace_id=${workspace.id}`;
        await authenticatePage(page, auth.token);
        await page.goto(url);
        const frame = page.getByTestId("composer-account-preview");
        await expect(frame).toHaveCount(0);
        await page.screenshot({ path: info.outputPath("shared-editor.png") });
        const lastAccountTab = composerDestinations(page).getByRole("tab", {
          name: /@previewx, X/,
        });
        await lastAccountTab.click();
        await expect(frame).toBeVisible();
        const tabsBounds = await composerDestinations(page).boundingBox();
        const lastTabBounds = await lastAccountTab.boundingBox();
        expect(lastTabBounds!.x).toBeGreaterThanOrEqual(tabsBounds!.x - 1);
        expect(lastTabBounds!.x + lastTabBounds!.width).toBeLessThanOrEqual(
          tabsBounds!.x + tabsBounds!.width + 1,
        );
        await composerDestinations(page)
          .getByRole("tab", { name: /@previewsky, Bluesky/ })
          .click();
        await expect(frame).toBeVisible();
        await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
        const skyText = frame.getByRole("textbox", {
          name: "Post text",
          exact: true,
        });
        await expect(skyText).toBeEnabled();
        const sharedControl = page.getByRole("button", { name: "Shared content", exact: true });
        await expect(sharedControl).toHaveAttribute("aria-pressed", "true");
        await page.screenshot({ path: info.outputPath("account-shared-preview.png") });
        await sharedControl.focus();
        await page.keyboard.press("Space");
        await expect(sharedControl).toHaveAttribute("aria-pressed", "false");
        await expect
          .poll(async () => {
            const detail = await (
              await request.get(`/api/v1/publications/${publication.id}`, { headers })
            ).json();
            const rendition = detail.renditions.find(
              (item: { social_account_id: string }) => item.social_account_id === accounts[0].id,
            );
            return {
              bodyOverride: rendition.segments[0].body_override,
              mediaInherited: rendition.segments[0].media_inherited,
            };
          })
          .toEqual({ bodyOverride: shared, mediaInherited: false });
        await page.reload();
        await composerDestinations(page)
          .getByRole("tab", { name: /@previewsky, Bluesky/ })
          .click();
        await expect(sharedControl).toHaveAttribute("aria-pressed", "false");
        await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Post text", exact: true })
          .fill(`${shared} updated`);
        await composerDestinations(page)
          .getByRole("tab", { name: /@previewsky, Bluesky/ })
          .click();
        await expectPostText(skyText, shared);
        await sharedControl.click();
        await expect(sharedControl).toHaveAttribute("aria-pressed", "true");
        await expectPostText(skyText, `${shared} updated`);
        await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
        await page.getByRole("textbox", { name: "Post text", exact: true }).fill(shared);
        await composerDestinations(page)
          .getByRole("tab", { name: /@previewsky, Bluesky/ })
          .click();
        await expectPostText(skyText, shared);

        if (width === 320) await skyText.fill("A Bluesky-only update https://account.example/new");
        await frame.getByRole("button", { name: "Edit", exact: true }).click();
        await frame
          .getByRole("textbox", { name: "Link title", exact: true })
          .fill("Discard this headline");
        await page.keyboard.press("Escape");
        await expect(frame.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
        await frame.getByRole("button", { name: "Edit", exact: true }).click();
        const link = frame.getByTestId("preview-link-editor");
        await link
          .getByRole("textbox", { name: "Link title", exact: true })
          .fill("A Bluesky headline");
        await link
          .getByRole("textbox", { name: "Link description", exact: true })
          .fill("Only this card.");
        await link.getByRole("button", { name: "Save", exact: true }).click();
        await expect(frame.getByText("A Bluesky headline", { exact: true })).toBeVisible();
        if (width !== 320)
          await expect(page.getByText("Using shared text", { exact: true })).toHaveCount(0);
        await skyText.fill("");
        await page.keyboard.insertText("東京");
        await expectPostText(skyText, "東京");
        await skyText.fill("A Bluesky-only update https://account.example/new");
        await expect(page.getByText("Custom text", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Use shared", exact: true })).toHaveCount(0);
        const navigation = page.getByRole("region", { name: "Destinations", exact: true });
        const rowItems = [
          composerDestinations(page).getByRole("tab", { name: /@previewsky, Bluesky/ }),
          sharedControl,
          page.getByRole("button", { name: "Full preview", exact: true }),
          page
            .getByTestId("composer-variant-toolbar")
            .getByRole("button", { name: "More", exact: true }),
        ];
        const bounds = await Promise.all(rowItems.map((item) => item.boundingBox()));
        expect(bounds.every((bounds) => bounds!.height >= 44)).toBe(true);
        const centers = bounds.map((bounds) => bounds!.y + bounds!.height / 2);
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(4);
        const navigationBounds = await navigation.boundingBox();
        const previewBounds = await frame.boundingBox();
        expect(
          previewBounds!.y - (navigationBounds!.y + navigationBounds!.height),
        ).toBeLessThanOrEqual(16);

        await expect(frame.getByText("account.example", { exact: true })).toBeVisible();
        await expect
          .poll(async () => {
            const detail = await (
              await request.get(`/api/v1/publications/${publication.id}`, {
                headers,
              })
            ).json();
            const rendition = detail.renditions.find(
              (item: any) => item.social_account_id === accounts[0].id,
            );
            return {
              body: rendition.segments[0].body,
              url: rendition.segments[0].settings?.link_url,
              title: rendition.settings?.link_title ?? rendition.segments[0].settings?.link_title,
            };
          })
          .toEqual({
            body: "A Bluesky-only update https://account.example/new",
            url: "https://account.example/new",
            title: "A Bluesky headline",
          });
        await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
        await expectPostText(page.getByRole("textbox", { name: "Post text", exact: true }), shared);
        await composerDestinations(page)
          .getByRole("tab", { name: /Preview person, LinkedIn/ })
          .click();
        if (width === 320)
          await expect(frame.getByText("legacy.example", { exact: true }).first()).toBeVisible();
        if (width === 320)
          await frame
            .getByRole("textbox", { name: "Post text", exact: true })
            .fill("LinkedIn-only https://article.example/card");
        await frame.getByRole("button", { name: "Edit", exact: true }).click();
        await frame
          .getByRole("textbox", { name: "Link title", exact: true })
          .fill("An independent article");
        await frame.getByRole("button", { name: "Save", exact: true }).click();
        await expect(frame.getByText("An independent article", { exact: true })).toBeVisible();
        await expect
          .poll(async () => {
            const detail = await (
              await request.get(`/api/v1/publications/${publication.id}`, {
                headers,
              })
            ).json();
            return detail.renditions.find((item: any) => item.social_account_id === accounts[1].id)
              .settings.article_title;
          })
          .toBe("An independent article");
        await page.goto(url);
        await composerDestinations(page)
          .getByRole("tab", { name: /@previewsky, Bluesky/ })
          .click();
        await expectPostText(
          frame.getByRole("textbox", { name: "Post text", exact: true }),
          "A Bluesky-only update https://account.example/new",
        );
        await expect(frame.getByText("account.example", { exact: true })).toBeVisible();
        await expect(frame.getByText("A Bluesky headline", { exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath("account-link-preview.png") });
        const popupEvent = page.waitForEvent("popup");
        await page.getByRole("button", { name: "Full preview", exact: true }).click();
        const popup = await popupEvent;
        await expect(
          popup.getByText("A Bluesky-only update https://account.example/new", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(popup.getByRole("textbox", { name: "Post text", exact: true })).toHaveCount(0);
        await popup.close();
        await page
          .getByTestId("composer-variant-toolbar")
          .getByRole("button", { name: "More", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await page.getByRole("menuitem", { name: "Use shared", exact: true }).click();
        await expectPostText(skyText, shared);
        await expect(
          page
            .getByTestId("composer-variant-toolbar")
            .getByRole("button", { name: "More", exact: true }),
        ).toBeFocused();
        await expect
          .poll(async () => {
            const detail = await (
              await request.get(`/api/v1/publications/${publication.id}`, { headers })
            ).json();
            const rendition = detail.renditions.find(
              (item: { social_account_id: string }) => item.social_account_id === accounts[0].id,
            );
            return {
              body: rendition.segments[0].body,
              title: rendition.settings?.link_title ?? rendition.segments[0].settings?.link_title,
            };
          })
          .toEqual({ body: shared, title: "A Bluesky headline" });
        await expect(sharedControl).toHaveAttribute("aria-pressed", "true");
        await sharedControl.click();
        await expect(sharedControl).toHaveAttribute("aria-pressed", "false");
        await sharedControl.click();
        await expect(sharedControl).toHaveAttribute("aria-pressed", "true");
        await expect
          .poll(async () => {
            const detail = await (
              await request.get(`/api/v1/publications/${publication.id}`, { headers })
            ).json();
            return detail.renditions.find(
              (item: { social_account_id: string }) => item.social_account_id === accounts[0].id,
            ).settings.link_title;
          })
          .toBe("A Bluesky headline");

        await composerDestinations(page)
          .getByRole("tab", { name: /@previewx, X/ })
          .click();
        await page.getByRole("button", { name: "Add poll", exact: true }).click();
        const pollDialog = page.getByRole("dialog", {
          name: "Add poll",
          exact: true,
        });
        await pollDialog.getByRole("textbox", { name: "Question", exact: true }).fill("Use this?");
        await pollDialog.getByRole("textbox", { name: "Option 1", exact: true }).fill("Yes");
        await pollDialog.getByRole("textbox", { name: "Option 2", exact: true }).fill("No");
        await pollDialog.getByRole("button", { name: "Add poll", exact: true }).click();
        await frame.getByRole("button", { name: "Edit poll", exact: true }).click();
        const pollEditor = frame.getByTestId("preview-poll-editor");
        await pollEditor
          .getByRole("textbox", { name: "Question", exact: true })
          .fill("For this account only?");
        await pollEditor.getByRole("textbox", { name: "Option 1", exact: true }).fill("Maybe");
        await pollEditor.getByRole("button", { name: "Save", exact: true }).click();
        await expect(frame.getByText("For this account only?", { exact: true })).toBeVisible();
        await expect(frame.getByText("Maybe", { exact: true })).toBeVisible();
        await expect
          .poll(async () => {
            const detail = await (
              await request.get(`/api/v1/publications/${publication.id}`, {
                headers,
              })
            ).json();
            const sourcePoll = detail.segments[0].settings?.poll;
            return {
              shared: sourcePoll?.question,
              custom: sourcePoll?.destinations[accounts[2].id]?.poll?.question,
              sky: sourcePoll?.destinations[accounts[0].id]?.mode,
            };
          })
          .toEqual({
            shared: "Use this?",
            custom: "For this account only?",
            sky: "omit",
          });
        await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
        await expect(
          page.getByTestId("shared-poll-editor").getByText("Use this?", { exact: true }),
        ).toBeVisible();
        await composerDestinations(page)
          .getByRole("tab", { name: /@previewx, X/ })
          .click();
        const accessibility = await new AxeBuilder({ page })
          .include('[data-testid="composer-account-preview"]')
          .include('[aria-label="Destinations"]')
          .analyze();
        expect(accessibility.violations).toEqual([]);
        expect(
          await frame
            .locator("button:visible,input:visible,textarea:visible")
            .evaluateAll((elements) =>
              elements.flatMap((element) => {
                const bounds = element.getBoundingClientRect();
                return bounds.height > 0 && bounds.height < 44
                  ? [
                      {
                        label: element.getAttribute("aria-label") ?? element.textContent,
                        height: bounds.height,
                      },
                    ]
                  : [];
              }),
            ),
        ).toEqual([]);

        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await frame.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath("account-preview.png") });
        expect(errors).toEqual([]);
      });
    }
});

test.describe("composer youtube settings", () => {
  const hint = "Add a video in All or this account to edit video settings.";

  test("YouTube settings explain required video before fields are resolved", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(90_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const auth = await registerUser(request, `youtube-settings-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "YouTube settings discovery");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','youtube-${accountID}','youtube','${accountID}','Audit video channel',X'00',1);`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const uploaded = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        file: {
          name: "audit-youtube-settings.mp4",
          mimeType: "video/mp4",
          buffer: readFileSync(
            new URL("./fixtures/product-screenshots/study-sos-demo.mp4", import.meta.url),
          ),
        },
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBe(true);
    const media = await uploaded.json();
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Audit YouTube settings",
        content_profile: "text",
        source_text: "Audit internal unscheduled video description.",
        renditions: [{ social_account_id: accountID }],
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    const path = `/api/v1/publications/${publication.id}`;
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.reload();
        await page.locator(`#composer-destination-${accountID}`).click();
        const settings = page
          .getByTestId("composer-variant-toolbar")
          .getByRole("button", { name: "More", exact: true });
        await settings.focus();
        await settings.press("Enter");
        await page.getByRole("menuitem", { name: "Platform settings", exact: true }).click();
        const dialog = page.getByRole("dialog", {
          name: "YouTube settings",
          exact: true,
        });
        await expect(dialog.getByText(hint, { exact: true })).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`youtube-empty-${width}-${scheme}.png`),
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(settings).toBeFocused();
      }
    const shared = composerDestinations(page).getByRole("tab", { name: "All", exact: true });
    await shared.focus();
    await shared.press("Enter");
    const add = page
      .getByRole("region", { name: "Required destination details" })
      .getByRole("button", { name: "Add media", exact: true });
    await add.focus();
    await add.press("Enter");
    const picker = page.getByRole("dialog");
    await picker.getByRole("tab", { name: "Library", exact: true }).click();
    await picker
      .getByRole("button", {
        name: "Select audit-youtube-settings.mp4",
        exact: true,
      })
      .click();
    await picker.getByRole("button", { name: /^Add/ }).click();
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return (saved.segments[0].media ?? []).map((item: { id: string }) => item.id);
      })
      .toEqual([media.id]);
    await page.locator(`#composer-destination-${accountID}`).click();
    await openComposerPlatformSettings(page);
    const populated = page.getByRole("dialog", {
      name: "YouTube settings",
      exact: true,
    });
    await expect(populated.getByText(hint, { exact: true })).toHaveCount(0);
    await expect(populated.getByRole("textbox", { name: /^Title/ })).toBeVisible();
    const kids = populated.getByRole("button", { name: "Made for kids", exact: true });
    const synthetic = populated.getByRole("button", {
      name: "Contains synthetic media",
      exact: true,
    });
    await expect(kids).toHaveText("Not specified");
    await expect(synthetic).toHaveText("Not specified");
    await kids.click();
    await page.getByRole("option", { name: "No", exact: true }).click();
    await synthetic.click();
    await page.getByRole("option", { name: "Yes", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return [
          saved.renditions[0].settings?.self_declared_made_for_kids,
          saved.renditions[0].settings?.contains_synthetic_media,
        ];
      })
      .toEqual([false, true]);
    await page.reload();
    await page.locator(`#composer-destination-${accountID}`).click();
    await openComposerPlatformSettings(page);
    await expect(kids).toHaveText("No");
    await expect(synthetic).toHaveText("Yes");
    for (const choice of [kids, synthetic]) {
      await choice.click();
      await page.getByRole("option", { name: "Not specified", exact: true }).click();
    }
    await page.screenshot({
      path: info.outputPath("youtube-video-fields-320-dark.png"),
    });
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return [
          saved.renditions[0].settings?.self_declared_made_for_kids ?? null,
          saved.renditions[0].settings?.contains_synthetic_media ?? null,
        ];
      })
      .toEqual([null, null]);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.reload();
        await page.locator(`#composer-destination-${accountID}`).click();
        await openComposerPlatformSettings(page);
        const dialog = page.getByRole("dialog", {
          name: "YouTube settings",
          exact: true,
        });
        const description = dialog.getByRole("textbox", {
          name: "Description",
          exact: true,
        });
        await description.focus();
        await expect(description).toBeFocused();
        await description.fill("😀".repeat(1251));
        await expect(description).toHaveAttribute("aria-invalid", "true");
        await expect(dialog.getByText("5004 / 5000 bytes", { exact: true })).toBeVisible();
        await expect
          .poll(() =>
            dialog.getByText("5004 / 5000 bytes", { exact: true }).evaluate((element) => {
              const rect = element.getBoundingClientRect();
              for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                if (!/auto|scroll|hidden/.test(getComputedStyle(parent).overflowY)) continue;
                const bounds = parent.getBoundingClientRect();
                if (rect.top < bounds.top || rect.bottom > bounds.bottom) return false;
              }
              return rect.top >= 0 && rect.bottom <= window.innerHeight;
            }),
          )
          .toBe(true);
        await page.screenshot({
          path: info.outputPath(`youtube-description-overflow-${width}-${scheme}.png`),
        });
        await description.fill("Launch <now>");
        await expect(
          dialog.getByText("Descriptions cannot contain < or >.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(description).toHaveAccessibleDescription(
          /Descriptions cannot contain < or >\./,
        );
        await description.fill("é".repeat(2500));
        await expect(description).toHaveAttribute("aria-invalid", "false");
        await expect(dialog.getByText("5000 / 5000 bytes", { exact: true })).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`youtube-description-valid-${width}-${scheme}.png`),
        });
        await page.keyboard.press("Escape");
      }
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return saved.renditions[0].description;
      })
      .toBe("é".repeat(2500));
    const saved = await (await request.get(path, { headers })).json();
    expect(saved.renditions[0].settings?.self_declared_made_for_kids ?? null).toBeNull();
    expect(saved.renditions[0].settings?.contains_synthetic_media ?? null).toBeNull();
    expect(saved.status).toBe("draft");
    expect(saved.scheduled_at).toBeFalsy();
    expect(pageErrors).toEqual([]);
  });
});

test.describe("composer time slots", () => {
  test("composer advances saved time slots across hour boundaries", async ({
    page,
    request,
  }, info) => {
    const auth = await registerUser(request, `slots-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Time slot intervals");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const settings = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
      headers,
      data: { timezone: "UTC", slot_start_hour: 5, slot_end_hour: 23, slot_interval_minutes: 90 },
    });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    await authenticatePage(page, auth.token);
    await page.goto(`/?workspace_id=${workspace.id}`);
    await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toBeVisible();
    await clickComposerDeliveryAction(page, "Schedule");
    const dialog = page.getByTestId("schedule-dialog-shell");
    await dialog.getByRole("button", { name: "Tomorrow 09:00", exact: true }).click();
    const savedTimes = dialog.getByRole("button", { name: "Saved times", exact: true });
    // Choose the second slot as opening first enters the list, before deferred focus runs.
    await page.evaluate(() => {
      const chooseSecond = (event: FocusEvent) => {
        const button = event.target as HTMLElement;
        if (!button.closest('[data-testid="schedule-dialog-time-list"]')) return;
        document.removeEventListener("focusin", chooseSecond);
        queueMicrotask(() =>
          document
            .querySelector<HTMLButtonElement>(
              '[data-testid="schedule-dialog-time-list"] button:nth-child(2)',
            )
            ?.focus(),
        );
      };
      document.addEventListener("focusin", chooseSecond);
    });
    await savedTimes.focus();
    await page.keyboard.press("Enter");
    const slots = page.getByTestId("schedule-dialog-time-list");
    await expect(slots.getByRole("button")).toHaveText([
      "05:00",
      "06:30",
      "08:00",
      "09:30",
      "11:00",
      "12:30",
      "14:00",
      "15:30",
      "17:00",
      "18:30",
      "20:00",
      "21:30",
      "23:00",
    ]);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(slots.getByRole("button", { name: "06:30", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("Publish time", { exact: true })).toHaveValue("06:30");
    await expect(slots).not.toBeVisible();
    await expect(savedTimes).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Schedule", exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath("ninety-minute-slots.png") });
    for (const width of [320]) {
      for (const colorScheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await savedTimes.click();
        await expect(slots.getByRole("button")).toHaveCount(13);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await slots.getByRole("button", { name: "06:30", exact: true }).focus();
        await expect(slots.getByRole("button", { name: "06:30", exact: true })).toBeFocused();
        await page.screenshot({ path: info.outputPath(`slots-${width}-${colorScheme}.png`) });
        await page.keyboard.press("Escape");
        await expect(slots).not.toBeVisible();
        await expect(savedTimes).toBeFocused();
        await expect(dialog).toBeVisible();
      }
    }
  });

  test.describe("schedule history on touch screens", () => {
    test.use({ hasTouch: true });
    test("schedule picker shows published history without selecting a past schedule", async ({
      page,
      request,
    }, info) => {
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") runtimeErrors.push(message.text());
      });
      const auth = await registerUser(request, `schedule-history-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Schedule history");
      const draft = await createPublication(request, auth.token, workspace.id, "A shipped update");
      const response = await request.get(`/api/v1/publications/${draft.id}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      expect(response.ok()).toBeTruthy();
      const publication = await response.json();
      await page.clock.setFixedTime(new Date("2026-10-15T12:00:00Z"));
      await page.route("**/api/v1/accounts?**", async (route) =>
        route.fulfill({
          json: [
            {
              id: "schedule-target",
              workspace_id: workspace.id,
              platform: "bluesky",
              account_id: "did:plc:schedule-target",
              account_username: "schedule_target",
              is_active: true,
            },
          ],
        }),
      );
      await page.route("**/api/v1/capabilities/resolve", async (route) =>
        route.fulfill({
          json: {
            accounts: [
              {
                account_id: "schedule-target",
                provider: "bluesky",
                profile: "short_text",
                output_profile: "bluesky.post",
                label: "Bluesky post",
                text_limit: 300,
                media: {
                  min_count: 0,
                  max_count: 4,
                  allowed_mimes: [],
                  requires_public_url: false,
                  requires_https_fetchable: false,
                },
                intents: ["post"],
                media_shapes: ["text"],
                settings: [],
                setting_groups: [],
                compatible: true,
                active_constraints: {},
                issues: [],
                capability_revision: "test-v1",
                dynamic_options: {},
                immediate_readiness: { state: "healthy", publishable: true },
                scheduled_readiness: { state: "healthy", publishable: true },
              },
            ],
          },
        }),
      );

      await page.route("**/api/v1/publications?**", async (route) => {
        if (!new URL(route.request().url()).searchParams.has("calendar_from"))
          return route.continue();
        await route.fulfill({
          json: [
            {
              ...publication,
              status: "published",
              scheduled_at: "2026-10-13T09:00:00Z",
              actual_run_at: "2026-10-14T10:24:00Z",
            },
            {
              ...publication,
              id: "earlier-lesson",
              title: "",
              source_text: "An earlier lesson",
              status: "published",
              actual_run_at: "2026-10-14T11:00:00Z",
            },
            {
              ...publication,
              id: "planned-update",
              title: "A planned update",
              status: "scheduled",
              scheduled_at: "2026-10-16T09:00:00Z",
              actual_run_at: "2026-10-16T09:15:00Z",
            },
          ],
        });
      });
      const savedDraft = {
        ...publication,
        id: "schedule-draft",
        title: "",
        source_text: "The next update",
        renditions: [],
      };
      await page.route("**/api/v1/publications", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fulfill({ json: savedDraft });
      });
      await page.route("**/api/v1/publications/schedule-draft", async (route) => {
        await route.fulfill({ json: { ...savedDraft, revision: 2 } });
      });
      await authenticatePage(page, auth.token);
      await page.goto(`/?workspace_id=${workspace.id}`);
      await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toBeVisible();
      await page.getByRole("textbox", { name: "Post text", exact: true }).fill("The next update");
      await clickComposerDeliveryAction(page, "Schedule");
      const dialog = page.getByTestId("schedule-dialog-shell");
      await expect(dialog).toBeVisible();
      const yesterday = dialog.locator('[data-bits-day][data-value="2026-10-14"]');
      await expect(yesterday).not.toHaveAttribute("aria-disabled", "true");
      await yesterday.focus();
      await expect(yesterday).toBeFocused();
      await page.keyboard.press("Enter");
      const agenda = dialog.getByTestId("schedule-dialog-agenda");
      await expect(agenda.getByText("A shipped update", { exact: true })).toBeVisible();
      await expect(agenda.getByText("10:24", { exact: true })).toBeVisible();
      await expect(agenda.getByText("Published", { exact: true })).toHaveCount(2);
      await expect(agenda.getByText("An earlier lesson", { exact: true })).toHaveCount(1);
      await expect(dialog.getByRole("button", { name: "Schedule", exact: true })).toBeDisabled();
      await expect(dialog.locator("input[type=time]")).toHaveCount(0);
      await expect(dialog.getByText(/^Selected /)).toHaveCount(0);
      await dialog.getByRole("button", { name: "Tomorrow 09:00", exact: true }).click();
      await expect(agenda.getByText("A planned update", { exact: true })).toBeVisible();
      await expect(agenda.getByRole("time")).toHaveText("09:00");
      await expect(agenda.getByText("Scheduled", { exact: true })).toBeVisible();
      const time = dialog.getByLabel("Publish time", { exact: true });
      await expect(time).toHaveValue("09:00");
      await time.fill("14:37");
      await expect(time).toHaveValue("14:37");
      await expect(dialog.getByRole("button", { name: "Schedule", exact: true })).toBeEnabled();
      await dialog.locator('[data-bits-day][data-value="2026-10-14"]').click();
      for (const width of [1280, 320]) {
        for (const colorScheme of ["light"] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
          await dialog.locator('[data-bits-day][data-value="2026-10-16"]').click();
          await expect(time).toHaveValue("14:37");
          await expect(
            agenda.getByRole("heading", { name: "Friday, Oct 16", exact: true }),
          ).toBeVisible();
          await expect(agenda.getByText("A planned update", { exact: true })).toBeVisible();
          if (width === 320 && colorScheme === "dark") {
            const accessibility = await new AxeBuilder({ page })
              .include('[data-testid="schedule-dialog-shell"]')
              .analyze();
            expect(accessibility.violations).toEqual([]);
          }
          await dialog.screenshot({
            path: info.outputPath(`schedule-future-${width}-${colorScheme}.png`),
          });
          const savedTimes = dialog.getByRole("button", { name: "Saved times", exact: true });
          await savedTimes.click();
          await expect(page.getByTestId("schedule-dialog-time-list")).toBeVisible();
          await dialog.locator('[data-bits-day][data-value="2026-10-14"]').click();
          await expect(page.getByTestId("schedule-dialog-time-list")).not.toBeVisible();
          await expect(dialog.locator("input[type=time]")).toHaveCount(0);
          await expect(dialog.getByText(/^Selected /)).toHaveCount(0);
          await expect(agenda.getByText("A shipped update", { exact: true })).toBeVisible();
          await expect
            .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
            .toBe(true);
          const dateTarget = dialog.locator('[data-bits-day][data-value="2026-10-14"]');
          const bounds = await dateTarget.boundingBox();
          expect(bounds?.width).toBeGreaterThanOrEqual(44);
          expect(bounds?.height).toBeGreaterThanOrEqual(44);
          if (width < 640) {
            const lastPost = agenda.getByRole("listitem").last();
            await expect(lastPost).toContainText("An earlier lesson");
            await lastPost.scrollIntoViewIfNeeded();
            const postBounds = await lastPost.boundingBox();
            const bodyBounds = await page.getByTestId("schedule-dialog-body").boundingBox();
            expect(postBounds).not.toBeNull();
            expect(bodyBounds).not.toBeNull();
            // The 13px body text uses fractional line heights, so a fully scrolled
            // last item can still sit a fraction of a pixel past the body edge.
            expect(postBounds!.y + postBounds!.height).toBeLessThanOrEqual(
              bodyBounds!.y + bodyBounds!.height + 1,
            );
            await expect(
              dialog.getByRole("button", { name: "Cancel", exact: true }),
            ).toBeInViewport();
          }
          await dialog.screenshot({
            path: info.outputPath(`schedule-history-${width}-${colorScheme}.png`),
          });
        }
      }
      expect(runtimeErrors).toEqual([]);
    });
  });
});

test.describe("composer text cards", () => {
  test("text cards show a dismissible notice without a missing-image warning", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `text-card-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Text card previews");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      process.env.OPENPOST_APP_E2E_DB_PATH ??
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','card-${accountID}','instagram','${accountID}','samplefounder',X'00',1);`,
    ]);
    const response = await request.post("/api/v1/publications", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        workspace_id: workspace.id,
        title: "Text card",
        content_profile: "short_text",
        source_text: "A small release worth sharing.",
        social_account_ids: [accountID],
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const publication = await response.json();
    expect(publication.renditions[0].segments[0].output_media[0].role).toBe("text_card");
    // Reopening a saved card must work even while fresh rendering is unavailable.
    let previewRequests = 0;
    await page.route("**/api/v1/publications/preview-text-card", async (route) => {
      previewRequests++;
      await route.fulfill({
        status: 429,
        json: { detail: "Text card rendering is busy; try again shortly" },
      });
    });
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    const customize = page.getByRole("button", { name: "Customize card", exact: true });
    await expect(customize).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: /^Accounts:/ }).click();
    await expect(
      page.getByText("Instagram publishing requires 1-10 image or video attachments.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Text will be published as an image.", { exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await customize.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("img", { name: "Text card 1", exact: true })).toBeVisible();
    await expect(dialog.getByRole("img", { name: "Text card 1", exact: true })).toHaveAttribute(
      "src",
      publication.renditions[0].segments[0].output_media[0].url,
    );
    await expect
      .poll(() =>
        dialog
          .getByRole("img", { name: "Text card 1", exact: true })
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    expect(previewRequests).toBe(0);
    await page.keyboard.press("Escape");
    await expect(customize).toBeFocused();
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(customize).toHaveCount(0);
  });
});
