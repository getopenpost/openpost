import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  registerUser,
  composerDestinations,
  createPublication,
  expectPostText,
  clickComposerDeliveryAction,
} from "./helpers";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";

test.describe("thread preservation", () => {
  test("an older open editor cannot delete a reply added by another editor", async ({
    page,
    request,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const auth = await registerUser(request, `thread-preservation-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Thread preservation");
    const original = await createPublication(request, auth.token, workspace.id, "First message");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const path = `/api/v1/publications/${original.id}`;
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${original.id}?workspace_id=${workspace.id}`);
    const editor = page.getByRole("textbox", { name: "Post text", exact: true });
    await expectPostText(editor, "First message");

    const current = await (await request.get(path, { headers })).json();
    const reply = "https://example.com/the-link-in-the-reply";
    const updated = await request.put(path, {
      headers,
      data: {
        expected_revision: current.revision,
        intent: "thread",
        creation_preset: "thread",
        segments: [{ id: current.segments[0].id, body: "First message" }, { body: reply }],
      },
    });
    expect(updated.ok(), await updated.text()).toBeTruthy();

    // The first autosave happens after the detail query's cached revision expires.
    await page.clock.install();
    await page.clock.fastForward(31_000);
    const save = page.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === "PUT",
    );
    await editor.fill("First message, edited in the older tab");
    await page.clock.fastForward(2_100);
    const response = await save;
    const persisted = await (await request.get(path, { headers })).json();
    expect(persisted.segments.map((segment: { body: string }) => segment.body)).toEqual([
      "First message",
      reply,
    ]);
    expect(response.status()).toBe(409);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Reload saved draft", exact: true }).click();
    await expect(editor).toHaveCount(2);
    await expectPostText(editor.nth(1), reply);
    await editor.nth(0).fill("First message, edited after reloading");
    await page.clock.fastForward(2_100);
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return saved.segments.map((segment: { body: string }) => segment.body);
      })
      .toEqual(["First message, edited after reloading", reply]);
  });
});

