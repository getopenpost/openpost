import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Messages prepends older history without moving the visible message", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `message-pages-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Message history")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);
  const history = Array.from({ length: 235 }, (_, index) => messageFixture(workspace.id, index));
  let olderFailures = 1;
  let releaseOlder: (() => void) | undefined;
  const olderRequested = new Promise<void>((resolve) => (releaseOlder = resolve));
  let fulfillOlder: (() => Promise<void>) | undefined;

  await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/messages?**", (route) =>
    route.fulfill({
      json: { items: [conversationFixture(workspace.id)], total: 1, sync_states: [] },
    }),
  );
  await page.route("**/api/v1/messages/conversation-1?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor") ?? "";
    if (cursor === "older" && olderFailures-- > 0) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { status: 503, title: "Unavailable", detail: "Older message history failed" },
      });
      return;
    }
    if (cursor === "older") {
      fulfillOlder = () =>
        route.fulfill({ json: { items: history.slice(0, 35), next_cursor: "" } });
      releaseOlder?.();
      return;
    }
    await route.fulfill({ json: { items: history.slice(35), next_cursor: "older" } });
  });
  await page.route("**/api/v1/messages/conversation-1/send", (route) =>
    route.fulfill({ json: { ...messageFixture(workspace.id, 236), direction: "outbound" } }),
  );

  await page.goto(`/inbox/messages?workspace=${workspace.id}`);
  await page.getByRole("button", { name: /Conversation person/ }).click();
  const viewport = page.getByTestId("message-history");
  await expect(page.getByText("Message 234", { exact: true })).toBeVisible();
  await viewport.evaluate((element) => {
    element.scrollTop = 1;
  });
  await expect(page.getByText("Older message history failed")).toBeVisible();

  const anchor = page.locator('[data-message-id="message-035"]');
  const before = await anchor.boundingBox();
  await page.getByRole("button", { name: "Try again" }).click();
  await olderRequested;
  await page.getByPlaceholder("Write a message…").fill("Concurrent reply");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator('[data-message-id="message-236"]')).toBeAttached();
  await fulfillOlder?.();
  await expect(page.getByText("Message 0", { exact: true })).toBeAttached();
  const after = await anchor.boundingBox();
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  await expect(page.locator("[data-message-id]")).toHaveCount(236);
});

test("Messages ignores an older page after the active conversation changes", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `message-stale-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Message request fencing")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/messages?**", (route) =>
    route.fulfill({
      json: {
        items: [
          conversationFixture(workspace.id),
          conversationFixture(workspace.id, "conversation-2", "Second person"),
        ],
        total: 2,
        sync_states: [],
      },
    }),
  );
  let releaseOlder: (() => void) | undefined;
  const olderRequested = new Promise<void>((resolve) => (releaseOlder = resolve));
  let fulfillOlder: (() => Promise<void>) | undefined;
  await page.route("**/api/v1/messages/conversation-1?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor") ?? "";
    if (!cursor)
      return route.fulfill({
        json: { items: [messageFixture(workspace.id, 2)], next_cursor: "older" },
      });
    fulfillOlder = () =>
      route.fulfill({ json: { items: [messageFixture(workspace.id, 1)], next_cursor: "" } });
    releaseOlder?.();
  });
  await page.route("**/api/v1/messages/conversation-2?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...messageFixture(workspace.id, 3),
            conversation_id: "conversation-2",
            body: "Second conversation body",
          },
        ],
      },
    }),
  );

  await page.goto(`/inbox/messages?workspace=${workspace.id}`);
  await page.getByRole("button", { name: /Conversation person/ }).click();
  await page.getByTestId("message-history").evaluate((element) => (element.scrollTop = 0));
  await olderRequested;
  await page.getByRole("button", { name: /Second person/ }).click();
  await expect(page.getByText("Second conversation body")).toBeVisible();
  await fulfillOlder?.();
  await expect(page.getByText("Message 1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Second conversation body")).toBeVisible();
});

function conversationFixture(
  workspaceID: string,
  id = "conversation-1",
  name = "Conversation person",
) {
  return {
    id,
    workspace_id: workspaceID,
    social_account_id: "account-1",
    platform: "bluesky",
    remote_conversation_id: id,
    counterpart_remote_id: id,
    counterpart_name: name,
    counterpart_handle: `@${id}`,
    counterpart_avatar_url: "",
    last_message_at: "2026-08-10T12:00:00Z",
    last_message_preview: `${name} preview`,
    last_remote_message_id: `${id}-message`,
    unread_count: 0,
    created_at: "2026-08-10T12:00:00Z",
    updated_at: "2026-08-10T12:00:00Z",
  };
}

function messageFixture(workspaceID: string, index: number) {
  const timestamp = new Date(Date.UTC(2026, 7, 10, 12, 0, index)).toISOString();
  return {
    id: `message-${index.toString().padStart(3, "0")}`,
    workspace_id: workspaceID,
    conversation_id: "conversation-1",
    direction: "inbound",
    body: `Message ${index}`,
    attachments_json: "[]",
    send_status: "received",
    remote_created_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
}
