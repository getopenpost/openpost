import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Messages reaches older conversations without losing filters or selection", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `conversation-pages-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Conversation history")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);
  const conversations = Array.from({ length: 235 }, (_, index) => ({
    id: `conversation-${index.toString().padStart(3, "0")}`,
    workspace_id: workspace.id,
    social_account_id: "account-1",
    platform: "bluesky",
    remote_conversation_id: `remote-${index}`,
    counterpart_remote_id: `person-${index}`,
    counterpart_name: `Person ${index}`,
    counterpart_handle: `@person${index}`,
    counterpart_avatar_url: "",
    last_message_at: new Date(Date.UTC(2026, 7, 10, 12, 0, 0) - index * 1000).toISOString(),
    last_message_preview: `Conversation preview ${index}`,
    last_remote_message_id: `message-${index}`,
    unread_count: 0,
    archived_at: "2026-08-10T12:00:00Z",
    created_at: "2026-08-10T12:00:00Z",
    updated_at: "2026-08-10T12:00:00Z",
  }));
  let initialFailures = 1;
  let olderFailures = 1;

  await page.route("**/api/v1/accounts?**", (route) =>
    route.fulfill({
      json: [
        {
          id: "account-1",
          platform: "bluesky",
          account_id: "provider-account",
          account_username: "openpost.example",
          is_active: true,
        },
      ],
    }),
  );
  await page.route("**/api/v1/messages?**", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor") ?? "";
    const fullyFiltered =
      url.searchParams.get("platform") === "bluesky" &&
      url.searchParams.get("account_id") === "account-1" &&
      url.searchParams.get("archived") === "true";
    if (!cursor && !fullyFiltered && initialFailures-- > 0) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { status: 503, title: "Unavailable", detail: "Conversation list failed" },
      });
      return;
    }
    if (cursor) {
      expect(url.searchParams.get("workspace_id")).toBe(workspace.id);
      expect(fullyFiltered).toBe(true);
    }
    if (cursor === "page-2" && olderFailures-- > 0) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { status: 503, title: "Unavailable", detail: "Older conversations failed" },
      });
      return;
    }
    const offset = cursor === "page-2" ? 99 : cursor === "page-3" ? 199 : 0;
    const items = conversations.slice(offset, offset + 100);
    if (cursor === "page-2") {
      items.unshift({
        ...conversations[0],
        last_message_preview: "Stale duplicate must not replace newer data",
        updated_at: "2026-08-09T12:00:00Z",
      });
    }
    await route.fulfill({
      json: {
        items,
        total: conversations.length,
        sync_states: [],
        next_cursor: cursor === "page-3" ? "" : cursor === "page-2" ? "page-3" : "page-2",
      },
    });
  });
  await page.route("**/api/v1/messages/conversation-000?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "message-selected",
            workspace_id: workspace.id,
            conversation_id: "conversation-000",
            direction: "inbound",
            body: "Selected conversation body",
            attachments_json: "[]",
            send_status: "received",
            created_at: "2026-08-10T12:00:00Z",
            updated_at: "2026-08-10T12:00:00Z",
          },
        ],
        next_cursor: "",
      },
    }),
  );

  await page.goto(`/inbox/messages?workspace=${workspace.id}`);
  await expect(page.getByText("Conversation list failed")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: /Person 0/ }).click();
  await expect(page.getByText("Selected conversation body")).toBeVisible();

  await page.getByRole("button", { name: "All platforms" }).click();
  await page.getByRole("option", { name: "Bluesky" }).click();
  await page.getByRole("button", { name: "All accounts" }).click();
  await page.getByRole("option", { name: "openpost.example" }).click();
  await page.getByText("Archived", { exact: true }).click();
  await expect(page.getByText("Selected conversation body")).toBeVisible();

  await page.getByRole("button", { name: "Load older conversations" }).click();
  await expect(page.getByText("Older conversations failed")).toBeVisible();
  await expect(page.getByText("Selected conversation body")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: /Person 198/ })).toBeVisible();
  await page.getByRole("button", { name: "Load older conversations" }).click();
  await expect(page.getByRole("button", { name: /Person 234/ })).toBeVisible();
  await expect(page.locator('section[aria-label="Messages"] button[data-unread]')).toHaveCount(235);
  await expect(page.getByText("Conversation preview 0")).toBeVisible();
  await expect(page.getByText("Stale duplicate must not replace newer data")).toHaveCount(0);
});

test("Messages ignores a conversation page from the prior Workspace", async ({ page, request }) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `conversation-stale-${unique}@example.com`);
  const firstName = `First inbox ${unique}`;
  const secondName = `Second inbox ${unique}`;
  const first = (await createWorkspace(request, auth.token, firstName)) as { id: string };
  const second = (await createWorkspace(request, auth.token, secondName)) as { id: string };
  await authenticatePage(page, auth.token);
  await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: [] }));

  let releaseFirst: (() => void) | undefined;
  const firstRequested = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let fulfillFirst: (() => Promise<void>) | undefined;
  await page.route("**/api/v1/messages?**", async (route) => {
    const workspaceID = new URL(route.request().url()).searchParams.get("workspace_id");
    if (workspaceID === first.id) {
      fulfillFirst = () =>
        route.fulfill({
          json: {
            items: [conversationFixture(first.id, "first-conversation", "First person")],
            total: 1,
            sync_states: [],
          },
        });
      releaseFirst?.();
      return;
    }
    await route.fulfill({
      json: {
        items: [conversationFixture(second.id, "second-conversation", "Second person")],
        total: 1,
        sync_states: [],
      },
    });
  });

  await page.goto(`/inbox/messages?workspace=${first.id}`);
  await firstRequested;
  const workspaceButton = page
    .getByRole("button", { name: new RegExp(`${firstName}|${secondName}`) })
    .first();
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(secondName) }).click();
  await expect(page.getByRole("button", { name: /Second person/ })).toBeVisible();
  await fulfillFirst?.();
  await expect(page.getByRole("button", { name: /First person/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Second person/ })).toBeVisible();
});

function conversationFixture(workspaceID: string, id: string, name: string) {
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
