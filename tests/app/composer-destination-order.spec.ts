import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("composer destination order survives edits, reload and inventory return", async ({
  page,
  request,
}, testInfo) => {
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
  const tabs = page.locator('[id^="composer-destination-"]');
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
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
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
