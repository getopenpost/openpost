import type { components } from "@openpost/api-contract";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Cloud conflicts identify this browser and another device without presenting opaque names", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `video-conflict-origin-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Video conflict origins");
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Cloud origin fixture");
  await page.getByRole("textbox", { name: "Project name", exact: true }).press("Tab");
  await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
    "data-state",
    "saved",
  );
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const headers = { Authorization: `Bearer ${auth.token}` };
  const get = await request.get(`/api/v1/video-projects/${id}?workspace_id=${workspace.id}`, {
    headers,
  });
  expect(get.ok()).toBe(true);
  const project = await get.json();
  const revisions = await request.get(
    `/api/v1/video-projects/${id}/revisions?workspace_id=${workspace.id}`,
    { headers },
  );
  expect(revisions.ok()).toBe(true);
  const thisDevice = (await revisions.json())[0].device_id;
  expect(thisDevice).toBeTruthy();
  const otherDevice = randomUUID();
  const change = async (device: string | undefined, description: string) => {
    const data: components["schemas"]["ApplyVideoProjectMutationInputBody"] = {
      workspace_id: workspace.id,
      mutation_id: randomUUID(),
      base_revision: project.head_revision,

      operations: [
        { kind: "set", target: "project:description", path: "/description", value: description },
      ],
    };
    if (device) data.device_id = device;
    const response = await request.post(`/api/v1/video-projects/${id}/mutations`, {
      headers,
      data,
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  expect((await change(thisDevice, "Current saved edit")).outcome).toBe("applied");
  expect((await change(otherDevice, "Other device edit")).outcome).toBe("conflict");
  expect((await change(thisDevice, "This browser edit")).outcome).toBe("conflict");
  expect((await change(undefined, "Unknown origin edit")).outcome).toBe("conflict");
  const snapshotResponse = await request.get(
    `/api/v1/video-projects/${id}/conflicts?workspace_id=${workspace.id}`,
    { headers },
  );
  const snapshot = await snapshotResponse.json();
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Version history", exact: true });
  await expect(history.getByText("Loading...", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("conflict-origin-before-assertion.png") });
  await expect(history.getByText(/^From another browser or device\s*·/)).toBeVisible();
  await expect(history.getByText(/^From this browser\s*·/)).toBeVisible();
  await expect(history.getByText(otherDevice, { exact: true })).toHaveCount(1);
  await expect(
    history.getByText(`Conflicting edit at saved revision ${project.head_revision + 1}`, {
      exact: true,
    }),
  ).toHaveCount(3);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
      .toBe(scheme === "dark");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await history.getByText(/^From another browser or device\s*·/).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`conflict-${width}-${scheme}.png`) });
    }
  }
  const otherRow = history.getByText(/^From another browser or device\s*·/).locator("..");
  await expect(otherRow.getByText(otherDevice, { exact: true })).not.toBeVisible();
  await otherRow.getByText("Details", { exact: true }).first().focus();
  await otherRow.getByText("Details", { exact: true }).first().press("Enter");
  await expect(otherRow.getByText(otherDevice, { exact: true })).toBeVisible();
  await expect(otherRow.getByText("Other device edit", { exact: true })).toBeVisible();
  const after = await request.get(
    `/api/v1/video-projects/${id}/conflicts?workspace_id=${workspace.id}`,
    { headers },
  );
  expect(await after.json()).toEqual(snapshot);
  await page.reload();
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
  await expect(page.getByText(/^From another browser or device\s*·/)).toBeVisible();
  await expect(page.getByText(/^From this browser\s*·/)).toBeVisible();
});
