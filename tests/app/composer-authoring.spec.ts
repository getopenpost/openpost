import { expect, test, type Locator } from "@playwright/test";
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
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";

test.describe("first composition", () => {
  test("meaningful composition starts once across focus, empty drafts, refresh, and composer instances", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `first-composition-${unique}@example.com`);
    const workspace = (await createWorkspace(
      request,
      auth.token,
      `First composition ${unique}`,
    )) as {
      id: string;
    };
    const claims: Array<{ signal: string; claimed: boolean }> = [];

    const recordClaim = async (response: import("@playwright/test").Response) => {
      if (
        new URL(response.url()).pathname ===
          `/api/v1/workspaces/${workspace.id}/setup/composition` &&
        response.request().method() === "POST"
      ) {
        const requestBody = response.request().postDataJSON() as {
          signal: string;
        };
        const responseBody = (await response.json()) as { claimed: boolean };
        claims.push({
          signal: requestBody.signal,
          claimed: responseBody.claimed,
        });
      }
    };
    page.on("response", recordClaim);

    await authenticatePage(page, auth.token);
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Post text" });
    await editor.focus();
    await editor.fill("   ");
    // Whitespace-only input must not claim the first composition; the poll proves absence within a bounded window.
    await expect(
      expect.poll(() => claims.length, { timeout: 400 }).toBeGreaterThan(0),
    ).rejects.toThrow();
    expect(claims).toEqual([]);

    const secondComposer = await page.context().newPage();
    secondComposer.on("response", recordClaim);
    await secondComposer.goto("/");
    await Promise.all([
      editor.fill("A meaningful first composition"),
      secondComposer
        .getByRole("textbox", { name: "Post text" })
        .fill("A concurrent first composition"),
    ]);
    await expect.poll(() => claims.length).toBe(2);
    expect(claims.map((claim) => claim.claimed).sort()).toEqual([false, true]);
    expect(claims.map((claim) => claim.signal)).toEqual(["text", "text"]);
    await secondComposer.close();

    await page.reload();
    await page.getByRole("textbox", { name: "Post text" }).fill("A meaningful edit after refresh");
    await expect.poll(() => claims.length).toBe(3);
    expect(claims[2]).toEqual({ signal: "text", claimed: false });

    const setupResponse = await request.get(`/api/v1/workspaces/${workspace.id}/setup`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(setupResponse.ok()).toBeTruthy();
    const setup = (await setupResponse.json()) as {
      steps: Array<{ id: string; completed: boolean }>;
    };
    expect(setup.steps).toContainEqual({ id: "composition", completed: true });
  });

  test("media and content-mode input start composition without exposing content", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `composition-signals-${unique}@example.com`);
    const workspace = (await createWorkspace(
      request,
      auth.token,
      `Composition signals ${unique}`,
    )) as { id: string };
    const signals: string[] = [];

    page.on("request", (browserRequest) => {
      if (
        new URL(browserRequest.url()).pathname ===
        `/api/v1/workspaces/${workspace.id}/setup/composition`
      ) {
        const body = browserRequest.postDataJSON() as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(["origin_key", "signal"]);
        expect(body.origin_key).toMatch(/^[0-9a-f-]{36}$/);
        signals.push(body.signal as string);
      }
    });

    await authenticatePage(page, auth.token);
    await page.goto("/");
    await page.getByRole("button", { name: "Add post", exact: true }).click();
    await expect.poll(() => signals).toEqual(["content_mode"]);

    const secondAuth = await registerUser(request, `composition-media-${unique}@example.com`);
    const secondWorkspace = (await createWorkspace(
      request,
      secondAuth.token,
      `Composition media ${unique}`,
    )) as { id: string };
    await authenticatePage(page, secondAuth.token);
    await page.route("**/api/v1/media**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/media/tags")) {
        await route.fulfill({
          contentType: "application/json",
          json: { tags: [], can_edit: true },
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          media: [
            {
              id: "first-composition-media",
              original_filename: "first-composition.png",
              mime_type: "image/png",
              size: 128,
              width: 1,
              height: 1,
              url: "/assets/logo.svg",
              thumbnail_url: "/assets/logo.svg",
              processing_status: "ready",
              analysis_status: "ready",
              asset_kind: "library",
              created_at: "2026-08-13T12:00:00Z",
            },
          ],
          total: 1,
        },
      });
    });
    const mediaSignals: string[] = [];
    page.on("request", (browserRequest) => {
      if (
        new URL(browserRequest.url()).pathname ===
        `/api/v1/workspaces/${secondWorkspace.id}/setup/composition`
      ) {
        mediaSignals.push((browserRequest.postDataJSON() as { signal: string }).signal);
      }
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Add media" }).click();
    const picker = page.getByRole("dialog");
    await picker.getByRole("tab", { name: "Library" }).click();
    await picker.getByRole("button", { name: "Select first-composition.png" }).click();
    await picker.getByRole("button", { name: "Add media", exact: true }).click();
    await expect.poll(() => mediaSignals).toEqual(["media"]);
  });
});

