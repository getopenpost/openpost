import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("saved destinations finish loading when Social Sets settle before capabilities", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `destinations-loading-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Destination read order");
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','audit-${accountID}','bluesky','${accountID}','auditbuilder',X'00',1);`,
  ]);
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: "Audit destinations read order",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "build",
            kind: "build_draft",
            name: "Audit Builder",
            inputs: {
              text: { literal: "Synthetic internal post" },
              account_ids: { literal: [accountID] },
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const workflow = await created.json();
  await authenticatePage(page, auth.token);
  const setsResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/social-sets",
  );
  await page.route("**/api/v1/capabilities", async (route) => {
    const response = await route.fetch();
    const sets = await setsResponse;
    expect(sets.ok()).toBe(true);
    expect(response.ok()).toBe(true);
    await sets.finished();
    // Deliver the actual capability response after the faster read has rendered.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await route.fulfill({ response });
  });
  await page.goto(`/workflows/${workflow.id}`);
  await page.getByRole("button", { name: /^Audit Builder / }).click();
  const destinations = page.getByRole("group", { name: "Destinations", exact: true });
  await expect(destinations.getByRole("button", { name: /^Accounts:/ })).toBeVisible();
  await expect(destinations.getByRole("status")).toBeHidden();
  await destinations.getByRole("button", { name: /^Accounts:/ }).click();
  await expect(page.getByRole("checkbox", { name: /auditbuilder/ })).toBeChecked();
  await page.keyboard.press("Escape");
});
