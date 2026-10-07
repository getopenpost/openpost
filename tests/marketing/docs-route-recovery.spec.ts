import { expect, test } from "@playwright/test";

test("known documentation URLs at the public root recover to their mounted pages", async ({
  request,
}) => {
  for (const [from, to] of [
    ["/workflows", "/docs/workflows"],
    ["/workflows/examples/feed-digest", "/docs/workflows/examples/feed-digest"],
    [
      "/api-reference/editor-agent/save-editor-preference",
      "/docs/api-reference/editor-agent/save-editor-preference",
    ],
    ["/mcp/chat-assistants", "/docs/mcp/chat-assistants"],
    ["/guides/screenshot-templates", "/docs/guides/screenshot-templates"],
  ]) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(301);
    expect(new URL(response.headers().location, response.url()).pathname).toBe(to);
  }
  expect((await request.get("/auth/profile", { maxRedirects: 0 })).status()).toBe(404);
  const markdown = await request.get("/tools/thread-splitter.md");
  expect(markdown.headers()["x-robots-tag"]).toBe("noindex");
  const html = await request.get("/tools/thread-splitter");
  expect(html.headers()["x-robots-tag"]).toBeUndefined();
  expect(await html.text()).toContain('content="index, follow"');
});
