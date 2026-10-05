import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  await page.screenshot({ path: testInfo.outputPath("before-reload.png") });
  await page.reload();
  await page.locator(`#composer-destination-${accountID}`).click();
  await expect(editors.nth(0)).toHaveValue("Custom first 東京");
  await expect(editors.nth(1)).toHaveValue("Continuation once");
  await editors.nth(0).fill("Custom first edited");
  await expect
    .poll(async () => {
      const saved = await (await request.get(path, { headers })).json();
      return saved.renditions[0].segments[0].body_override;
    })
    .toBe("Custom first edited\n\nContinuation once");
  await page.screenshot({ path: testInfo.outputPath("after-reload.png") });
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.reload();
      await page.locator(`#composer-destination-${accountID}`).click();
      await expect(editors.nth(0)).toHaveValue("Custom first edited");
      await expect(editors.nth(1)).toHaveValue("Continuation once");
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await editors.nth(0).focus();
      await page.keyboard.press("Tab");
      await expect(editors.nth(0)).not.toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`joined-${width}-${colorScheme}.png`),
      });
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
  await expect(editor).toHaveValue("Authored first\n\nContinuation once");
  await editor.fill("Caption first\n\nContinuation edited");
  await expect
    .poll(async () => {
      const saved = await (
        await request.get(`/api/v1/publications/${publication.id}`, { headers })
      ).json();
      return {
        description: saved.renditions[0].settings?.video_description,
        sources: saved.segments.map((source: any) => source.body),
      };
    })
    .toEqual({
      description: "Caption first\n\nContinuation edited",
      sources: ["Shared first", "Continuation once"],
    });
  await page.reload();
  await page.locator(`#composer-destination-${accountID}`).click();
  await expect(editor).toHaveValue("Caption first\n\nContinuation edited");
  await page
    .getByTestId("composer-variant-toolbar")
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Reset", exact: true }).click();
  await expect(editor).toHaveValue("Authored first\n\nContinuation once");
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
  await page
    .getByTestId("composer-variant-toolbar")
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Use shared", exact: true }).click();
  await expect(editor).toHaveValue("Shared first\n\nContinuation once");
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
