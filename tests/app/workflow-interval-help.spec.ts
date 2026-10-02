import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("schedule source shows interval guidance once and keeps range correction", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `interval-guidance-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Interval guidance");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit interval guidance",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "interval", interval_minutes: 1440 },
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
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  await page
    .locator('.svelte-flow__node[data-id="source"]')
    .getByRole("button", { name: /^On a schedule / })
    .click();
  const help = page.getByText(
    "Start at a regular interval, from every 5 minutes to every 30 days.",
    { exact: true },
  );
  await expect(help).toHaveCount(1);
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(help).toHaveCount(1);
      const minutes = page.getByRole("spinbutton", { name: "Every (minutes)", exact: true });
      await minutes.fill("1");
      await expect(minutes).toHaveAttribute("aria-invalid", "true");
      await minutes.fill("5");
      await minutes.press("Tab");
      await expect(minutes).toHaveAttribute("aria-invalid", "false");
      await page.screenshot({ path: testInfo.outputPath(`interval-${width}-${scheme}.png`) });
    }
});
