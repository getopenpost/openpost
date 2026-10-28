import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

// A message the provider cannot describe has no body and no attachments. The
// bubble must say so instead of rendering as an empty bubble.
test("Messages explains a message with no available content", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const { token } = await registerUser(request, `messages-no-content-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, token, "Messages no content");
  const accountID = randomUUID();
  const conversationID = randomUUID();
  const messageID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','messages-no-content','bluesky','${accountID}','Shared post test',X'00',1);
     INSERT INTO account_features (social_account_id,workspace_id,feature,enabled,decided_at) VALUES ('${accountID}','${workspace.id}','messaging',1,CURRENT_TIMESTAMP);
     INSERT INTO conversations (id,workspace_id,social_account_id,platform,remote_conversation_id,counterpart_remote_id,counterpart_name,counterpart_handle,last_message_at,last_message_preview,last_remote_message_id) VALUES ('${conversationID}','${workspace.id}','${accountID}','bluesky','remote-thread','alice','Alice','@alice',CURRENT_TIMESTAMP,'','remote-message');
     INSERT INTO direct_messages (id,workspace_id,conversation_id,remote_message_id,direction,author_remote_id,body,attachments_json,send_status,remote_created_at) VALUES ('${messageID}','${workspace.id}','${conversationID}','remote-message','inbound','alice','','[]','received',CURRENT_TIMESTAMP);
     INSERT INTO direct_messages (id,workspace_id,conversation_id,remote_message_id,direction,author_remote_id,body,attachments_json,send_status,remote_created_at) VALUES ('${messageID}-text','${workspace.id}','${conversationID}','remote-text','inbound','alice','Message with text','[]','received',CURRENT_TIMESTAMP);
     INSERT INTO direct_messages (id,workspace_id,conversation_id,remote_message_id,direction,author_remote_id,body,attachments_json,send_status,remote_created_at) VALUES ('${messageID}-media','${workspace.id}','${conversationID}','remote-media','inbound','alice','','[{"type":"image","url":"https://cdn.example/photo.jpg"}]','received',CURRENT_TIMESTAMP);`,
  ]);
  await authenticatePage(page, token);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/inbox/messages");
  const conversation = page.getByRole("button", { name: /Alice/ }).first();
  await expect(conversation).toBeVisible();
  await conversation.click();
  const label = page.getByText("No text or attachments are available for this message.", {
    exact: true,
  });
  await expect(label).toHaveCount(1);
  await expect(page.getByText("Message with text", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "image", exact: true })).toBeVisible();
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      await page.getByRole("button", { name: /Alice/ }).first().click();
      await expect(label).toHaveCount(1);
      await page.screenshot({
        path: testInfo.outputPath(`inbox-no-content-${width}-${scheme}.png`),
      });
    }
  }
});