test.describe("mentions", () => {
  test("selected mentions survive edits, undo, copying, thread saves and reloads", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `mentions-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Mentions");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','mentions','bluesky','did:plc:author','author.bsky.social',X'00',1);`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const response = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Mention authoring",
        content_profile: "thread",
        source_text: "🚀 Hello ",
        segments: [{ body: "🚀 Hello " }, { body: "Thread tail" }],
        renditions: [{ social_account_id: accountID }],
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const publication = await response.json();
    const read = async () =>
      await (await request.get(`/api/v1/publications/${publication.id}`, { headers })).json();
    // Provider lookup transport is fixed here. HTTP/MCP authorization and real
    // provider wire contracts have separate server coverage; draft writes are real.
    let failLookup = true;
    await page.route("**/api/v1/accounts/*/mentions?**", (route) =>
      failLookup
        ? route.fulfill({ status: 403, json: { detail: "Provider permission missing" } })
        : route.fulfill({
            json: {
              mode: "accounts",
              candidates: [
                {
                  label: "@alice.bsky.social",
                  detail: "Alice",
                  target: {
                    provider: "bluesky",
                    kind: "person",
                    id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
                    handle: "alice.bsky.social",
                  },
                },
              ],
            },
          }),
    );
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    await page.locator(`#composer-destination-${accountID}`).click();
    const editors = page.getByRole("textbox", { name: "Post text", exact: true });
    await expect(editors).toHaveCount(2);
    const editor = editors.first();
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await editor.press("ArrowDown");
    await editor.pressSequentially("@ali");
    await expect(
      page.getByText(
        "The provider has not granted mention search access. Check the account and app permissions.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText("No matching accounts", { exact: true })).toHaveCount(0);
    failLookup = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("option", { name: /@alice\.bsky\.social/ })).toBeVisible();
    await editor.press("ArrowDown");
    await editor.press("Enter");
    await expect(editor.locator("[data-mention]")).toHaveText("@alice.bsky.social");
    await editor.press("ControlOrMeta+a");
    await editor.press("ArrowUp");
    await editor.pressSequentially("Intro ");
    await expect
      .poll(async () => {
        const saved = await read();
        const segment = saved.renditions[0].segments[0];
        return segment.settings?.mentions;
      })
      .toEqual({
        version: 1,
        spans: [
          {
            start: 17,
            end: 35,
            text: "@alice.bsky.social",
            target: {
              provider: "bluesky",
              kind: "person",
              id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
              handle: "alice.bsky.social",
            },
          },
        ],
      });
    await editors.nth(1).fill("Thread tail revised\n\nStill separate");
    await expect
      .poll(async () => (await read()).renditions[0].segments[1].body_override)
      .toBe("Thread tail revised\n\nStill separate");
    await editor.press("ControlOrMeta+a");
    await editor.press("ArrowDown");
    await editor.press("Backspace");
    await editor.press("Backspace");
    await expect(editor.locator("[data-mention]")).toHaveCount(0);
    await editor.press("ControlOrMeta+z");
    await expect(editor.locator("[data-mention]")).toHaveCount(1);
    await expect
      .poll(async () => (await read()).renditions[0].segments[0].settings?.mentions?.spans?.length)
      .toBe(1);
    await page.reload();
    await page.locator(`#composer-destination-${accountID}`).click();
    await expect(editor.locator("[data-mention]")).toHaveText("@alice.bsky.social");
    await expect(editors.nth(1)).toHaveText("Thread tail revised\n\nStill separate", {
      useInnerText: true,
    });
    await editor.click();
    await editor.press("ControlOrMeta+a");
    const copied = await editor.evaluate((element) => {
      const transfer = new DataTransfer();
      element.dispatchEvent(
        new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
      return {
        text: transfer.getData("text/plain"),
        metadata: transfer.getData("application/x-openpost-post-text+json"),
      };
    });
    expect(copied.text).toBe("Intro 🚀 Hello @alice.bsky.social ");
    await editors.nth(1).click();
    await editors.nth(1).press("ControlOrMeta+a");
    await editors.nth(1).evaluate((element, copied) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", copied.text);
      transfer.setData("application/x-openpost-post-text+json", copied.metadata);
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
    }, copied);
    await expect(editors.nth(1).locator("[data-mention]")).toHaveText("@alice.bsky.social");
    await expect
      .poll(
        async () =>
          (await read()).renditions[0].segments[1].settings?.mentions?.spans?.[0]?.target?.id,
      )
      .toBe("did:plc:ewvi7nxzyoun6zhxrhs64oiz");
    await editors.nth(1).press("ControlOrMeta+z");
    await expect(editors.nth(1)).toHaveText("Thread tail revised\n\nStill separate", {
      useInnerText: true,
    });
    // Structured clipboard identities cannot silently cross networks or overflow.
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await editor.evaluate((element, copied) => {
      const parsed = JSON.parse(copied.metadata);
      parsed.mentions[0].target = {
        provider: "linkedin",
        kind: "page",
        id: "urn:li:organization:123",
      };
      const transfer = new DataTransfer();
      transfer.setData("text/plain", parsed.body);
      transfer.setData("application/x-openpost-post-text+json", JSON.stringify(parsed));
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
    }, copied);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Choose mentions for this account, or paste plain text." }),
    ).toBeVisible();
    await expect(editor.locator("[data-mention]")).toHaveText("@alice.bsky.social");
    await editor.evaluate((element, copied) => {
      const seed = JSON.parse(copied.metadata).mentions[0];
      let body = "";
      const mentions = [];
      for (let i = 0; i < 51; i++) {
        const start = new TextEncoder().encode(body).length;
        body += seed.text;
        mentions.push({ ...seed, start, end: new TextEncoder().encode(body).length });
        body += " ";
      }
      const transfer = new DataTransfer();
      transfer.setData("text/plain", body);
      transfer.setData("application/x-openpost-post-text+json", JSON.stringify({ body, mentions }));
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
    }, copied);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "A post can include at most 50 selected mentions." }),
    ).toBeVisible();
    await expect(editor).toHaveText("Intro 🚀 Hello @alice.bsky.social ", { useInnerText: true });

    const saved = await read();
    expect(saved.segments[0].body).toBe("🚀 Hello ");
    expect(saved.segments[1].body).toBe("Thread tail");
    await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
    await editors.nth(1).click();
    await editors.nth(1).press("ControlOrMeta+a");
    await editors.nth(1).evaluate((element, copied) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", copied.text);
      transfer.setData("application/x-openpost-post-text+json", copied.metadata);
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
    }, copied);
    await expect(editors.nth(1).locator("[data-mention]")).toHaveText("@alice.bsky.social");
    await expect
      .poll(async () => (await read()).segments[1].settings?.mentions?.spans?.[0]?.target?.id)
      .toBe("did:plc:ewvi7nxzyoun6zhxrhs64oiz");
    await editors.nth(1).press("ControlOrMeta+z");
    await expect.poll(async () => (await read()).segments[1].body).toBe("Thread tail");
    await page.locator(`#composer-destination-${accountID}`).click();
    await expect(editor.locator("[data-mention]")).toHaveText("@alice.bsky.social");

    {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: "light" });
      await expect(editor).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

