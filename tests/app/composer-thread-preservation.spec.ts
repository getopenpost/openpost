import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createPublication, createWorkspace, registerUser } from "./helpers";

test("an older open editor cannot delete a reply added by another editor", async ({
  page,
  request,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const auth = await registerUser(request, `thread-preservation-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Thread preservation");
  const original = await createPublication(request, auth.token, workspace.id, "First message");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const path = `/api/v1/publications/${original.id}`;
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${original.id}?workspace_id=${workspace.id}`);
  const editor = page.getByRole("textbox", { name: "Post text", exact: true });
  await expect(editor).toHaveValue("First message");

  const current = await (await request.get(path, { headers })).json();
  const reply = "https://example.com/the-link-in-the-reply";
  const updated = await request.put(path, {
    headers,
    data: {
      expected_revision: current.revision,
      intent: "thread",
      creation_preset: "thread",
      segments: [{ id: current.segments[0].id, body: "First message" }, { body: reply }],
    },
  });
  expect(updated.ok(), await updated.text()).toBeTruthy();

  // The first autosave happens after the detail query's cached revision expires.
  await page.clock.install();
  await page.clock.fastForward(31_000);
  const save = page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === "PUT",
  );
  await editor.fill("First message, edited in the older tab");
  await page.clock.fastForward(2_100);
  const response = await save;
  const persisted = await (await request.get(path, { headers })).json();
  expect(persisted.segments.map((segment: { body: string }) => segment.body)).toEqual([
    "First message",
    reply,
  ]);
  expect(response.status()).toBe(409);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("conflict.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Reload saved draft", exact: true }).click();
  await expect(editor).toHaveCount(2);
  await expect(editor.nth(1)).toHaveValue(reply);
  await editor.nth(0).fill("First message, edited after reloading");
  await page.clock.fastForward(2_100);
  await expect
    .poll(async () => {
      const saved = await (await request.get(path, { headers })).json();
      return saved.segments.map((segment: { body: string }) => segment.body);
    })
    .toEqual(["First message, edited after reloading", reply]);
});

for (const width of [1280, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`a saved thread survives reopening and editing at ${width}px in ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const auth = await registerUser(request, `thread-reopen-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Saved thread");
      const headers = { Authorization: `Bearer ${auth.token}` };
      const created = await request.post("/api/v1/publications", {
        headers,
        data: {
          workspace_id: workspace.id,
          title: "Saved thread",
          source_text: "The main post",
          content_profile: "thread",
          intent: "thread",
          creation_preset: "thread",
          segments: [{ body: "The main post" }, { body: "The link reply https://example.com" }],
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const publication = await created.json();
      const path = `/api/v1/publications/${publication.id}`;
      await authenticatePage(page, auth.token);
      await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
      const editors = page.getByRole("textbox", { name: "Post text", exact: true });
      await expect(editors).toHaveCount(2);
      await expect(editors.nth(1)).toHaveValue("The link reply https://example.com");
      await page.screenshot({ path: testInfo.outputPath("opened.png") });
      await editors.nth(0).fill("The edited main post");
      await expect
        .poll(async () => {
          const saved = await (await request.get(path, { headers })).json();
          return saved.segments.map((segment: { body: string }) => segment.body);
        })
        .toEqual(["The edited main post", "The link reply https://example.com"]);
      await page.reload();
      await expect(editors).toHaveCount(2);
      await expect(editors.nth(0)).toHaveValue("The edited main post");
      await expect(editors.nth(1)).toHaveValue("The link reply https://example.com");
      await page.screenshot({ path: testInfo.outputPath("saved.png") });
      await page.getByRole("button", { name: "Remove post", exact: true }).nth(1).click();
      await expect
        .poll(async () => {
          const saved = await (await request.get(path, { headers })).json();
          return saved.segments.map((segment: { body: string }) => segment.body);
        })
        .toEqual(["The edited main post"]);
      expect(errors).toEqual([]);
    });
  }
}
