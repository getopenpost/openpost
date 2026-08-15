import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Engagement reaches every older item and keeps filters and selections during retries", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `engagement-pages-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Engagement history")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);

  const engagement = Array.from({ length: 235 }, (_, index) => ({
    id: `engagement-${index.toString().padStart(3, "0")}`,
    workspace_id: workspace.id,
    rendition_id: `rendition-${index.toString().padStart(3, "0")}`,
    social_account_id: "account-1",
    platform: "bluesky",
    remote_id: `remote-${index}`,
    parent_remote_id: "",
    conversation_remote_id: "",
    author_remote_id: `author-${index}`,
    author_name: `Reader ${index}`,
    author_handle: `@reader${index}`,
    author_avatar_url: "",
    body: `Reply ${index}`,
    is_ours: false,
    can_reply: index === 0,
    can_hide: false,
    can_delete: false,
    hidden: false,
    remote_created_at: new Date(Date.UTC(2026, 7, 10, 12, 0, 0) - index * 1000).toISOString(),
    last_seen_at: "2026-08-10T12:00:00Z",
    created_at: "2026-08-10T12:00:00Z",
    updated_at: "2026-08-10T12:00:00Z",
    attachments: [],
  }));
  const publications = Array.from({ length: 220 }, (_, index) => ({
    id: `publication-${index.toString().padStart(3, "0")}`,
    workspace_id: workspace.id,
    title: `Launch note ${index}`,
    source_text: `Publication source ${index}`,
    status: "published",
    content_profile: "short_text",
    renditions: [],
  }));
  let initialFailures = 1;
  let olderFailures = 1;
  let publicationSearchFailures = 1;
  const requestedPages: string[] = [];

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
  await page.route("**/api/v1/engagement?**", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor") ?? "";
    const unreadOnly = url.searchParams.get("unread_only") === "true";
    requestedPages.push(cursor);
    expect(url.searchParams.get("workspace_id")).toBe(workspace.id);
    if (cursor) {
      expect(unreadOnly).toBe(true);
      expect(url.searchParams.get("platform")).toBe("bluesky");
      expect(url.searchParams.get("account_id")).toBe("account-1");
      expect(url.searchParams.get("publication_id")).toBe("publication-000");
      expect(url.searchParams.get("archived")).toBe("true");
    }
    if (unreadOnly && !cursor && initialFailures-- > 0) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { status: 503, title: "Unavailable", detail: "Initial engagement failed" },
      });
      return;
    }
    if (cursor === "page-2" && olderFailures-- > 0) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { status: 503, title: "Unavailable", detail: "Older engagement failed" },
      });
      return;
    }
    const offset = cursor === "page-2" ? 100 : cursor === "page-3" ? 199 : 0;
    const pageItems = engagement.slice(offset, offset + 100);
    await route.fulfill({
      json: {
        items: pageItems,
        total: engagement.length,
        sync_states: [],
        next_cursor: cursor === "page-3" ? "" : cursor === "page-2" ? "page-3" : "page-2",
      },
    });
  });
  await page.route("**/api/v1/publications?**", async (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    if (search === "launch note 1" && publicationSearchFailures-- > 0) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { status: 503, title: "Unavailable", detail: "Post search failed" },
      });
      return;
    }
    const matching = publications.filter(
      (publication) =>
        !search ||
        publication.title.toLowerCase().includes(search) ||
        publication.source_text.toLowerCase().includes(search),
    );
    const offset = Number(url.searchParams.get("cursor") ?? "0");
    const items = matching.slice(offset, offset + 50);
    const next = offset + items.length < matching.length ? String(offset + items.length) : "";
    await route.fulfill({
      headers: { "X-Next-Cursor": next },
      json: items,
    });
  });

  await page.goto(`/engagement?workspace=${workspace.id}`);
  const engagementMain = page.locator("#main-content");
  await page.getByText("Unread only", { exact: true }).click();
  await expect(page.getByText("Initial engagement failed")).toBeVisible();
  await engagementMain.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Reply 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All accounts" }).click();
  await page.getByRole("option", { name: "openpost.example" }).click();
  await page.getByRole("button", { name: "All platforms" }).click();
  await page.getByRole("option", { name: "Bluesky" }).click();
  await page.getByRole("combobox", { name: "All posts" }).click();
  await page.getByRole("option", { name: "Launch note 0" }).click();
  await page.getByText("Archived", { exact: true }).click();
  await expect(page.getByText("Reply 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByPlaceholder("Write a reply…")).toBeVisible();

  const readingAnchor = page.locator('[data-engagement-id="engagement-099"]');
  await readingAnchor.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Load older", exact: true }).click();
  await expect(page.getByText("Older engagement failed")).toBeVisible();
  await expect(page.getByPlaceholder("Write a reply…")).toBeVisible();
  await engagementMain.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Reply 199", { exact: true })).toBeVisible();
  await expect(readingAnchor).toBeInViewport();
  await page.getByRole("button", { name: "Load older", exact: true }).click();
  await expect(page.getByText("Reply 234", { exact: true })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(235);
  expect(requestedPages.filter((cursor) => cursor === "page-2")).toHaveLength(2);

  const publicationFilter = page.getByRole("combobox", { name: "All posts" });
  await publicationFilter.click();
  for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
    await page.getByRole("button", { name: "Load older posts" }).click();
  }
  await page.getByRole("option", { name: "Launch note 219" }).click();
  await expect(publicationFilter).toContainText("Launch note 219");
  await publicationFilter.click();
  await page.getByPlaceholder("Search posts").fill("Launch note 1");
  await expect(page.getByText("Post search failed")).toBeVisible();
  await expect(publicationFilter).toContainText("Launch note 219");
  await page
    .getByRole("listbox", { name: "Suggestions..." })
    .getByRole("button", { name: "Try again" })
    .click();
  await expect(page.getByRole("option", { name: "Launch note 1", exact: true })).toBeVisible();
  await expect(publicationFilter).toContainText("Launch note 219");
});
