import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("developer access resolves authorized workspace names and retains unknown IDs", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `developer-label-${randomUUID()}@example.com`);
  const first = await createWorkspace(request, auth.token, "Audit North");
  const second = await createWorkspace(request, auth.token, "Audit South");
  const missing = randomUUID();
  await authenticatePage(page, auth.token);
  const stamp = "2026-10-01T12:00:00Z";
  const tokens = [first.id, second.id, missing, ""].map((workspace_id, index) => ({
    id: randomUUID(),
    name: `Audit read token ${index}`,
    token_prefix: "synthetic",
    scope: "api:read",
    workspace_id,
    created_at: stamp,
    status: "active",
  }));
  await page.route("**/api/v1/api-tokens", (route) => route.fulfill({ json: tokens }));
  await page.route("**/api/v1/mcp/activity?*", (route) =>
    route.fulfill({
      json: [first.id, second.id, missing].map((workspace_id) => ({
        id: randomUUID(),
        workspace_id,
        tool_name: "list_workspaces",
        status: "success",
        duration_ms: 8,
        created_at: stamp,
      })),
    }),
  );
  const writes: string[] = [];
  page.on("request", (req) => {
    if (/\/api\/v1\/(api-tokens|mcp\/activity)/.test(req.url()) && req.method() !== "GET")
      writes.push(req.method());
  });
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/settings?tab=developer");
      const tokensList = page.getByTestId("api-token-list");
      const activity = page.getByTestId("mcp-activity-list");
      await expect(activity).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`developer-labels-${width}-${scheme}.png`),
        fullPage: true,
      });
      for (const list of [tokensList, activity]) {
        await expect(list.getByText("Audit North", { exact: true })).toBeVisible();
        await expect(list.getByText("Audit South", { exact: true })).toBeVisible();
        await expect(list.getByText(missing, { exact: true })).toBeVisible();
      }
      await expect(tokensList.locator("p").filter({ hasText: "All workspaces" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  expect(writes).toEqual([]);
});
