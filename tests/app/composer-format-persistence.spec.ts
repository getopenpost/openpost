import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=",
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
    if (response.request().method() === "PUT" && response.url().endsWith(path) && !response.ok()) {
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
              { output_profile: "instagram.feed", label: "Feed", compatible: true },
              { output_profile: "instagram.story", label: "Story", compatible: true },
              { output_profile: "instagram.reel", label: "Reel", compatible: true },
            ],
            media: { min_count: 1, max_count: 10, allowed_mimes: ["image/png"] },
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
  await page.getByRole("button", { name: "Platform settings", exact: true }).click();
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
  await page.getByRole("button", { name: "Platform settings", exact: true }).click();
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

  await page.screenshot({ path: testInfo.outputPath("media-follow-up-reloaded.png") });
});
