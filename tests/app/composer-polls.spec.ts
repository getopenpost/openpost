import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320]) {
  test.describe(`${width}px controls`, () => {
    test.use({ hasTouch: width < 768 });
    for (const scheme of ["light", "dark"] as const) {
      test(`shared poll choices persist at ${width}px in ${scheme}`, async ({
        page,
        request,
      }, testInfo) => {
        test.setTimeout(60_000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const auth = await registerUser(request, `poll-${randomUUID()}@example.com`);
        const workspace = await createWorkspace(request, auth.token, "Polls");
        await authenticatePage(page, auth.token);
        const targets = [
          { id: randomUUID(), platform: "x", username: "pollx" },
          { id: randomUUID(), platform: "bluesky", username: "pollsky" },
          { id: randomUUID(), platform: "mastodon", username: "pollmastodon" },
          { id: randomUUID(), platform: "linkedin", username: "polllinkedin" },
        ];
        for (const account of targets)
          execFileSync("sqlite3", [
            "-cmd",
            ".timeout 5000",
            `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
            `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account.id}','${workspace.id}','poll-${account.id}','${account.platform}','${account.id}','${account.username}',X'00',1);`,
          ]);
        await page.route("**/api/v1/capabilities/resolve", (route) =>
          route.fulfill({
            json: {
              accounts: targets.map((account) => ({
                account_id: account.id,
                provider: account.platform,
                profile: "short_text",
                output_profile: `${account.platform}.post`,
                label: account.platform,
                text_limit: 280,
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
                  account.platform === "x"
                    ? [
                        {
                          key: "poll_options",
                          label: "Poll",
                          type: "textarea",
                          control: "poll",
                          scope: "segment",
                          constraints: { min_items: 2, max_items: 4, max_length: 25 },
                        },
                        {
                          key: "poll_duration_minutes",
                          constraints: { minimum: 5, maximum: 10080 },
                          label: "Duration",
                          type: "number",
                          scope: "segment",
                        },
                      ]
                    : account.platform === "mastodon"
                      ? [
                          {
                            key: "poll_options",
                            label: "Poll",
                            type: "textarea",
                            control: "poll",
                            scope: "segment",
                            constraints: { min_items: 2, max_items: 4 },
                          },
                          {
                            key: "poll_expires_in_seconds",
                            label: "Duration",
                            type: "number",
                            scope: "segment",
                          },
                          {
                            key: "poll_multiple",
                            label: "Multiple selections",
                            type: "boolean",
                            scope: "segment",
                          },
                          {
                            key: "poll_hide_totals",
                            label: "Hide totals",
                            type: "boolean",
                            scope: "segment",
                          },
                        ]
                      : account.platform === "linkedin"
                        ? [
                            {
                              key: "poll_options",
                              label: "Poll",
                              type: "textarea",
                              control: "poll",
                              scope: "segment",
                              constraints: { min_items: 2, max_items: 4, max_length: 30 },
                            },
                            {
                              key: "poll_question",
                              label: "Poll question",
                              type: "text",
                              scope: "segment",
                              constraints: { max_length: 140 },
                            },
                            {
                              key: "poll_duration",
                              label: "Duration",
                              type: "select",
                              scope: "segment",
                              options: ["ONE_DAY", "THREE_DAYS", "SEVEN_DAYS", "FOURTEEN_DAYS"],
                            },
                          ]
                        : [],
                setting_groups: [],
                compatible: true,
                active_constraints: {},
                issues: [],
                capability_revision: "poll-test",
                dynamic_options: {},
                immediate_readiness: { state: "healthy", publishable: true },
                scheduled_readiness: { state: "healthy", publishable: true },
              })),
            },
          }),
        );
        await page.goto("/");
        await page.getByRole("textbox", { name: "Post text", exact: true }).fill("Help us plan.");
        await page.screenshot({ path: testInfo.outputPath("before.png") });
        const add = page.getByRole("button", { name: "Add poll", exact: true });
        const media = page.getByRole("button", { name: "Add media", exact: true });
        await expect(add).toHaveText("");
        await expect(add.locator("svg")).toHaveCount(1);
        expect(
          await media.evaluate((button) => button.nextElementSibling?.getAttribute("aria-label")),
        ).toBe("Add poll");
        await add.focus();
        await page.keyboard.press("Enter");
        let dialog = page.getByRole("dialog", { name: "Add poll", exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/Polls are unavailable on @pollsky/)).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Poll version" })).toHaveCount(0);
        await dialog
          .getByRole("textbox", { name: "Question", exact: true })
          .fill("Cancelled question");
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        const poll = page.getByTestId("shared-poll-editor");
        await expect(poll).toHaveCount(0);
        await expect(add).toBeFocused();
        await add.click();
        await expect(dialog.getByRole("textbox", { name: "Question", exact: true })).toHaveValue(
          "",
        );
        await dialog
          .getByRole("textbox", { name: "Question", exact: true })
          .fill("Would you use this?");
        await dialog.getByRole("textbox", { name: "Option 1", exact: true }).fill("Yes, sometimes");
        await dialog.getByRole("textbox", { name: "Option 2", exact: true }).fill("No");
        expect(
          (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
        ).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath("poll-dialog.png") });
        await dialog.getByRole("button", { name: "Add poll", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(poll.getByRole("textbox")).toHaveCount(0);
        await expect(
          poll.getByText("Choose how to post the poll on these accounts."),
        ).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("poll-shared.png") });
        await poll.getByRole("button", { name: /^@pollsky/ }).click();
        await expect(poll.getByText(/This account cannot publish polls/)).toBeVisible();
        await poll.getByRole("button", { name: "Text version", exact: true }).click();
        await expect(poll.getByText(/Text only, without voting buttons/)).toBeVisible();
        await poll.getByText("Text version preview", { exact: true }).click();
        await expect(
          poll.getByText("Help us plan.\n\nWould you use this?\n1. Yes, sometimes\n2. No", {
            exact: true,
          }),
        ).toBeVisible();
        const accessibility = await new AxeBuilder({ page })
          .include('[data-testid="shared-poll-editor"]')
          .analyze();
        expect(accessibility.violations).toEqual([]);
        if (width < 768) {
          expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
          const smallTargets = await poll
            .locator("button:visible, input:visible, summary:visible")
            .evaluateAll((elements) =>
              elements.flatMap((element) => {
                const bounds = element.getBoundingClientRect();
                return bounds.width > 0 && bounds.height > 0 && bounds.height < 44
                  ? [
                      {
                        label: element.getAttribute("aria-label") ?? element.textContent,
                        height: bounds.height,
                      },
                    ]
                  : [];
              }),
            );
          expect(smallTargets).toEqual([]);
        }
        const bounds = await poll.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await poll
          .getByRole("heading", { name: "Poll", exact: true })
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.screenshot({ path: testInfo.outputPath("poll-fields.png") });
        await page.screenshot({ path: testInfo.outputPath("poll-account.png") });
        const headers = { Authorization: `Bearer ${auth.token}` };
        let saved: any;
        await expect
          .poll(async () => {
            const response = await request.get("/api/v1/publications", {
              headers,
              params: { workspace_id: workspace.id },
            });
            const data = await response.json();
            const items = Array.isArray(data) ? data : (data.items ?? data.publications ?? []);
            saved = items.find((item: any) => item.source_text === "Help us plan.");
            if (!saved) return false;
            const detail = await request.get(`/api/v1/publications/${saved.id}`, { headers });
            saved = await detail.json();
            return (
              saved.segments?.[0]?.settings?.poll?.destinations?.[targets[1].id]?.mode === "text"
            );
          })
          .toBe(true);
        expect(
          saved.renditions.find((item: any) => item.platform === "x").segments[0].settings
            .poll_options,
        ).toBe("Yes, sometimes\nNo");
        const linkedin = saved.renditions.find((item: any) => item.platform === "linkedin")
          .segments[0];
        expect(linkedin.settings.poll_question).toBe("Would you use this?");
        expect(linkedin.body).toBe("Help us plan.");
        expect(saved.renditions.find((item: any) => item.platform === "x").segments[0].body).toBe(
          "Help us plan.\n\nWould you use this?",
        );
        await page.goto(`/publications/${saved.id}`);
        await expect(poll.getByText("Would you use this?", { exact: true })).toBeVisible();
        await poll.getByRole("button", { name: "Edit poll", exact: true }).click();
        dialog = page.getByRole("dialog", { name: "Edit poll", exact: true });
        await expect(dialog.getByRole("textbox", { name: "Question", exact: true })).toHaveValue(
          "Would you use this?",
        );
        await dialog
          .getByRole("textbox", { name: "Question", exact: true })
          .fill("Discard this edit");
        await page.keyboard.press("Escape");
        await expect(poll.getByRole("button", { name: "Edit poll", exact: true })).toBeFocused();
        await expect(poll.getByText("Would you use this?", { exact: true })).toBeVisible();
        await page.getByRole("tab", { name: /@pollx,/ }).click();
        await poll.getByRole("button", { name: "Customize poll", exact: true }).click();
        const custom = page.getByRole("dialog", { name: "Customize poll", exact: true });
        await custom.getByRole("button", { name: "Voting closes after", exact: true }).click();
        await expect(page.getByRole("option", { name: "14 days", exact: true })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await custom.getByRole("textbox", { name: "Question", exact: true }).fill("Usarias isto?");
        await custom.getByRole("button", { name: "Save", exact: true }).click();
        await expect(poll.getByText("Usarias isto?", { exact: true })).toBeVisible();
        await expect(poll.getByRole("checkbox")).toHaveCount(0);
        await page.getByRole("tab", { name: /polllinkedin,/ }).click();
        await poll.getByRole("button", { name: "Customize poll", exact: true }).click();
        const linkedinDialog = page.getByRole("dialog", { name: "Customize poll", exact: true });
        await expect(
          linkedinDialog.getByRole("textbox", { name: "Question", exact: true }),
        ).toHaveAttribute("maxlength", "140");
        await expect(
          linkedinDialog.getByRole("textbox", { name: "Option 1", exact: true }),
        ).toHaveAttribute("maxlength", "30");
        await linkedinDialog
          .getByRole("button", { name: "Voting closes after", exact: true })
          .click();
        await expect(page.getByRole("option")).toHaveText(["1 day", "3 days", "7 days", "14 days"]);
        await page.keyboard.press("Escape");
        await linkedinDialog.getByRole("button", { name: "Add option", exact: true }).click();
        await linkedinDialog.getByRole("button", { name: "Add option", exact: true }).click();
        await expect(
          linkedinDialog.getByRole("button", { name: "Add option", exact: true }),
        ).toBeDisabled();
        await linkedinDialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByRole("tab", { name: /@pollmastodon,/ }).click();
        await poll
          .getByRole("checkbox", { name: "Allow multiple selections", exact: true })
          .check();
        await expect(
          poll.getByRole("checkbox", { name: "Allow multiple selections", exact: true }),
        ).toBeChecked();
        await expect(poll.getByRole("button", { name: "Poll version", exact: true })).toContainText(
          "Custom poll",
        );
        await page.getByRole("tab", { name: "All", exact: true }).click();
        await expect(poll.getByText("Would you use this?", { exact: true })).toBeVisible();
        await page.getByRole("tab", { name: /@pollsky,/ }).click();
        await expect(poll.getByRole("button", { name: "Poll version", exact: true })).toContainText(
          "Text version",
        );
        await poll.getByRole("button", { name: "Customize post text", exact: true }).click();
        const editor = page.getByRole("textbox", { name: "Post text", exact: true });
        await expect(editor).toHaveValue(
          "Help us plan.\n\nWould you use this?\n1. Yes, sometimes\n2. No",
        );
        await expect(poll.getByRole("button", { name: "Poll version", exact: true })).toContainText(
          "Post without poll",
        );
        await editor.fill("A separate question for this audience.");
        await expect
          .poll(async () => {
            const detail = await (
              await request.get(`/api/v1/publications/${saved.id}`, { headers })
            ).json();
            return detail.segments?.[0]?.settings?.poll?.destinations?.[targets[0].id]?.poll
              ?.question;
          })
          .toBe("Usarias isto?");
        await page.goto(`/publications/${saved.id}`);
        await page.getByRole("tab", { name: /@pollx,/ }).click();
        await expect(poll.getByText("Usarias isto?", { exact: true })).toBeVisible();
        const late = { id: randomUUID(), platform: "bluesky", username: "latepoll" };
        targets.push(late);
        execFileSync("sqlite3", [
          "-cmd",
          ".timeout 5000",
          `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
          `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${late.id}','${workspace.id}','poll-${late.id}','bluesky','${late.id}','${late.username}',X'00',1);`,
        ]);
        const current = await (
          await request.get(`/api/v1/publications/${saved.id}`, { headers })
        ).json();
        const added = await request.put(`/api/v1/publications/${saved.id}`, {
          headers,
          data: {
            expected_revision: current.revision,
            renditions: [
              ...current.renditions.map((item: any) => ({
                social_account_id: item.social_account_id,
              })),
              { social_account_id: late.id },
            ],
          },
        });
        expect(added.ok(), await added.text()).toBe(true);
        await page.goto(`/publications/${saved.id}`);
        await expect(poll.getByRole("button", { name: /^@latepoll/ })).toBeVisible();
        const validation = await (
          await request.post(`/api/v1/publications/${saved.id}/validate`, { headers })
        ).json();
        expect(validation.issues.map((issue: { code: string }) => issue.code)).toContain(
          "poll_resolution_required",
        );
        await poll.getByRole("button", { name: /^@latepoll/ }).click();
        await expect(poll.getByText(/This account cannot publish polls/)).toBeVisible();
        await poll.getByRole("button", { name: "Post without poll", exact: true }).click();
        await expect(poll.getByRole("button", { name: "Poll version", exact: true })).toContainText(
          "Post without poll",
        );
        let settled: any;
        await expect
          .poll(async () => {
            settled = await (
              await request.get(`/api/v1/publications/${saved.id}`, { headers })
            ).json();
            return settled.segments[0].settings.poll.destinations[late.id]?.mode;
          })
          .toBe("omit");
        const importedPoll = settled.segments[0].settings.poll;
        const imported = await request.put(`/api/v1/publications/${saved.id}`, {
          headers,
          data: {
            expected_revision: settled.revision,
            segments: settled.segments.map((segment: any, index: number) => ({
              id: segment.id,
              body: segment.body,
              settings:
                index === 0
                  ? {
                      ...segment.settings,
                      poll: {
                        ...importedPoll,
                        multiple: true,
                        hide_totals: true,
                        destinations: {
                          ...importedPoll.destinations,
                          [targets[0].id]: { mode: "native" },
                        },
                      },
                    }
                  : segment.settings,
            })),
          },
        });
        expect(imported.ok(), await imported.text()).toBe(true);
        await page.goto(`/publications/${saved.id}`);
        await page.getByRole("tab", { name: /@pollx,/ }).click();
        await expect(poll.getByText(/does not support the selected voting options/)).toBeVisible();
        await poll
          .getByRole("checkbox", { name: "Allow multiple selections", exact: true })
          .uncheck();
        await poll
          .getByRole("checkbox", { name: "Hide totals until voting ends", exact: true })
          .uncheck();
        await expect(poll.getByText(/does not support the selected voting options/)).toHaveCount(0);
        await expect
          .poll(async () => {
            const detail = await (
              await request.get(`/api/v1/publications/${saved.id}`, { headers })
            ).json();
            const custom = detail.segments[0].settings.poll.destinations[targets[0].id].poll;
            return custom?.multiple === false && custom?.hide_totals === false;
          })
          .toBe(true);
        const resolved = await (
          await request.get(`/api/v1/publications/${saved.id}`, { headers })
        ).json();
        const textOnly = await request.put(`/api/v1/publications/${saved.id}`, {
          headers,
          data: {
            expected_revision: resolved.revision,
            renditions: [{ social_account_id: targets[1].id }],
          },
        });
        expect(textOnly.ok(), await textOnly.text()).toBe(true);
        await page.goto(`/publications/${saved.id}`);
        await poll.getByRole("button", { name: "Remove poll", exact: true }).click();
        await page.getByRole("button", { name: "Add poll", exact: true }).click();
        dialog = page.getByRole("dialog", { name: "Add poll", exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/Polls are unavailable on @pollsky/)).toBeVisible();
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        expect(errors).toEqual([]);
      });
    }
  });
}
