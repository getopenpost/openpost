import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("rounded mask keyboard radius stays bounded with fractional authored history", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `mask-radius-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Mask radius");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post("/api/v1/image-editor/designs", {
    headers,
    data: {
      workspace_id: workspace.id,
      title: "Mask radius",
      preset_key: "custom",
      width_px: 1080,
      height_px: 1080,
    },
  });
  expect(created.ok()).toBe(true);
  const design = await created.json();
  const transform = {
    x: 100,
    y: 100,
    width: 381.75,
    height: 214.875,
    rotation: 0,
    flip_x: false,
    flip_y: false,
  };
  design.document.pages[0].layers = [
    {
      id: randomUUID(),
      name: "Radius target",
      type: "shape",
      visible: true,
      locked: false,
      opacity: 1,
      transform,
      shape: { kind: "rectangle", fill: "#f97316", stroke: "#000000", stroke_width: 0, radius: 0 },
      mask: { shape: "rounded_rectangle", radius: 32.25, inset: 0 },
    },
  ];
  expect(
    (
      await request.patch(`/api/v1/image-editor/designs/${design.id}`, {
        headers,
        data: { expected_revision: design.revision, document: design.document },
      })
    ).ok(),
  ).toBe(true);
  const read = async () =>
    (await (await request.get(`/api/v1/image-editor/designs/${design.id}`, { headers })).json())
      .document.pages[0].layers[0];
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/image-editor/${design.id}`);
  await page.getByRole("treeitem", { name: /Radius target/ }).click({ position: { x: 65, y: 12 } });
  await page.getByRole("button", { name: /^Effects/ }).click();
  const radius = page.getByRole("slider", { name: "Mask radius", exact: true });
  await expect(radius).toHaveAttribute("aria-valuenow", "32");
  const accessibleMaximum = Number(await radius.getAttribute("aria-valuemax"));
  expect((await read()).mask.radius).toBe(32.25);
  await radius.focus();
  await radius.press("End");
  await radius.press("ArrowRight");
  const observedRadius = Number(await radius.getAttribute("aria-valuenow"));
  await expect.poll(async () => (await read()).mask.radius).toBe(observedRadius);
  await testInfo.attach("radius-bound.json", {
    body: JSON.stringify({
      accessibleMaximum,
      observedRadius,
      authoredRadius: (await read()).mask.radius,
    }),
    contentType: "application/json",
  });
  expect(Number(await radius.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(accessibleMaximum);
  await expect(radius).toHaveAttribute("aria-valuenow", "107");
  await radius.press("ArrowRight");
  await expect(radius).toHaveAttribute("aria-valuenow", "107");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(radius).toHaveAttribute("aria-valuenow", "32");
  await expect.poll(async () => (await read()).mask.radius).toBe(32.25);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(radius).toHaveAttribute("aria-valuenow", "107");
  await page.screenshot({ path: testInfo.outputPath("bounded-radius.png") });
  await expect.poll(async () => (await read()).mask.radius).toBe(107);
  expect((await read()).transform).toEqual(transform);
  await page.reload();
  await page.getByRole("treeitem", { name: /Radius target/ }).click({ position: { x: 65, y: 12 } });
  await page.getByRole("button", { name: /^Effects/ }).click();
  await expect(radius).toHaveAttribute("aria-valuenow", "107");
  await radius.focus();
  await radius.press("Home");
  await radius.press("ArrowLeft");
  await expect(radius).toHaveAttribute("aria-valuenow", "0");
});
