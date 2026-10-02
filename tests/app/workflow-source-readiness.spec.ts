import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("feed source explains invalid URLs before activation and recovers with keyboard correction", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  const auth = await registerUser(request, `source-readiness-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Source readiness");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit feed readiness",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "rss", url: "not a url" },
        steps: [
          {
            id: "parse",
            name: "Audit inert parse",
            kind: "parse_json",
            inputs: { text: { literal: "{}" } },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const workflow = await created.json();
  const errors: string[] = [];
  let effects = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(publish|run|test-node)(?:\?|$)/.test(request.url()))
      effects++;
  });
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const source = page.locator('.svelte-flow__node[data-id="source"]');
      await source.getByRole("button", { name: /^RSS or Atom item / }).click();
      const feed = page.getByRole("textbox", { name: "Feed URL", exact: true });
      await feed.fill("not a url");
      await expect(feed).toHaveAttribute("aria-invalid", "true");
      await expect(feed).toHaveAccessibleDescription(
        "Enter an HTTP or HTTPS URL without credentials.",
      );
      await page.screenshot({ path: testInfo.outputPath(`invalid-feed-${width}-${scheme}.png`) });
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await expect(source).toContainText("Needs attention");
      await source.getByRole("button", { name: /^RSS or Atom item / }).click();
      for (const invalid of [
        "ftp://example.com/feed",
        "https://user:password@example.com/feed",
        "https://@example.com/feed",
        "http:example.com/feed",
      ]) {
        await feed.fill(invalid);
        await expect(feed).toHaveAttribute("aria-invalid", "true");
      }
      await feed.fill("");
      await expect(feed).toHaveAccessibleDescription("This field is required.");
      await feed.focus();
      await page.keyboard.type("https://example.com/feed.xml");
      await page.keyboard.press("Tab");
      await expect(feed).toHaveAttribute("aria-invalid", "false");
      await expect(page.locator("#workflow-feed-error")).toBeHidden();
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await expect(source).not.toContainText("Needs attention");
      await expect
        .poll(
          async () =>
            (
              await (
                await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
                  headers,
                })
              ).json()
            ).definition.source.url,
        )
        .toBe("https://example.com/feed.xml");
      await page.reload();
    }
  const source = page.locator('.svelte-flow__node[data-id="source"]');
  await source.getByRole("button", { name: /^RSS or Atom item / }).click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("option", { name: "Run manually", exact: true }).click();
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
              headers,
            })
          ).json()
        ).definition.source.kind,
    )
    .toBe("manual");
  const saved = await (
    await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, { headers })
  ).json();
  expect(saved.enabled).toBe(false);
  expect(saved.published_revision).toBe(0);
  expect(saved.definition.steps).toEqual([
    {
      id: "parse",
      name: "Audit inert parse",
      kind: "parse_json",
      inputs: { text: { literal: "{}" } },
    },
  ]);
  expect(
    await (
      await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
    ).json(),
  ).toEqual([]);
  expect(effects).toBe(0);
  expect(errors).toEqual([]);
});
