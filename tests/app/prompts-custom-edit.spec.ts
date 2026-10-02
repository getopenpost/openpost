import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("custom prompt corrections persist without authoring a post", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `prompt-edit-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Custom prompt editing");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const categoriesResult = await request.get("/api/v1/prompts/categories", { headers });
  expect(categoriesResult.ok()).toBe(true);
  const { categories } = await categoriesResult.json();
  const created = await request.post("/api/v1/prompts", {
    headers,
    data: {
      workspace_id: workspace.id,
      text: "Audit original typo",
      example: "Audit original example",
      category: categories[0],
    },
  });
  expect(created.ok()).toBe(true);
  let stored = await created.json();
  const originalID = stored.id;
  const originalCreatedAt = stored.created_at;
  const errors: string[] = [];
  let injectedFailure = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const expectedFailure =
      injectedFailure &&
      message.location().url.endsWith(`/api/v1/prompts/${originalID}`) &&
      message.text().includes("503 (Service Unavailable)");
    if (!expectedFailure) errors.push(message.text());
  });
  await authenticatePage(page, auth.token);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/prompts");
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      const card = page.getByRole("article").filter({ hasText: stored.text });
      await expect(card).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`card-${width}-${scheme}.png`) });
      const edit = card.getByRole("button", { name: "Edit prompt", exact: true });
      await expect(edit).toBeVisible();
      await edit.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Edit prompt", exact: true });
      await expect(dialog.getByRole("textbox", { name: "Prompt text", exact: true })).toHaveValue(
        stored.text,
      );
      await expect(dialog.getByRole("textbox", { name: "Example post", exact: true })).toHaveValue(
        stored.example,
      );
      await dialog.getByRole("textbox", { name: "Prompt text", exact: true }).fill("   ");
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(edit).toBeFocused();
      await edit.click();
      const text = `Audit correction ${width} ${scheme}: Café 👋\nمرحبا بالعالم`;
      const example = `Audit example ${width} ${scheme}\nSecond line with "quotes".`;
      const category = categories[1];
      await dialog.getByRole("textbox", { name: "Prompt text", exact: true }).fill(text);
      await dialog.getByRole("textbox", { name: "Example post", exact: true }).fill(example);
      await dialog.getByRole("button", { name: "Category", exact: true }).click();
      await page.getByRole("option", { name: category, exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`edit-${width}-${scheme}.png`) });
      if (width === 1280 && scheme === "light") {
        const updateURL = `**/api/v1/prompts/${originalID}`;
        await page.route(updateURL, async (route) => {
          injectedFailure = true;
          await route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({
              title: "Service Unavailable",
              status: 503,
              detail: "Audit save failed",
            }),
          });
        });
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByText("Audit save failed", { exact: true })).toBeVisible();
        await expect(dialog.getByRole("textbox", { name: "Prompt text", exact: true })).toHaveValue(
          text,
        );
        await expect(
          dialog.getByRole("textbox", { name: "Example post", exact: true }),
        ).toHaveValue(example);
        await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
        const unchanged = await (
          await request.get(`/api/v1/prompts?workspace_id=${workspace.id}`, { headers })
        ).json();
        expect(unchanged.find((prompt: { id: string }) => prompt.id === originalID)).toMatchObject({
          id: originalID,
          text: stored.text,
          example: stored.example,
          category: stored.category,
        });
        await page.screenshot({ path: testInfo.outputPath("save-error-recovery.png") });
        await page.unroute(updateURL);
      }
      const saved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/v1/prompts/${originalID}` &&
          response.request().method() === "PUT",
      );
      await dialog.getByRole("button", { name: "Save", exact: true }).focus();
      await page.keyboard.press("Enter");
      expect((await saved).ok()).toBe(true);
      await expect(dialog).toHaveCount(0);
      const list = await request.get(`/api/v1/prompts?workspace_id=${workspace.id}`, { headers });
      expect(list.ok()).toBe(true);
      const custom = (await list.json()).filter(
        (prompt: { is_built_in: boolean }) => !prompt.is_built_in,
      );
      expect(custom).toHaveLength(1);
      stored = custom[0];
      expect(stored).toMatchObject({
        id: originalID,
        created_at: originalCreatedAt,
        text,
        example,
        category,
      });
      expect(
        await (
          await request.get(`/api/v1/publications?workspace_id=${workspace.id}`, { headers })
        ).json(),
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  }
  await page.reload();
  const finalCard = page.getByRole("article").filter({ hasText: stored.text });
  await expect(finalCard).toBeVisible();
  await finalCard.getByRole("button", { name: "Edit prompt", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit prompt", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Example post", exact: true })).toHaveValue(
    stored.example,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("public custom-prompt update preserves identity and rejects other actors and built-ins", async ({
  request,
}) => {
  const owner = await registerUser(request, `prompt-owner-${randomUUID()}@example.com`);
  const other = await registerUser(request, `prompt-other-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, owner.token, "Prompt update owner");
  const otherWorkspace = await createWorkspace(request, other.token, "Prompt update other");
  const ownerHeaders = { Authorization: `Bearer ${owner.token}` };
  const otherHeaders = { Authorization: `Bearer ${other.token}` };
  const create = await request.post("/api/v1/prompts", {
    headers: ownerHeaders,
    data: {
      workspace_id: workspace.id,
      text: "Original prompt",
      example: "Original example",
      category: "Developer",
    },
  });
  expect(create.ok()).toBe(true);
  const originalResponse = await create.json();
  const { $schema: _schema, ...original } = originalResponse;
  const correction = { text: "Corrected Café 👋\nمرحبا", example: "", category: "Business" };
  const update = await request.put(`/api/v1/prompts/${original.id}`, {
    headers: ownerHeaders,
    data: correction,
  });
  expect(update.status()).toBe(200);
  expect(await update.json()).toEqual({ ...originalResponse, ...correction });
  const listURL = `/api/v1/prompts?workspace_id=${workspace.id}`;
  const listed = await (await request.get(listURL, { headers: ownerHeaders })).json();
  expect(listed.find((prompt: { id: string }) => prompt.id === original.id)).toEqual({
    ...original,
    ...correction,
  });
  const forbidden = await request.put(`/api/v1/prompts/${original.id}`, {
    headers: otherHeaders,
    data: { ...correction, text: "Wrong actor" },
  });
  expect(forbidden.status()).toBe(403);
  const invalid = await request.put(`/api/v1/prompts/${original.id}`, {
    headers: ownerHeaders,
    data: { ...correction, text: "   " },
  });
  expect(invalid.status()).toBe(400);
  const builtin = listed.find((prompt: { is_built_in: boolean }) => prompt.is_built_in);
  expect(builtin).toBeDefined();
  const protectedBuiltin = await request.put(`/api/v1/prompts/${builtin.id}`, {
    headers: ownerHeaders,
    data: correction,
  });
  expect(protectedBuiltin.status()).toBe(400);
  const foreignCreate = await request.post("/api/v1/prompts", {
    headers: otherHeaders,
    data: {
      workspace_id: otherWorkspace.id,
      text: "Foreign prompt",
      example: "",
      category: "Developer",
    },
  });
  expect(foreignCreate.ok()).toBe(true);
  const { $schema: _foreignSchema, ...foreign } = await foreignCreate.json();
  const crossWorkspace = await request.put(`/api/v1/prompts/${foreign.id}`, {
    headers: ownerHeaders,
    data: correction,
  });
  expect(crossWorkspace.status()).toBe(403);
  const after = await (await request.get(listURL, { headers: ownerHeaders })).json();
  expect(after.find((prompt: { id: string }) => prompt.id === original.id)).toEqual({
    ...original,
    ...correction,
  });
  expect(after.find((prompt: { id: string }) => prompt.id === builtin.id)).toEqual(builtin);
  const foreignAfter = await (
    await request.get(`/api/v1/prompts?workspace_id=${otherWorkspace.id}`, {
      headers: otherHeaders,
    })
  ).json();
  expect(foreignAfter.find((prompt: { id: string }) => prompt.id === foreign.id)).toEqual(foreign);
});