test.describe("polls", () => {
  test.describe("poll controls", () => {
    test(`shared poll choices persist`, async ({ page, request }, testInfo) => {
      test.setTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.emulateMedia({
        colorScheme: "light",
        reducedMotion: "reduce",
      });
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
                        constraints: {
                          min_items: 2,
                          max_items: 4,
                          max_length: 25,
                        },
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
                            constraints: {
                              min_items: 2,
                              max_items: 4,
                              max_length: 30,
                            },
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
      const add = page.getByRole("button", { name: "Add poll", exact: true });
      const media = page.getByRole("button", {
        name: "Add media",
        exact: true,
      });
      await expect(add).toHaveText("");
      await expect(add.locator("svg")).toHaveCount(1);
      expect(
        await media.evaluate((button) => button.nextElementSibling?.getAttribute("aria-label")),
      ).toBe("Add poll");
      await add.focus();
      await page.keyboard.press("Enter");
      let dialog = page.getByRole("dialog", {
        name: "Add poll",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/Polls are unavailable on @pollsky/)).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Poll version" })).toHaveCount(0);
      await dialog
        .getByRole("textbox", { name: "Question", exact: true })
        .fill("Cancelled question");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const poll = page.locator(
        '[data-testid="shared-poll-editor"]:visible, [data-testid="composer-account-editor"]:visible',
      );
      await expect(poll).toHaveCount(0);
      await expect(add).toBeFocused();
      await add.click();
      await expect(dialog.getByRole("textbox", { name: "Question", exact: true })).toHaveValue("");
      await dialog
        .getByRole("textbox", { name: "Question", exact: true })
        .fill("Would you use this?");
      await dialog.getByRole("textbox", { name: "Option 1", exact: true }).fill("Yes, sometimes");
      await dialog.getByRole("textbox", { name: "Option 2", exact: true }).fill("No");
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
      ).toEqual([]);
      await dialog.getByRole("button", { name: "Add poll", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(poll.getByRole("textbox")).toHaveCount(0);
      await expect(poll.getByText("Choose how to post the poll on these accounts.")).toBeVisible();
      await poll.getByRole("button", { name: /^@pollsky/ }).click();
      await expect(poll.getByText(/This account cannot publish polls/)).toBeVisible();
      await poll.getByRole("button", { name: "Text version", exact: true }).click();
      await expect(poll.getByText(/Text only, without voting buttons/)).toBeVisible();
      await expect(poll.getByRole("textbox", { name: "Post text", exact: true })).toHaveText(
        "Help us plan.",
      );
      await expect(
        poll.getByText("Would you use this?\n1. Yes, sometimes\n2. No", {
          exact: true,
        }),
      ).toBeVisible();
      const accessibility = await new AxeBuilder({ page })
        .include('[data-testid="composer-account-editor"]')
        .analyze();
      expect(accessibility.violations).toEqual([]);

      await poll.scrollIntoViewIfNeeded();
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
      await composerDestinations(page)
        .getByRole("tab", { name: /@pollx,/ })
        .click();
      await poll.getByRole("button", { name: "Edit poll", exact: true }).click();
      const custom = poll.getByTestId("preview-poll-editor");
      await custom.getByRole("button", { name: "Voting closes after", exact: true }).click();
      await expect(page.getByRole("option", { name: "14 days", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await custom.getByRole("textbox", { name: "Question", exact: true }).fill("Usarias isto?");
      await custom.getByRole("button", { name: "Save", exact: true }).click();
      await expect(poll.getByText("Usarias isto?", { exact: true })).toBeVisible();
      await expect(poll.getByRole("checkbox")).toHaveCount(0);
      await composerDestinations(page)
        .getByRole("tab", { name: /polllinkedin,/ })
        .click();
      await poll.getByRole("button", { name: "Edit poll", exact: true }).click();
      const linkedinDialog = poll.getByTestId("preview-poll-editor");
      await expect(
        linkedinDialog.getByRole("textbox", {
          name: "Question",
          exact: true,
        }),
      ).toHaveAttribute("maxlength", "140");
      await expect(
        linkedinDialog.getByRole("textbox", {
          name: "Option 1",
          exact: true,
        }),
      ).toHaveAttribute("maxlength", "30");
      await linkedinDialog
        .getByRole("button", { name: "Voting closes after", exact: true })
        .click();
      await expect(page.getByRole("option")).toHaveText(["1 day", "3 days", "7 days", "14 days"]);
      await page.keyboard.press("Escape");
      await linkedinDialog.getByRole("button", { name: "Add option", exact: true }).click();
      await linkedinDialog.getByRole("button", { name: "Add option", exact: true }).click();
      await expect(
        linkedinDialog.getByRole("button", {
          name: "Add option",
          exact: true,
        }),
      ).toBeDisabled();
      await linkedinDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await composerDestinations(page)
        .getByRole("tab", { name: /@pollmastodon,/ })
        .click();
      await poll.getByRole("button", { name: "Edit poll", exact: true }).click();
      await poll
        .getByRole("checkbox", {
          name: "Allow multiple selections",
          exact: true,
        })
        .check();
      await expect(
        poll.getByRole("checkbox", {
          name: "Allow multiple selections",
          exact: true,
        }),
      ).toBeChecked();
      await poll
        .getByTestId("preview-poll-editor")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(poll.getByRole("button", { name: "Poll version", exact: true })).toContainText(
        "Custom poll",
      );
      await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
      await expect(poll.getByText("Would you use this?", { exact: true })).toBeVisible();
      await composerDestinations(page)
        .getByRole("tab", { name: /@pollsky,/ })
        .click();
      await expect(poll.getByRole("button", { name: "Poll version", exact: true })).toContainText(
        "Text version",
      );
      await poll.getByRole("button", { name: "Customize post text", exact: true }).click();
      const editor = page.getByRole("textbox", {
        name: "Post text",
        exact: true,
      });
      await expect(editor).toHaveText(
        "Help us plan.\n\nWould you use this?\n1. Yes, sometimes\n2. No",
        { useInnerText: true },
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
      await composerDestinations(page)
        .getByRole("tab", { name: /@pollx,/ })
        .click();
      await expect(poll.getByText("Usarias isto?", { exact: true })).toBeVisible();
      const late = {
        id: randomUUID(),
        platform: "bluesky",
        username: "latepoll",
      };
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
        await request.post(`/api/v1/publications/${saved.id}/validate`, {
          headers,
        })
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
      // The server can commit before the composer processes its save response.
      await expect(page.getByTestId("composer-save-indicator")).toHaveAttribute(
        "data-state",
        /^(saved|idle)$/,
      );
      settled = await (await request.get(`/api/v1/publications/${saved.id}`, { headers })).json();
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
      await composerDestinations(page)
        .getByRole("tab", { name: /@pollx,/ })
        .click();
      await expect(poll.getByText(/does not support the selected voting options/)).toBeVisible();
      await poll.getByRole("button", { name: "Edit poll", exact: true }).click();
      await poll
        .getByRole("checkbox", {
          name: "Allow multiple selections",
          exact: true,
        })
        .uncheck();
      await poll
        .getByRole("checkbox", {
          name: "Hide totals until voting ends",
          exact: true,
        })
        .uncheck();
      await poll
        .getByTestId("preview-poll-editor")
        .getByRole("button", { name: "Save", exact: true })
        .click();
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
      await expect(page.getByTestId("composer-save-indicator")).toHaveAttribute(
        "data-state",
        /^(saved|idle)$/,
      );
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
  });
});

test.describe("joined reload", () => {
  // Provider readiness is synthetic; all authoring and cold reads use the real local API.
  test("a customized joined thread preserves each authored source after a cold reload", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const auth = await registerUser(request, `joined-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Joined thread recovery");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','joined-${accountID}','linkedin','${accountID}','joined',X'00',1);`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Joined thread",
        intent: "thread",
        creation_preset: "thread",
        content_profile: "thread",
        source_text: "Shared first",
        segments: [{ body: "Shared first" }, { body: "Continuation once" }],
        renditions: [{ social_account_id: accountID, output_profile: "linkedin.post" }],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const publication = await created.json();
    const path = `/api/v1/publications/${publication.id}`;
    await page.route("**/api/v1/capabilities/resolve", (route) =>
      route.fulfill({
        json: {
          accounts: [
            {
              account_id: accountID,
              provider: "linkedin",
              profile: "short_text",
              output_profile: "linkedin.post",
              label: "LinkedIn post",
              segment_strategy: "join",
              text_limit: 3000,
              compatible: true,
              media: { min_count: 0, max_count: 9, allowed_mimes: [] },
              settings: [],
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
    await page.locator(`#composer-destination-${accountID}`).click();
    const editors = page.getByRole("textbox", { name: "Post text", exact: true });
    await expect(editors).toHaveCount(2);
    await editors.nth(0).fill("Custom first 東京");
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return saved.renditions[0].segments[0].body_override;
      })
      .toBe("Custom first 東京\n\nContinuation once");
    await page.reload();
    await page.locator(`#composer-destination-${accountID}`).click();
    await expect(editors.nth(0)).toHaveText("Custom first 東京", { useInnerText: true });
    await expect(editors.nth(1)).toHaveText("Continuation once", { useInnerText: true });
    await editors.nth(0).fill("Custom first edited");
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return saved.renditions[0].segments[0].body_override;
      })
      .toBe("Custom first edited\n\nContinuation once");
    {
      {
        await page.reload();
        await page.locator(`#composer-destination-${accountID}`).click();
        await expect(editors.nth(0)).toHaveText("Custom first edited", { useInnerText: true });
        await expect(editors.nth(1)).toHaveText("Continuation once", { useInnerText: true });
        await editors.nth(0).focus();
        await page.keyboard.press("Tab");
        await expect(editors.nth(0)).not.toBeFocused();
      }
    }
  });
});

test.describe("unsaved navigation", () => {
  test("draft edits still autosave when navigating to Posts", async ({ page, request }) => {
    const auth = await registerUser(request, `draft-navigation-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Draft navigation");
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "Original draft",
    );
    const edited = "Draft content preserved by autosave";
    const messages: string[] = [];
    page.on("dialog", async (dialog) => {
      messages.push(dialog.type());
      await dialog.dismiss();
    });
    await authenticatePage(page, auth.token);
    const editorURL = `/publications/${publication.id}?workspace_id=${workspace.id}`;
    await page.goto(editorURL);
    const input = page.getByRole("textbox", { name: "Post text", exact: true });
    await expect(input).toHaveText("Original draft", { useInnerText: true });
    await input.fill(edited);
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await expect(page).toHaveURL(/\/publications$/);
    const response = await request.get(`/api/v1/publications/${publication.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const stored = await response.json();
    expect(stored.source_text).toBe(edited);
    expect(stored.revision).toBeGreaterThan(publication.revision);
    expect(messages).toEqual([]);
    await page.goto(editorURL);
    await expect(input).toHaveText(edited, { useInnerText: true });
  });
});

test.describe("activity recovery", () => {
  function socialAccount(id: string, workspaceID: string, username: string) {
    return {
      id,
      workspace_id: workspaceID,
      platform: "bluesky",
      account_id: `did:plc:${id}`,
      account_username: username,
      is_active: true,
    };
  }

  function resolvedBlueskyCapability(accountID: string) {
    return {
      account_id: accountID,
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
    };
  }

  test("composer sends workspace-local wall time as the exact scheduled instant", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `composer-timezone-${unique}@example.com`);
    const workspace = (await createWorkspace(request, auth.token, `Timezone ${unique}`)) as {
      id: string;
    };
    const settingsResponse = await request.patch(`/api/v1/workspaces/${workspace.id}/settings`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { timezone: "America/New_York" },
    });
    expect(settingsResponse.ok()).toBeTruthy();

    await authenticatePage(page, auth.token);
    await page.route("**/api/v1/accounts?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [socialAccount("timezone-account", workspace.id, "timezone_target")],
      });
    });
    await page.route("**/api/v1/capabilities/resolve", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          accounts: [resolvedBlueskyCapability("timezone-account")],
        },
      });
    });

    let scheduledAt = "";
    await page.route("**/api/v1/publications", async (route) => {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON() as {
          scheduled_at?: string;
          workspace_id?: string;
          source_text?: string;
          content_profile?: string;
        };
        if (payload.scheduled_at) scheduledAt = payload.scheduled_at;
        await route.fulfill({
          contentType: "application/json",
          json: {
            id: "scheduled-timezone-publication",
            workspace_id: payload.workspace_id,
            revision: 1,
            title: "",
            content_profile: payload.content_profile ?? "short_text",
            source_text: payload.source_text ?? "",
            status: "draft",
            scheduled_at: payload.scheduled_at ?? "",
            renditions: [],
          },
        });
        return;
      }
      await route.continue();
    });
    await page.route("**/api/v1/posts/*/variants", async (route) => {
      await route.fulfill({ contentType: "application/json", json: {} });
    });
    await page.route("**/api/v1/publications/scheduled-timezone-publication", async (route) => {
      if (route.request().method() === "PUT") {
        const payload = route.request().postDataJSON() as {
          scheduled_at?: string;
        };
        if (payload.scheduled_at) scheduledAt = payload.scheduled_at;
        await route.fulfill({
          contentType: "application/json",
          json: {
            id: "scheduled-timezone-publication",
            revision: 1,
            status: "draft",
            scheduled_at: payload.scheduled_at ?? "",
          },
        });
        return;
      }
      await route.continue();
    });
    await page.route(
      "**/api/v1/publications/scheduled-timezone-publication/renditions",
      async (route) => {
        await route.fulfill({ contentType: "application/json", json: {} });
      },
    );
    await page.route("**/api/v1/publications/*/validate", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { valid: true, issues: [] },
      });
    });
    await page.route("**/api/v1/publications/*/schedule", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          message: "Scheduled!",
          publication_id: "scheduled-timezone-publication",
          renditions: [],
        },
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("composer-account-control")).toBeVisible();
    await page
      .getByRole("textbox", { name: "Post text" })
      .fill("Schedule in the workspace timezone.");
    await clickComposerDeliveryAction(page, "Schedule");
    const dialog = page.getByTestId("schedule-dialog-shell");
    await expect(dialog).toContainText("America/New_York");
    await dialog.getByLabel("Schedule time").fill("2099-07-21T09:00");
    await dialog.getByRole("button", { name: "Schedule", exact: true }).click();

    await expect(page.getByText("Scheduled!", { exact: true })).toBeVisible();
    await expect.poll(() => scheduledAt).toBe("2099-07-21T13:00:00.000Z");
  });

  // The create/switch selection races behind this scenario were fixed by decoupling
  // workspace selection from dialog mount state (create-workspace-dialog.svelte) and by
  // making stale implicit bootstrap refreshes yield to newer explicit selections
  // (workspace.svelte.ts). Re-enabled to prove the in-flight autosave isolation end to end.
  test("an in-flight autosave cannot attach an old-workspace draft after switching", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `composer-autosave-race-${unique}@example.com`);
    const first = (await createWorkspace(request, auth.token, `Autosave A ${unique}`)) as {
      id: string;
      name: string;
    };
    const second = (await createWorkspace(request, auth.token, `Autosave B ${unique}`)) as {
      id: string;
      name: string;
    };

    await authenticatePage(page, auth.token);
    await page.addInitScript((workspace) => {
      localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
    }, first);
    await page.route("**/api/v1/accounts?**", async (route) => {
      const workspaceID = new URL(route.request().url()).searchParams.get("workspace_id");
      await route.fulfill({
        contentType: "application/json",
        json: [
          socialAccount(
            workspaceID === first.id ? "account-a" : "account-b",
            workspaceID ?? "",
            workspaceID === first.id ? "workspace_a" : "workspace_b",
          ),
        ],
      });
    });
    await page.route("**/api/v1/capabilities/resolve", async (route) => {
      const payload = route.request().postDataJSON() as {
        account_ids: string[];
      };
      await route.fulfill({
        contentType: "application/json",
        json: {
          accounts: payload.account_ids.map(resolvedBlueskyCapability),
        },
      });
    });

    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolveGate) => (releaseFirstSave = resolveGate));
    let markFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>(
      (resolveStarted) => (markFirstSaveStarted = resolveStarted),
    );
    let markFirstSaveFinished!: () => void;
    const firstSaveFinished = new Promise<void>(
      (resolveFinished) => (markFirstSaveFinished = resolveFinished),
    );
    const savedWorkspaceIDs: string[] = [];
    await page.route("**/api/v1/publications", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const payload = route.request().postDataJSON() as { workspace_id: string };
      savedWorkspaceIDs.push(payload.workspace_id);
      if (payload.workspace_id === first.id) {
        markFirstSaveStarted();
        await firstSaveGate;
        await route.fulfill({
          contentType: "application/json",
          json: {
            id: "draft-workspace-a",
            workspace_id: first.id,
            revision: 1,
            title: "",
            content_profile: "short_text",
            source_text: "Move this unsaved content safely.",
            status: "draft",
            renditions: [],
          },
        });
        markFirstSaveFinished();
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          id: "draft-workspace-b",
          workspace_id: second.id,
          revision: 1,
          title: "",
          content_profile: "short_text",
          source_text: "Move this unsaved content safely.",
          status: "draft",
          renditions: [],
        },
      });
    });
    await page.route("**/api/v1/posts/*/variants", async (route) => {
      await route.fulfill({ contentType: "application/json", json: {} });
    });
    await page.route("**/api/v1/publications/**", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          contentType: "application/json",
          json: { id: "draft-workspace-a", revision: 2, status: "draft" },
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Post text" })
      .fill("Move this unsaved content safely.");
    await firstSaveStarted;

    const workspaceButton = page.getByRole("button", { name: new RegExp(first.name) }).first();
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();
    await page
      .getByTestId("composer-workspace-switch-dialog")
      .getByRole("button", { name: "Discard and switch", exact: true })
      .click();
    await expect(page.getByText(/Workspace changed/)).toBeVisible();

    releaseFirstSave();
    await firstSaveFinished;
    await expect(page).not.toHaveURL(/draft-workspace-a/);

    await page
      .getByRole("textbox", { name: "Post text" })
      .fill("Move this unsaved content safely to workspace B.");
    await expect(page).toHaveURL(/\/publications\/draft-workspace-b$/, {
      timeout: 10_000,
    });
    expect(savedWorkspaceIDs).toEqual([first.id, second.id]);
  });
});
