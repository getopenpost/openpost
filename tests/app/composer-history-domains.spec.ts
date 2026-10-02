import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("composer history identifies the authored fields changed by a text edit", async ({
  page,
  request,
}, testInfo) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(error.message));
  const auth = await registerUser(request, `history-domains-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Revision history");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post("/api/v1/publications", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Audit revision history",
      intent: "post",
      content_profile: "short_text",
      source_text: "Audit initial text",
      segments: [{ body: "Audit initial text" }],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const publication = await created.json();
  const path = `/api/v1/publications/${publication.id}`;
  await authenticatePage(page, auth.token);
  await page.goto(`/publications/${publication.id}?workspace_id=${workspace.id}`);
  let savedPayload: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith(path))
      savedPayload = request.postDataJSON();
  });
  const textbox = page.getByRole("textbox", { name: "Post text", exact: true });
  await textbox.fill("Audit normalized baseline");
  await expect
    .poll(async () => (await (await request.get(path, { headers })).json()).source_text)
    .toBe("Audit normalized baseline");
  await page.reload();
  await expect(textbox).toHaveValue("Audit normalized baseline");
  await textbox.fill("Audit corrected text");
  await expect
    .poll(async () => (await (await request.get(path, { headers })).json()).source_text)
    .toBe("Audit corrected text");
  await page.getByRole("button", { name: "Post settings", exact: true }).click();
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  await expect(page.getByTestId("publication-history-scroll")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("text-edit-history.png") });
  const events = await (await request.get(`${path}/events`, { headers })).json();
  const revisions = events.filter((event: { revision?: number }) => event.revision);
  expect(revisions[0].changed_domains).toEqual(["content"]);
  await page.keyboard.press("Escape");
  const current = await (await request.get(path, { headers })).json();
  expect(savedPayload).toBeDefined();
  const unchanged = await request.put(path, {
    headers,
    data: { ...savedPayload, expected_revision: current.revision },
  });
  expect(unchanged.ok(), await unchanged.text()).toBe(true);
  const unchangedPost = await unchanged.json();
  const unchangedEvents = await (await request.get(`${path}/events`, { headers })).json();
  expect(
    unchangedEvents.find(
      (event: { revision?: number }) => event.revision === unchangedPost.revision,
    ).changed_domains ?? [],
  ).toEqual([]);
  const metadata = { ...unchangedPost.metadata, audit_note: "Own nontext change" };
  const nontext = await request.put(path, {
    headers,
    data: { expected_revision: unchangedPost.revision, metadata },
  });
  expect(nontext.ok(), await nontext.text()).toBe(true);
  const nontextPost = await nontext.json();
  expect(nontextPost.metadata).toEqual(metadata);
  const nontextEvents = await (await request.get(`${path}/events`, { headers })).json();
  expect(
    nontextEvents.find((event: { revision?: number }) => event.revision === nontextPost.revision)
      .changed_domains,
  ).toEqual(["settings"]);
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.reload();
      await expect(textbox).toHaveValue("Audit corrected text");
      await page.getByRole("button", { name: "Post settings", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Version history", exact: true }).click();
      await expect(page.getByTestId("publication-history-scroll")).toBeVisible();
      await expect(page.getByTestId("publication-history-scroll")).toContainText("settings");
      await page.screenshot({ path: testInfo.outputPath(`history-${width}-${scheme}.png`) });
      await page.keyboard.press("Escape");
    }
  }
  expect(clientErrors).toEqual([]);
});
