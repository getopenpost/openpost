import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser, composerDestinations } from "./helpers";

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
      await description.fill("");
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
              saved.renditions[0].segments[0].settings.caption_mentions.mentions.spans[0].target.id,
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
      await page.getByRole("menuitem", { name: "Copy rendition to…", exact: true }).click();
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
  await page.getByRole("menuitem", { name: "Copy rendition to…", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(async () => {
      const saved = await (
        await request.get(`/api/v1/publications/${publication.id}`, { headers })
      ).json();
      return saved.renditions.find(
        (rendition: { social_account_id: string }) => rendition.social_account_id === accountIDs[1],
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
    page.getByRole("alert").filter({ hasText: "A post can include at most 50 selected mentions." }),
  ).toBeVisible();
  await expect(editor).toHaveText("Intro 🚀 Hello @alice.bsky.social ", { useInnerText: true });

  const saved = await read();
  expect(saved.segments[0].body).toBe("🚀 Hello ");
  expect(saved.segments[1].body).toBe("Thread tail");
  await composerDestinations(page).getByRole("button", { name: "All", exact: true }).click();
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

  for (const width of [1280, 390, 320])
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await expect(editor).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`mentions-${width}-${colorScheme}.png`),
        fullPage: true,
      });
    }
  expect(errors).toEqual([]);
});