test.describe("thread poll media", () => {
  // The capability resolver and draft persistence are real. Synthetic credentials
  // cannot publish, and this test never requests delivery.
  test("media on a follow-up preserves the first post's native poll", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `thread-poll-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Thread poll media");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','poll-${accountID}','x','${accountID}','auditpoll',X'00',1);`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const uploaded = await request.post("/api/v1/media/upload", {
      headers,
      multipart: {
        workspace_id: workspace.id,
        file: {
          name: "audit-thread-poll.png",
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
    const attachPhoto = async (postIndex: number) => {
      await page.getByRole("textbox", { name: "Post text", exact: true }).nth(postIndex).click();
      const addMedia = page.getByRole("button", { name: "Add media", exact: true }).nth(postIndex);
      await addMedia.click();
      const picker = page.getByRole("dialog");
      await picker.getByRole("tab", { name: "Library", exact: true }).click();
      await picker
        .getByRole("button", {
          name: "Select audit-thread-poll.png",
          exact: true,
        })
        .click();
      const resolvedMedia = page.waitForResponse((response) => {
        if (!response.url().endsWith("/api/v1/capabilities/resolve")) return false;
        const input = response.request().postDataJSON();
        return input.segments?.[postIndex]?.media?.[0]?.media_id === media.id;
      });
      await picker.getByRole("button", { name: /^Add/ }).click();
      expect((await resolvedMedia).ok()).toBeTruthy();
    };
    await authenticatePage(page, auth.token);
    let releaseCapabilities!: () => void;
    const capabilitiesReady = new Promise<void>((resolve) => {
      releaseCapabilities = resolve;
    });
    await page.route(
      "**/api/v1/capabilities",
      async (route) => {
        await capabilitiesReady;
        await route.continue();
      },
      { times: 1 },
    );
    const capabilityRequest = page.waitForRequest("**/api/v1/capabilities");
    await page.goto("/");
    await capabilityRequest;
    await page
      .getByRole("textbox", { name: "Post text", exact: true })
      .fill("Audit poll before a photo.");
    try {
      await expect(page.getByRole("button", { name: "Add poll", exact: true })).toBeDisabled();
    } finally {
      releaseCapabilities();
    }
    await page.getByRole("button", { name: "Add poll", exact: true }).click();
    const poll = page.locator(
      '[data-testid="shared-poll-editor"]:visible, [data-testid="composer-account-preview"]:visible',
    );
    const dialog = page.getByRole("dialog", { name: "Add poll", exact: true });
    await dialog.getByRole("textbox", { name: "Question", exact: true }).fill("Which option?");
    await dialog.getByRole("textbox", { name: "Option 1", exact: true }).fill("First");
    await dialog.getByRole("textbox", { name: "Option 2", exact: true }).fill("Second");
    await dialog.getByRole("button", { name: "Add poll", exact: true }).click();
    await expect(poll.getByText("Which option?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add post", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Post text", exact: true })
      .nth(1)
      .fill("Audit photo follow-up.");
    await attachPhoto(1);
    await expect(poll.getByText("Which option?", { exact: true })).toBeVisible();

    let saved: any;
    await expect
      .poll(async () => {
        const list = await (
          await request.get("/api/v1/publications", {
            headers,
            params: { workspace_id: workspace.id },
          })
        ).json();
        const items = Array.isArray(list) ? list : (list.items ?? list.publications ?? []);
        const item = items.find((entry: any) => entry.source_text === "Audit poll before a photo.");
        if (!item) return false;
        saved = await (await request.get(`/api/v1/publications/${item.id}`, { headers })).json();
        return saved.segments?.[1]?.media?.[0]?.id === media.id;
      })
      .toBe(true);
    expect(saved.segments[0].media ?? []).toEqual([]);
    expect(saved.segments[0].settings.poll.destinations[accountID].mode).toBe("native");
    expect(saved.renditions[0].segments).toHaveLength(2);
    expect(saved.renditions[0].segments[0].settings.poll_options).toBe("First\nSecond");
    expect(saved.renditions[0].segments[1].settings.poll_options).toBeUndefined();
    const validation = await request.post(`/api/v1/publications/${saved.id}/validate`, { headers });
    expect(validation.ok(), await validation.text()).toBeTruthy();
    const issueCodes = (await validation.json()).issues.map(
      (issue: { code: string }) => issue.code,
    );
    expect(issueCodes).not.toContain("x_mutually_exclusive_attachment");
    expect(issueCodes).not.toContain("poll_resolution_required");
    {
      {
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
        await page.goto(`/publications/${saved.id}`);
        await expect(poll.getByText("Which option?", { exact: true })).toBeVisible();
        await composerDestinations(page)
          .getByRole("tab", { name: /@auditpoll,/ })
          .click();
        const version = poll.getByRole("button", {
          name: "Poll version",
          exact: true,
        });
        await version.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("option", { name: "Native poll", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(version).toBeFocused();
        await poll.scrollIntoViewIfNeeded();
        await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
      }
    }
    // Moving the same photo onto the poll's own post must still be refused.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page
      .getByRole("region", { name: "Drop zone for post 2", exact: true })
      .getByRole("button", { name: "Remove media", exact: true })
      .click();
    await attachPhoto(0);
    await composerDestinations(page)
      .getByRole("tab", { name: /@auditpoll,/ })
      .click();
    await expect(
      poll.getByText("Remove media from this destination or choose a text version of the poll.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const detail = await (
          await request.get(`/api/v1/publications/${saved.id}`, { headers })
        ).json();
        return detail.segments[0].media?.[0]?.id === media.id && !detail.segments[1].media?.length;
      })
      .toBe(true);
    const blocked = await request.post(`/api/v1/publications/${saved.id}/validate`, { headers });
    expect(blocked.ok(), await blocked.text()).toBeTruthy();
    expect((await blocked.json()).issues.map((issue: { code: string }) => issue.code)).toContain(
      "x_mutually_exclusive_attachment",
    );
    await composerDestinations(page).getByRole("tab", { name: "All", exact: true }).click();
    await page
      .getByRole("region", { name: "Drop zone for post 1", exact: true })
      .getByRole("button", { name: "Remove media", exact: true })
      .click();
    await attachPhoto(1);
    await expect
      .poll(async () => {
        const detail = await (
          await request.get(`/api/v1/publications/${saved.id}`, { headers })
        ).json();
        return !detail.segments[0].media?.length && detail.segments[1].media?.[0]?.id === media.id;
      })
      .toBe(true);
    await page.reload();
    await expect(poll.getByText("Which option?", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

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

  test(`a saved thread survives reopening and editing`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `thread-reopen-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Saved thread");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Saved thread",
        source_text: "The main post",
        content_profile: "thread",
        intent: "thread",
        creation_preset: "thread",
        segments: [{ body: "The main post" }, { body: "The link reply https://example.com" }],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const publication = await created.json();
    const path = `/api/v1/publications/${publication.id}`;
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    const editors = page.getByRole("textbox", { name: "Post text", exact: true });
    await expect(editors).toHaveCount(2);
    await expectPostText(editors.nth(1), "The link reply https://example.com");
    await editors.nth(0).fill("The edited main post");
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return saved.segments.map((segment: { body: string }) => segment.body);
      })
      .toEqual(["The edited main post", "The link reply https://example.com"]);
    await page.reload();
    await expect(editors).toHaveCount(2);
    await expectPostText(editors.nth(0), "The edited main post");
    await expectPostText(editors.nth(1), "The link reply https://example.com");
    await page.getByRole("button", { name: "Remove post", exact: true }).nth(1).click();
    await expect
      .poll(async () => {
        const saved = await (await request.get(path, { headers })).json();
        return saved.segments.map((segment: { body: string }) => segment.body);
      })
      .toEqual(["The edited main post"]);
    expect(errors).toEqual([]);
  });
});

test.describe("thread toolbar focus", () => {
  test.describe("thread actions", () => {
    test(`backward focus reveals the earlier post's actions in light`, async ({
      page,
      request,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      const auth = await registerUser(request, `thread-toolbar-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Thread toolbar focus");
      await authenticatePage(page, auth.token);
      await page.goto("/");
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
      await page.reload();
      const editors = page.getByRole("textbox", { name: "Post text", exact: true });
      const firstEditor = editors.first();
      const firstAction = page.getByRole("button", { name: "Add media", exact: true }).first();
      await firstAction.focus();
      const decoration = () =>
        firstEditor.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.boxShadow, style.outlineStyle, style.outlineWidth];
        });
      const restingDecoration = await decoration();
      await firstEditor.click();
      await expect(firstEditor).toBeFocused();
      expect(await decoration()).toEqual(restingDecoration);
      await page.keyboard.type("Pointer editing");
      expect(await decoration()).toEqual(restingDecoration);
      await firstAction.focus();
      for (let step = 0; step < 8; step++) {
        await page.keyboard.press("Shift+Tab");
        if (await firstEditor.evaluate((element) => document.activeElement === element)) break;
      }
      await expect(firstEditor).toBeFocused();
      expect(await decoration()).not.toEqual(restingDecoration);
      await editors.first().fill("Audit first post.");
      await page.getByRole("button", { name: "Add post", exact: true }).click();
      await editors.nth(1).fill("Audit second post.");
      const headers = { Authorization: `Bearer ${auth.token}` };
      let saved: any;
      await expect
        .poll(async () => {
          const list = await (
            await request.get("/api/v1/publications", {
              headers,
              params: { workspace_id: workspace.id },
            })
          ).json();
          const items = Array.isArray(list) ? list : (list.items ?? list.publications ?? []);
          const item = items.find((entry: any) => entry.source_text === "Audit first post.");
          if (!item) return false;
          saved = await (await request.get(`/api/v1/publications/${item.id}`, { headers })).json();
          return saved.segments?.[1]?.body === "Audit second post.";
        })
        .toBe(true);
      await page.goto(`/publications/${saved.id}`);
      await editors.nth(1).focus();
      const earlierAction = page.getByRole("button", { name: "Add post", exact: true }).first();
      for (let step = 0; step < 12; step++) {
        if (await earlierAction.evaluate((button) => document.activeElement === button)) break;
        await page.keyboard.press("Shift+Tab");
      }
      await expect(earlierAction).toBeFocused();
      await expect
        .poll(() =>
          earlierAction.evaluate((button) => {
            for (let element: Element | null = button; element; element = element.parentElement) {
              if (getComputedStyle(element).opacity === "0") return false;
            }
            return true;
          }),
        )
        .toBe(true);
      const firstMedia = page.getByRole("button", { name: "Add media", exact: true }).first();
      for (let step = 0; step < 8; step++) {
        if (await firstMedia.evaluate((button) => document.activeElement === button)) break;
        await page.keyboard.press("Shift+Tab");
      }
      await expect(firstMedia).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(firstMedia).toBeFocused();
      // Pointer users activate the visible post before using its contextual actions.
      await editors.nth(1).click();
      const secondMedia = page.getByRole("button", { name: "Add media", exact: true }).nth(1);
      await secondMedia.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(secondMedia).toBeFocused();

      const detail = await (
        await request.get(`/api/v1/publications/${saved.id}`, { headers })
      ).json();
      expect(detail.segments.map((segment: { body: string }) => segment.body)).toEqual([
        "Audit first post.",
        "Audit second post.",
      ]);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("mentions", () => {
  for (const joined of [false, true])
    test(`video description edits preserve explicit mention decisions (${joined ? "joined" : "single"})`, async ({
      page,
      request,
    }) => {
      const auth = await registerUser(request, `description-mention-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Description mention edits");
      const accountID = randomUUID();
      const copyAccountID = joined ? randomUUID() : undefined;
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','video-mention','youtube','channel','channel',X'00',1);`,
      ]);
      if (copyAccountID)
        execFileSync("sqlite3", [
          "-cmd",
          ".timeout 5000",
          `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
          `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${copyAccountID}','${workspace.id}','caption-copy','youtube','copy-channel','copy-channel',X'00',1);`,
        ]);
      const headers = { Authorization: `Bearer ${auth.token}` };
      const uploaded = await request.post("/api/v1/media/upload", {
        headers,
        multipart: {
          workspace_id: workspace.id,
          file: {
            name: "mention-description.mp4",
            mimeType: "video/mp4",
            buffer: readFileSync(
              new URL("./fixtures/product-screenshots/study-sos-demo.mp4", import.meta.url),
            ),
          },
        },
      });
      expect(uploaded.ok(), await uploaded.text()).toBe(true);
      const media = await uploaded.json();
      const response = await request.post("/api/v1/publications", {
        headers,
        data: {
          workspace_id: workspace.id,
          title: "Description mention edits",
          content_profile: "video",
          source_text: "Hello @alice",
          segments: [
            {
              body: "Hello @alice",
              media: [{ media_id: media.id }],
              settings: {
                mentions: {
                  version: 1,
                  spans: [
                    {
                      start: 6,
                      end: 12,
                      text: "@alice",
                      target: {
                        provider: "workspace",
                        kind: "profile",
                        id: "saved",
                        profiles: [{ provider: "youtube", text: "@alice_youtube" }],
                      },
                    },
                  ],
                },
              },
            },
            ...(joined ? [{ body: "Later" }] : []),
          ],
          renditions: [
            { social_account_id: accountID, output_profile: "youtube.video" },
            ...(copyAccountID
              ? [{ social_account_id: copyAccountID, output_profile: "youtube.video" }]
              : []),
          ],
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      const publication = await response.json();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await authenticatePage(page, auth.token);
      await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
      let copied: Record<string, string> = {};
      if (joined) {
        const source = page.getByRole("textbox", { name: "Description", exact: true }).first();
        await source.click();
        await source.press("ControlOrMeta+a");
        copied = await source.evaluate((element) => {
          const data = new DataTransfer();
          element.dispatchEvent(
            new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }),
          );
          return Object.fromEntries(data.types.map((type) => [type, data.getData(type)]));
        });
      }
      await page.locator(`#composer-destination-${accountID}`).click();
      await page
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Fresh video description");
      await expect
        .poll(async () => {
          const saved = await (
            await request.get(`/api/v1/publications/${publication.id}`, { headers })
          ).json();
          return joined
            ? saved.renditions[0].description
            : saved.renditions[0].segments[0].body_override;
        })
        .toBe("Fresh video description");
      if (joined) {
        const description = page.getByRole("textbox", { name: "Description", exact: true });
        await description.press("ControlOrMeta+a");
        await description.press("Backspace");
        // Clear through the editor's keyboard transaction before synthetic paste.
        await expect
          .poll(
            async () =>
              (
                await (
                  await request.get(`/api/v1/publications/${publication.id}`, { headers })
                ).json()
              ).renditions[0].description,
          )
          .toBe("");
        await description.evaluate((element, copied) => {
          const data = new DataTransfer();
          for (const [type, value] of Object.entries(copied)) data.setData(type, value);
          element.dispatchEvent(
            new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
          );
        }, copied);
        await expect(description.locator("[data-mention]")).toHaveText("@alice");
        await expect
          .poll(
            async () =>
              (
                await (
                  await request.get(`/api/v1/publications/${publication.id}`, { headers })
                ).json()
              ).renditions[0].description,
          )
          .toBe("Hello @alice_youtube");
        await page.reload();
        await page.locator(`#composer-destination-${accountID}`).click();
        await expect(description.locator("[data-mention]")).toHaveText("@alice");
        const before = await (
          await request.get(`/api/v1/publications/${publication.id}`, { headers })
        ).json();
        const clipboardType = "application/x-openpost-post-text+json";
        const independent = JSON.parse(copied[clipboardType]);
        independent.mentions[0].target.id = "independent-caption-person";
        independent.mentions[0].target.profiles[0].text = "@caption_youtube";
        const captionCopy = {
          ...copied,
          [clipboardType]: JSON.stringify(independent),
        };
        await description.click();
        await description.press("ControlOrMeta+a");
        await description.evaluate((element, values) => {
          const data = new DataTransfer();
          for (const [type, value] of Object.entries(values)) data.setData(type, value);
          element.dispatchEvent(
            new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: data,
            }),
          );
        }, captionCopy);
        await expect
          .poll(async () => {
            const saved = await (
              await request.get(`/api/v1/publications/${publication.id}`, {
                headers,
              })
            ).json();
            return {
              description: saved.renditions[0].description,
              sourceIdentity: saved.segments[0].settings.mentions.spans[0].target.id,
              captionIdentity:
                saved.renditions[0].segments[0].settings.caption_mentions.mentions.spans[0].target
                  .id,
              sourceBodies: saved.segments.map((segment: any) => segment.body),
              advanced: saved.revision > before.revision,
            };
          })
          .toEqual({
            description: "Hello @caption_youtube",
            sourceIdentity: before.segments[0].settings.mentions.spans[0].target.id,
            captionIdentity: "independent-caption-person",
            sourceBodies: ["Hello @alice", "Later"],
            advanced: true,
          });
        await page
          .getByRole("region", { name: "Destinations", exact: true })
          .getByRole("button", { name: "More", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Copy variant to…", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Apply", exact: true }).click();
        await expect
          .poll(async () => {
            const saved = await (
              await request.get(`/api/v1/publications/${publication.id}`, { headers })
            ).json();
            const target = saved.renditions.find(
              (rendition: { social_account_id: string }) =>
                rendition.social_account_id === copyAccountID,
            );
            return [
              target.description,
              target.segments[0].settings.caption_mentions?.mentions.spans[0].target.id,
            ];
          })
          .toEqual(["Hello @caption_youtube", "independent-caption-person"]);
        await description.fill("Hello @alice");
        await expect
          .poll(async () => {
            const saved = await (
              await request.get(`/api/v1/publications/${publication.id}`, {
                headers,
              })
            ).json();
            return [
              saved.renditions[0].description,
              saved.renditions[0].segments[0].settings.caption_mentions.mentions.spans,
            ];
          })
          .toEqual(["Hello @alice", []]);
      }
      expect(errors).toEqual([]);
    });

  test("copying a variant replaces its selected company identity", async ({ page, request }) => {
    const auth = await registerUser(request, `mention-copy-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Copy mention choices");
    const accountIDs = [randomUUID(), randomUUID()];
    for (const [index, id] of accountIDs.entries())
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${id}','${workspace.id}','copy-${index}','linkedin','${id}','company-${index}',X'00',1);`,
      ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Copy mentions",
        content_profile: "short_text",
        source_text: "Shared",
        segments: [{ id: "source", body: "Shared" }],
        renditions: accountIDs.map((id, index) => ({
          social_account_id: id,
          segments: [
            {
              publication_segment_id: "source",
              body_override: "Hi Acme",
              settings: {
                mentions: {
                  version: 1,
                  spans: [
                    {
                      start: 3,
                      end: 7,
                      text: "Acme",
                      target: {
                        provider: "linkedin",
                        kind: "page",
                        id: `urn:li:organization:${index + 123}`,
                      },
                    },
                  ],
                },
              },
            },
          ],
        })),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    await page.locator(`#composer-destination-${accountIDs[0]}`).click();
    await page
      .getByRole("region", { name: "Destinations", exact: true })
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Copy variant to…", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Apply", exact: true }).click();
    await expect
      .poll(async () => {
        const saved = await (
          await request.get(`/api/v1/publications/${publication.id}`, { headers })
        ).json();
        return saved.renditions.find(
          (rendition: { social_account_id: string }) =>
            rendition.social_account_id === accountIDs[1],
        ).segments[0].settings?.mentions?.spans?.[0]?.target?.id;
      })
      .toBe("urn:li:organization:123");
  });

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

test.describe("saved mentions", () => {
  async function caretAtEnd(editor: Locator) {
    await editor.evaluate((element) => {
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
  }

  test("a dismissed save cannot insert into a newer mention dialog", async ({ page, request }) => {
    test.setTimeout(90_000);
    const auth = await registerUser(request, `mention-dialog-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Mention dialog targets");
    const created = await request.post("/api/v1/publications", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        workspace_id: workspace.id,
        title: "Targets",
        content_profile: "thread",
        source_text: "One ",
        segments: [{ body: "One " }, { body: "Two " }],
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started: () => void = () => {};
    const pending = new Promise<void>((resolve) => (started = resolve));
    let finished: () => void = () => {};
    const completed = new Promise<void>((resolve) => (finished = resolve));
    await page.route(`**/api/v1/workspaces/${workspace.id}/mentions`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response });
      finished();
    });
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    const editors = page.getByRole("textbox", { name: "Post text", exact: true });
    const first = editors.first();
    await first.click();
    await first.press("ControlOrMeta+a");
    await first.press("ArrowRight");
    await first.pressSequentially("@");
    await page.getByRole("option", { name: "Add mention", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Saved mentions", exact: true });
    await dialog.getByRole("textbox", { name: "Mention name", exact: true }).fill("@old");
    await dialog.getByRole("textbox", { name: "X", exact: true }).fill("@old_x");
    await dialog.getByRole("button", { name: "Save and insert", exact: true }).click();
    await pending;
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    const second = editors.nth(1);
    await second.click();
    await second.press("ControlOrMeta+a");
    await second.press("ArrowRight");
    await second.pressSequentially("@");
    await page.getByRole("option", { name: "Add mention", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Mention name", exact: true }).fill("@new");
    release();
    await completed;
    await expect.poll(async () => await dialog.isVisible()).toBe(true);
    await expect(dialog.getByRole("textbox", { name: "Mention name", exact: true })).toHaveValue(
      "@new",
    );
    expect(await first.locator("[data-mention]").count()).toBe(0);
    expect(await second.locator("[data-mention]").count()).toBe(0);
  });

  test("identity-only edits refresh readiness in a new shared composition", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `mention-readiness-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Mention readiness");
    const account = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${account}','${workspace.id}','x','x','${account}','x-account',X'00',1);`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const saved = await request.post(`/api/v1/workspaces/${workspace.id}/mentions`, {
      headers,
      data: { name: "@guest", profiles: [{ provider: "x", text: "@a_much_longer_guest" }] },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    await authenticatePage(page, auth.token);
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Post text", exact: true });
    await editor.fill("@");
    await page.getByRole("option", { name: /@guest.*@a_much_longer_guest/ }).click();
    await expect(editor.locator("[data-mention]")).toHaveCount(1);
    const resolved = page.waitForResponse(
      (response) =>
        response.url().includes("/capabilities/resolve") &&
        response.request().postDataJSON()?.account_segments?.[account]?.[0]?.content ===
          "@a_much_longer_guest",
    );
    await editor.press("Backspace");
    await resolved;
    await expect
      .poll(async () => {
        const list = await (
          await request.get("/api/v1/publications", {
            headers,
            params: { workspace_id: workspace.id },
          })
        ).json();
        return list.some((post: any) => post.source_text === "@guest");
      })
      .toBe(true);
    const refreshed = page.waitForRequest(
      (request) =>
        request.url().includes("/capabilities/resolve") &&
        request.method() === "POST" &&
        request.postDataJSON()?.segments?.[0]?.content === "@guest" &&
        !request.postDataJSON()?.account_segments?.[account],
      { timeout: 5000 },
    );
    await editor.press("Backspace");
    await expect(editor).toHaveText("@guest");
    await expect(editor.locator("[data-mention]")).toHaveCount(0);
    await refreshed;
  });

  test("shared @ picker creates and reuses immutable per-network mention snapshots", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(180_000);
    const auth = await registerUser(request, `saved-mentions-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Recurring mentions");
    const ids = Object.fromEntries(
      ["x", "bluesky", "facebook"].map((provider) => [provider, randomUUID()]),
    );
    for (const [provider, id] of Object.entries(ids))
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${id}','${workspace.id}','${provider}','${provider}','${id}','${provider}-account',X'00',1);`,
      ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Recurring guest",
        content_profile: "short_text",
        source_text: "Hi ",
        renditions: Object.values(ids).map((id) => ({ social_account_id: id })),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    const read = async () =>
      await (await request.get(`/api/v1/publications/${publication.id}`, { headers })).json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/v1/accounts/*/mentions?**", (route) =>
      route.fulfill({
        json: {
          mode: "accounts",
          candidates: [
            {
              label: "@guest.bsky.social",
              detail: "Guest",
              target: {
                provider: "bluesky",
                kind: "person",
                id: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
                handle: "guest.bsky.social",
              },
            },
          ],
        },
      }),
    );
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    const editor = page.getByRole("textbox", { name: "Post text", exact: true });
    await editor.click();
    await caretAtEnd(editor);
    await editor.pressSequentially("@");
    await page.getByRole("option", { name: "Add mention", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Saved mentions", exact: true });
    await dialog.getByRole("textbox", { name: "Mention name", exact: true }).fill("@guest");
    await dialog.getByRole("textbox", { name: "X", exact: true }).fill("@guest_x");
    await dialog.getByRole("textbox", { name: "Bluesky", exact: true }).fill("guest");
    await dialog.getByRole("button", { name: /@guest\.bsky\.social/ }).click();
    await dialog.getByRole("button", { name: "Save and insert", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(editor.locator("[data-mention]")).toHaveText("@guest");
    await expect
      .poll(async () => {
        const saved = await read();
        return Object.fromEntries(
          saved.renditions.map((rendition: any) => [rendition.platform, rendition.body]),
        );
      })
      .toEqual({ x: "Hi @guest_x ", bluesky: "Hi @guest.bsky.social ", facebook: "Hi @guest " });
    const original = await read();
    expect(
      original.renditions.every((rendition: any) => rendition.segments[0].body_override == null),
    ).toBe(true);
    const snapshot = original.segments[0].settings.mentions.spans[0];
    expect(snapshot.target.provider).toBe("workspace");
    const libraryPath = `/api/v1/workspaces/${workspace.id}/mentions`;
    const library = await (await request.get(libraryPath, { headers })).json();
    expect(library).toHaveLength(1);
    await caretAtEnd(editor);
    await editor.pressSequentially(" @");
    await page.getByRole("option", { name: "Add mention", exact: true }).click();
    await dialog.getByRole("button", { name: "@guest", exact: true }).click();
    await dialog.getByRole("textbox", { name: "X", exact: true }).fill("@new_guest");
    await dialog.getByRole("button", { name: "Save and insert", exact: true }).click();
    await expect(editor.locator("[data-mention]")).toHaveCount(2);
    await expect
      .poll(async () => (await read()).renditions.find((r: any) => r.platform === "x").body)
      .toBe("Hi @guest_x  @new_guest ");
    await page.reload();
    await expect(editor.locator("[data-mention]")).toHaveCount(2);
    await caretAtEnd(editor);
    await editor.pressSequentially(" @");
    await expect(page.getByRole("option", { name: /@guest.*@new_guest/ })).toBeVisible();
    await expect(editor.locator("[data-mention]")).toHaveCount(2);
    await editor.press("Enter");
    await expect(editor.locator("[data-mention]")).toHaveCount(3);
    await expect
      .poll(async () => (await read()).renditions.find((r: any) => r.platform === "x").body)
      .toBe("Hi @guest_x  @new_guest  @new_guest ");
    const removed = await request.delete(`${libraryPath}/${library[0].id}`, { headers });
    expect(removed.ok()).toBe(true);
    await page.reload();
    await expect(editor.locator("[data-mention]")).toHaveCount(3);
    expect((await read()).renditions.find((r: any) => r.platform === "x").body).toBe(
      "Hi @guest_x  @new_guest  @new_guest ",
    );
    {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
      await page.reload();
      await expect(editor.locator("[data-mention]")).toHaveCount(3);
      const before = await editor.innerText();
      await editor.click();
      await caretAtEnd(editor);
      await editor.pressSequentially(" @");
      await expect(page.getByRole("option", { name: "Add mention", exact: true })).toBeVisible();
      const picker = page.getByRole("listbox");
      await expect(picker).toHaveAttribute("aria-busy", "false");
      const bounds = await picker.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(8);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(1280 - 8);
      await page.getByRole("option", { name: "Add mention", exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS("opacity", "1");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await editor.press("ControlOrMeta+z");
      await expect(editor).toHaveText(before);
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

test.describe("history", () => {
  test("composer history identifies the authored fields changed by a text edit", async ({
    page,
    request,
  }, testInfo) => {
    const clientErrors: string[] = [];
    page.on("pageerror", (error) => clientErrors.push(error.message));
    const auth = await registerUser(request, `history-domains-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Revision history");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Audit revision history",
        intent: "post",
        content_profile: "short_text",
        source_text: "Audit initial text",
        segments: [{ body: "Audit initial text" }],
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const publication = await created.json();
    const path = `/api/v1/publications/${publication.id}`;
    await authenticatePage(page, auth.token);
    await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
    let savedPayload: Record<string, unknown> | undefined;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().endsWith(path))
        savedPayload = request.postDataJSON();
    });
    const textbox = page.getByRole("textbox", { name: "Post text", exact: true });
    await textbox.fill("Audit normalized baseline");
    await expect
      .poll(async () => (await (await request.get(path, { headers })).json()).source_text)
      .toBe("Audit normalized baseline");
    await page.reload();
    await expect(textbox).toHaveText("Audit normalized baseline", { useInnerText: true });
    await textbox.fill("Audit corrected text");
    await expect
      .poll(async () => (await (await request.get(path, { headers })).json()).source_text)
      .toBe("Audit corrected text");
    await page.getByRole("button", { name: "Post settings", exact: true }).click();
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await expect(page.getByTestId("publication-history-scroll")).toBeVisible();
    const events = await (await request.get(`${path}/events`, { headers })).json();
    const revisions = events.filter((event: { revision?: number }) => event.revision);
    expect(revisions[0].changed_domains).toEqual(["content"]);
    await page.keyboard.press("Escape");
    const current = await (await request.get(path, { headers })).json();
    expect(savedPayload).toBeDefined();
    const unchanged = await request.put(path, {
      headers,
      data: { ...savedPayload, expected_revision: current.revision },
    });
    expect(unchanged.ok(), await unchanged.text()).toBe(true);
    const unchangedPost = await unchanged.json();
    const unchangedEvents = await (await request.get(`${path}/events`, { headers })).json();
    expect(
      unchangedEvents.find(
        (event: { revision?: number }) => event.revision === unchangedPost.revision,
      ).changed_domains ?? [],
    ).toEqual([]);
    const metadata = { ...unchangedPost.metadata, audit_note: "Own nontext change" };
    const nontext = await request.put(path, {
      headers,
      data: { expected_revision: unchangedPost.revision, metadata },
    });
    expect(nontext.ok(), await nontext.text()).toBe(true);
    const nontextPost = await nontext.json();
    expect(nontextPost.metadata).toEqual(metadata);
    const nontextEvents = await (await request.get(`${path}/events`, { headers })).json();
    expect(
      nontextEvents.find((event: { revision?: number }) => event.revision === nontextPost.revision)
        .changed_domains,
    ).toEqual(["settings"]);
    {
      {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        await page.reload();
        await expect(textbox).toHaveText("Audit corrected text", { useInnerText: true });
        await page.getByRole("button", { name: "Post settings", exact: true }).focus();
        await page.keyboard.press("Enter");
        await page.getByRole("button", { name: "Version history", exact: true }).click();
        await expect(page.getByTestId("publication-history-scroll")).toBeVisible();
        await expect(page.getByTestId("publication-history-scroll")).toContainText("settings");
        await page.keyboard.press("Escape");
      }
    }
    expect(clientErrors).toEqual([]);
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

  test("a joined Facebook caption edits the delivered description without flattening sources", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `joined-caption-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Joined caption");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','caption-${accountID}','facebook','${accountID}','Caption page',X'00',1);`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        title: "Joined caption",
        content_profile: "thread",
        source_text: "Shared first",
        segments: [
          { id: "first", body: "Shared first" },
          { id: "second", body: "Continuation once" },
        ],
        renditions: [
          {
            social_account_id: accountID,
            output_profile: "facebook.video",
            segments: [
              {
                publication_segment_id: "first",
                source_overrides: [
                  {
                    publication_segment_id: "first",
                    body_override: "Authored first",
                    media_inherited: true,
                  },
                  { publication_segment_id: "second", media_inherited: true },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const publication = await created.json();
    await page.route("**/api/v1/capabilities/resolve", (route) =>
      route.fulfill({
        json: {
          accounts: [
            {
              account_id: accountID,
              provider: "facebook",
              profile: "thread",
              output_profile: "facebook.video",
              segment_strategy: "join",
              label: "Facebook video",
              text_limit: 5000,
              compatible: true,
              media: { min_count: 0, max_count: 1, allowed_mimes: [] },
              settings: [
                {
                  key: "video_description",
                  label: "Description",
                  type: "textarea",
                  scope: "destination",
                  group: "content",
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
    await page.locator(`#composer-destination-${accountID}`).click();
    const editor = page.getByRole("textbox", { name: "Post text", exact: true });
    await expect(editor).toHaveCount(1);
    await expect(editor).toHaveText("Authored first\n\nContinuation once", { useInnerText: true });
    await editor.fill("Caption first\n\nContinuation edited");
    await expect
      .poll(async () => {
        const saved = await (
          await request.get(`/api/v1/publications/${publication.id}`, { headers })
        ).json();
        return {
          description: saved.renditions[0].settings?.video_description,
          sources: saved.segments.map((source: any) => source.body),
          sourceOverrides: saved.renditions[0].segments[0].source_overrides.map(
            (source: any) => source.body_override,
          ),
        };
      })
      .toEqual({
        description: "Caption first\n\nContinuation edited",
        sources: ["Shared first", "Continuation once"],
        sourceOverrides: ["Authored first", undefined],
      });
    await page.reload();
    await page.locator(`#composer-destination-${accountID}`).click();
    await expect(editor).toHaveText("Caption first\n\nContinuation edited", { useInnerText: true });
    await page
      .getByTestId("composer-variant-toolbar")
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Reset", exact: true }).click();
    await expect(editor).toHaveText("Authored first\n\nContinuation once", { useInnerText: true });
    await expect
      .poll(async () => {
        const saved = await (
          await request.get(`/api/v1/publications/${publication.id}`, { headers })
        ).json();
        return {
          description: saved.renditions[0].settings?.video_description,
          first: saved.renditions[0].segments[0].source_overrides?.[0]?.body_override,
        };
      })
      .toEqual({ description: "", first: "Authored first" });
    // Drive ProseMirror's selection transaction before deleting the whole caption.
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await editor.press("Backspace");
    await expect(editor).toHaveText("");
    await expect
      .poll(async () => {
        const saved = await (
          await request.get(`/api/v1/publications/${publication.id}`, { headers })
        ).json();
        return saved.renditions[0].segments[0].settings.caption_mentions?.body;
      })
      .toBe("");
    await page
      .getByTestId("composer-variant-toolbar")
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Reset", exact: true }).click();
    await expect(editor).toHaveText("Authored first\n\nContinuation once", { useInnerText: true });
    await page
      .getByTestId("composer-variant-toolbar")
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Use shared", exact: true }).click();
    await expect(editor).toHaveText("Shared first\n\nContinuation once", { useInnerText: true });
    await expect(page.getByRole("button", { name: "Shared content", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(async () => {
        const saved = await (
          await request.get(`/api/v1/publications/${publication.id}`, { headers })
        ).json();
        return saved.renditions[0].segments[0].source_overrides?.[0]?.body_override;
      })
      .toBeUndefined();
  });
});

test.describe("unsaved navigation", () => {
  test("scheduled edits survive cancelled navigation and require an explicit discard", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(90_000);
    const auth = await registerUser(request, `scheduled-navigation-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Scheduled navigation");
    const other = await createWorkspace(request, auth.token, "Other workspace");
    const original = "Original scheduled release note";
    const edited = "Edited scheduled release note to preserve";
    const publication = await createPublication(request, auth.token, workspace.id, original);
    // This read fixture has no destinations or jobs, so no provider delivery can execute.
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `UPDATE publications SET status='scheduled', scheduled_at='2099-12-15 12:00:00+00:00' WHERE id='${publication.id}';`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const path = `/api/v1/publications/${publication.id}`;
    const read = async () => {
      const response = await request.get(path, { headers });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    const editorURL = `/publications/${publication.id}?workspace_id=${workspace.id}`;
    const input = page.getByRole("textbox", { name: "Post text", exact: true });
    const messages: string[] = [];
    let discard = false;
    page.on("dialog", async (dialog) => {
      messages.push(dialog.type());
      if (discard) await dialog.accept();
      else await dialog.dismiss();
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(editorURL);
    await expect(input).toHaveText(original, { useInnerText: true });
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await expect(page).toHaveURL(/\/publications$/);
    expect(messages).toEqual([]);
    await page.goto(editorURL);
    await expect(input).toHaveText(original, { useInnerText: true });

    {
      {
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        await input.fill(edited);
        const previousPrompts = messages.length;
        await page.getByRole("button", { name: "Posts", exact: true }).click();
        expect(messages.slice(previousPrompts)).toEqual(["confirm"]);
        await expect(page).toHaveURL(new RegExp(`/publications/${publication.id}`));
        await expect(input).toHaveText(edited, { useInnerText: true });
        expect((await read()).source_text).toBe(original);
      }
    }

    const beforeReload = messages.length;
    // Initiate the browser reload without waiting for a navigation that is cancelled.
    await page.evaluate(() => window.location.reload());
    await expect.poll(() => messages.slice(beforeReload)).toEqual(["beforeunload"]);
    expect(messages.slice(beforeReload)).toEqual(["beforeunload"]);
    await expect(input).toHaveText(edited, { useInnerText: true });

    await page.setViewportSize({ width: 1280, height: 1000 });
    const beforeSwitch = messages.length;
    await page
      .getByRole("button", { name: new RegExp(workspace.name) })
      .first()
      .click();
    await page.getByRole("menuitem", { name: new RegExp(other.name) }).click();
    const workspaceDialog = page.getByTestId("composer-workspace-switch-dialog");
    await expect(workspaceDialog).toBeVisible();
    expect(messages.length).toBe(beforeSwitch);
    await workspaceDialog.getByRole("button", { name: "Stay here", exact: true }).click();
    await expect(input).toHaveText(edited, { useInnerText: true });

    await input.fill(original);
    const beforeCleanExit = messages.length;
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await expect(page).toHaveURL(/\/publications$/);
    expect(messages.length).toBe(beforeCleanExit);

    await page.goto(editorURL);
    await expect(input).toHaveText(original, { useInnerText: true });
    await input.fill(edited);
    discard = true;
    const beforeDiscard = messages.length;
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await expect(page).toHaveURL(/\/publications$/);
    expect(messages.slice(beforeDiscard)).toEqual(["confirm"]);
    const stored = await read();
    expect(stored.source_text).toBe(original);
    expect(stored.revision).toBe(publication.revision);

    await page.goto(editorURL);
    await expect(input).toHaveText(original, { useInnerText: true });
    await input.fill(edited);
    const beforeWorkspaceDiscard = messages.length;
    await page
      .getByRole("button", { name: new RegExp(workspace.name) })
      .first()
      .click();
    await page.getByRole("menuitem", { name: new RegExp(other.name) }).click();
    await expect(workspaceDialog).toBeVisible();
    await workspaceDialog.getByRole("button", { name: "Discard and switch", exact: true }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:${process.env.OPENPOST_APP_E2E_PORT ?? 18180}/`);
    expect(messages.length).toBe(beforeWorkspaceDiscard);
    expect((await read()).source_text).toBe(original);
    expect(pageErrors).toEqual([]);
  });

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

  test("composer ignores stale accounts and recovers the current workspace", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `composer-recovery-${unique}@example.com`);
    const first = (await createWorkspace(request, auth.token, `Slow ${unique}`)) as {
      id: string;
      name: string;
    };
    const second = (await createWorkspace(request, auth.token, `Current ${unique}`)) as {
      id: string;
      name: string;
    };
    await authenticatePage(page, auth.token);
    await page.addInitScript((workspace) => {
      localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
    }, first);

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolveGate) => (releaseFirst = resolveGate));
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolveStarted) => (markFirstStarted = resolveStarted));
    let markFirstFinished!: () => void;
    const firstFinished = new Promise<void>(
      (resolveFinished) => (markFirstFinished = resolveFinished),
    );
    let secondRequests = 0;
    await page.route("**/api/v1/accounts?**", async (route) => {
      const workspaceID = new URL(route.request().url()).searchParams.get("workspace_id");
      if (workspaceID === first.id) {
        markFirstStarted();
        await firstGate;
        await route.fulfill({
          contentType: "application/json",
          json: [socialAccount("stale-account", first.id, "stale_previous")],
        });
        markFirstFinished();
        return;
      }

      secondRequests++;
      // Fail the initial attempt and its one automatic retry so the error
      // surfaces instead of being absorbed.
      if (secondRequests <= 2) {
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          json: { title: "Unavailable", status: 503 },
        });
        return;
      }

      await route.fulfill({
        contentType: "application/json",
        json: [socialAccount("current-account", second.id, "current_workspace")],
      });
    });
    await page.route("**/api/v1/capabilities/resolve", async (route) => {
      const payload = route.request().postDataJSON() as { account_ids: string[] };
      await route.fulfill({
        contentType: "application/json",
        json: {
          accounts: payload.account_ids.map(resolvedBlueskyCapability),
        },
      });
    });

    await page.goto("/");
    await firstStarted;

    const workspaceButton = page.getByRole("button", { name: new RegExp(first.name) }).first();
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();

    const loadError = page.locator("[data-sonner-toast]").filter({
      hasText: "Failed to load accounts",
    });
    await expect(loadError).toBeVisible();
    await expect(page.getByTestId("composer-account-control")).toHaveCount(0);

    // The previous request may finish after the current one failed. It must still be ignored.
    releaseFirst();
    await firstFinished;
    await expect(loadError).toBeVisible();
    await expect(page.getByTestId("composer-account-control")).toHaveCount(0);
    await expect(page.getByText("stale_previous", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await page.getByTestId("composer-account-control").click();
    await expect(
      page.getByTestId("composer-account-row").getByText("@current_workspace", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("stale_previous", { exact: true })).toHaveCount(0);
    expect(secondRequests).toBe(3);
  });

  test("activity clears cross-workspace data and preserves a valid view on refresh failure", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `activity-recovery-${unique}@example.com`);
    const first = (await createWorkspace(request, auth.token, `First ${unique}`)) as {
      id: string;
      name: string;
    };
    const second = (await createWorkspace(request, auth.token, `Second ${unique}`)) as {
      id: string;
      name: string;
    };
    await authenticatePage(page, auth.token);
    await page.addInitScript((workspace) => {
      localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
    }, first);

    let releaseFirstRefresh!: () => void;
    const firstRefreshGate = new Promise<void>(
      (resolveGate) => (releaseFirstRefresh = resolveGate),
    );
    let markFirstRefreshStarted!: () => void;
    const firstRefreshStarted = new Promise<void>(
      (resolveStarted) => (markFirstRefreshStarted = resolveStarted),
    );
    let firstRefreshFinished = false;
    let gateNextFirstRefresh = false;
    let failNextPublicationsRequests = 0;
    let manualRefreshRequests = 0;

    await page.route("**/api/v1/publications?**", async (route) => {
      const url = new URL(route.request().url());
      const workspaceID = url.searchParams.get("workspace_id");
      if (!url.searchParams.has("status")) manualRefreshRequests++;
      if (url.searchParams.has("status")) {
        await route.fulfill({
          contentType: "application/json",
          headers: { "X-Has-More": "false" },
          json: [],
        });
        return;
      }
      let isGatedFirstRefresh = false;
      // Fail the manual refresh and its one automatic retry so the posts
      // error surfaces instead of being absorbed.
      if (failNextPublicationsRequests > 0) {
        failNextPublicationsRequests--;
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          json: { title: "Unavailable", status: 503 },
        });
        return;
      }
      if (gateNextFirstRefresh && workspaceID === first.id) {
        gateNextFirstRefresh = false;
        isGatedFirstRefresh = true;
        markFirstRefreshStarted();
        await firstRefreshGate;
      }
      const isSecond = workspaceID === second.id;
      try {
        await route.fulfill({
          contentType: "application/json",
          headers: { "X-Has-More": "false" },
          json: [
            {
              id: isSecond ? "current-publication" : "previous-publication",
              workspace_id: workspaceID,
              created_by: "activity-recovery-user",
              title: isSecond ? "Current workspace post" : "Previous workspace post",
              intent: "post",
              content_profile: "short_text",
              source_text: isSecond ? "Current workspace post" : "Previous workspace post",
              source_url: "",
              goal: "",
              audience: "",
              status: "draft",
              revision: 1,
              scheduled_at: "",
              actual_run_at: "",
              created_at: "2026-07-20T10:00:00Z",
              updated_at: "2026-07-20T10:00:00Z",
              metadata: {},
              renditions: [],
              segments: [
                {
                  id: isSecond ? "current-segment" : "previous-segment",
                  position: 0,
                  body: isSecond ? "Current workspace post" : "Previous workspace post",
                  title: "",
                  description: "",
                  url: "",
                  settings: {},
                  media: [],
                },
              ],
              media: [],
            },
          ],
        });
      } finally {
        if (isGatedFirstRefresh) firstRefreshFinished = true;
      }
    });
    // Failed-job polling is scoped to the failed activity bucket, so it never
    // fires on the drafts tab; the jobs endpoint needs no mock here.
    await page.route("**/api/v1/accounts?**", async (route) => {
      await route.fulfill({ contentType: "application/json", json: [] });
    });

    await page.goto("/publications?tab=drafts");
    await expect(page.locator("main").getByText("Previous workspace post")).toBeVisible();
    gateNextFirstRefresh = true;
    await page.getByRole("button", { name: "Refresh" }).click();
    await firstRefreshStarted;

    const workspaceButton = page.getByRole("button", { name: new RegExp(first.name) }).first();
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();
    await expect(page.locator("main").getByText("Current workspace post")).toBeVisible();
    releaseFirstRefresh();
    await expect.poll(() => firstRefreshFinished).toBe(true);
    await expect(page.locator("main").getByText("Previous workspace post")).toHaveCount(0);
    await expect(page.locator("main").getByText("Current workspace post")).toBeVisible();

    // A failed background refresh keeps the cached view and surfaces a retryable
    // warning instead of replacing the page with an error screen.
    const refreshRequestsBefore = manualRefreshRequests;
    failNextPublicationsRequests = 2;
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect
      .poll(() => manualRefreshRequests - refreshRequestsBefore)
      .toBeGreaterThanOrEqual(2);
    await expect(page.getByText("Failed to load posts")).toBeVisible();
    await expect(page.locator("main").getByText("Current workspace post")).toBeVisible();
  });

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
