import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  registerUser,
  composerDestinations,
  expectPostText,
} from "./helpers";
import AxeBuilder from "@axe-core/playwright";

test.describe("destination order", () => {
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
    {
      {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
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
        await page.goto(`/publications?tab=drafts&workspace_id=${workspace.id}`);
        await expect(page.getByRole("tab", { name: "Drafts", exact: true })).toBeVisible();
        await page.goBack();
        await expect(tabs).toHaveCount(accounts.length);
        expect(await readOrder()).toEqual(expectedIDs);
      }
    }
  });
});

test.describe("editable previews", () => {
  test.use({ hasTouch: true });

  test(`account previews edit independently`, async ({ page, request }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
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
    const shared = "Shared introduction https://shared.example/start";
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
            settings: {
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
    await page.getByRole("textbox", { name: "Post text", exact: true }).fill(`${shared} updated`);
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

    await frame.getByRole("button", { name: "Edit", exact: true }).click();
    await frame
      .getByRole("textbox", { name: "Link title", exact: true })
      .fill("Discard this headline");
    await page.keyboard.press("Escape");
    await expect(frame.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
    await frame.getByRole("button", { name: "Edit", exact: true }).click();
    const link = frame.getByTestId("preview-link-editor");
    await link.getByRole("textbox", { name: "Link title", exact: true }).fill("A Bluesky headline");
    await link
      .getByRole("textbox", { name: "Link description", exact: true })
      .fill("Only this card.");
    await link.getByRole("button", { name: "Save", exact: true }).click();
    await expect(frame.getByText("A Bluesky headline", { exact: true })).toBeVisible();
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
    expect(previewBounds!.y - (navigationBounds!.y + navigationBounds!.height)).toBeLessThanOrEqual(
      16,
    );

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
      await frame.locator("button:visible,input:visible,textarea:visible").evaluateAll((elements) =>
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

    await frame.scrollIntoViewIfNeeded();
    expect(errors).toEqual([]);
  });
});

test.describe("text cards", () => {
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
