import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.use({ hasTouch: true });

for (const width of [1280, 390, 320])
  for (const scheme of ["light", "dark"] as const) {
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
        width === 320 ? "Shared introduction" : "Shared introduction https://shared.example/start";
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
      await page.getByRole("tab", { name: /@previewsky, Bluesky/ }).click();
      await expect(frame).toBeVisible();
      await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
      const skyText = frame.getByRole("textbox", {
        name: "Post text",
        exact: true,
      });
      await expect(skyText).toBeEnabled();
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
        await expect(page.getByText("Using shared text", { exact: true })).toBeVisible();
      await skyText.evaluate((element) => {
        element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        element.value = "東京";
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertCompositionText",
            data: "東京",
            isComposing: true,
          }),
        );
        element.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true, data: "東京" }),
        );
      });
      await expect(skyText).toHaveValue("東京");
      await skyText.fill("A Bluesky-only update https://account.example/new");
      await expect(page.getByText("Custom text", { exact: true })).toBeVisible();
      const rowItems = [
        page.getByText("Custom text", { exact: true }),
        page.getByRole("button", { name: "Use shared", exact: true }),
        page.getByRole("button", { name: "Full preview", exact: true }),
        page
          .getByTestId("composer-variant-toolbar")
          .getByRole("button", { name: "More", exact: true }),
      ];
      const bounds = await Promise.all(rowItems.map((item) => item.boundingBox()));
      const centers = bounds.map((bounds) => bounds!.y + bounds!.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(4);

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
      await page.getByRole("tab", { name: "All", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Post text", exact: true })).toHaveValue(
        shared,
      );
      await page.getByRole("tab", { name: /Preview person, LinkedIn/ }).click();
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
      await page.getByRole("tab", { name: /@previewsky, Bluesky/ }).click();
      await expect(frame.getByRole("textbox", { name: "Post text", exact: true })).toHaveValue(
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

      await page.getByRole("tab", { name: /@previewx, X/ }).click();
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
      await page.getByRole("tab", { name: "All", exact: true }).click();
      await expect(
        page.getByTestId("shared-poll-editor").getByText("Use this?", { exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: /@previewx, X/ }).click();
      const accessibility = await new AxeBuilder({ page })
        .include('[data-testid="composer-account-preview"]')
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
