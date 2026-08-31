import { expect, test, type APIRequestContext } from "@playwright/test";
import { createPublication, createWorkspace, registerUser } from "./helpers";

async function callMCP(
  request: APIRequestContext,
  token: string,
  id: string,
  method: string,
  params?: Record<string, unknown>,
) {
  const response = await request.post("/mcp", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    error?: unknown;
    result?: Record<string, unknown>;
  };
  expect(payload.error).toBeUndefined();
  expect(payload.result).toBeDefined();
  if (!payload.result) throw new Error(`MCP ${method} response did not contain a result`);
  return payload.result;
}

test("scheduler widget renders canonical list_publications results", async ({ page, request }) => {
  const unique = Date.now().toString(36);
  const title = `Widget publication ${unique}`;
  const auth = await registerUser(request, `mcp-widget-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "MCP Widget E2E");
  await createPublication(request, auth.token, workspace.id, title);

  const tokenResponse = await request.post("/api/v1/api-tokens", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: "MCP Widget E2E",
      scope: "mcp:read",
      workspace_id: workspace.id,
    },
  });
  expect(tokenResponse.ok()).toBeTruthy();
  const mcpToken = ((await tokenResponse.json()) as { token: string }).token;
  expect(mcpToken).toBeTruthy();

  const listed = await callMCP(request, mcpToken, "list-publications", "tools/call", {
    name: "query_operation",
    arguments: {
      operation: "list_publications",
      arguments: { workspace_id: workspace.id },
    },
  });
  const publicationData = listed.structuredContent as Record<string, unknown>;

  const rendered = await callMCP(request, mcpToken, "render-publications", "tools/call", {
    name: "render_scheduler_widget",
    arguments: {
      title: "Queue review",
      workspace_id: workspace.id,
      data: publicationData,
    },
  });
  const widgetOutput = rendered.structuredContent as Record<string, unknown>;
  expect(widgetOutput.view).toBe("publications");
  expect(widgetOutput.data).toEqual(publicationData);

  const resource = await callMCP(request, mcpToken, "widget-resource", "resources/read", {
    uri: "ui://widget/openpost-scheduler-v1.html",
  });
  const contents = resource.contents as Array<{ text: string }>;
  expect(contents).toHaveLength(1);
  await page.setContent(contents[0].text);
  await page.evaluate((structuredContent) => {
    window.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { structuredContent },
      },
      "*",
    );
  }, widgetOutput);

  await expect(page.getByRole("heading", { name: "Queue review" })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText("draft", { exact: true })).toBeVisible();
});
