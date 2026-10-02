import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

function silentWave() {
  const samples = 800;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

test("Ordinary Media copies preserve origin and show copy provenance across MIME types", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `media-copy-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Independent Media copies");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const files = [
    {
      name: "source.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=",
        "base64",
      ),
    },
    {
      name: "source.mp4",
      mimeType: "video/mp4",
      buffer: await readFile("tests/app/fixtures/product-screenshots/study-sos-demo.mp4"),
    },
    { name: "source.wav", mimeType: "audio/wav", buffer: silentWave() },
  ];
  const originals = [];
  for (const file of files) {
    const response = await request.post("/api/v1/media/upload", {
      headers,
      multipart: { workspace_id: workspace.id, file },
    });
    expect(response.ok(), await response.text()).toBe(true);
    originals.push(await response.json());
  }
  const list = async (source?: string) => {
    const response = await request.get(
      `/api/v1/media?workspace_id=${workspace.id}${source ? `&source=${source}` : ""}`,
      { headers },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).media as Array<{
      id: string;
      parent_media_id: string;
      source: string;
      mime_type: string;
      original_filename: string;
    }>;
  };
  await authenticatePage(page, auth.token);
  await page.goto("/media");
  for (const [index, file] of files.entries()) {
    await page.getByRole("button", { name: `Open details for ${file.name}`, exact: true }).click();
    const inspector = page.getByRole("dialog", { name: file.name, exact: true });
    await inspector.getByRole("button", { name: "Duplicate", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await list()).find((item) => item.parent_media_id === originals[index].id)?.source,
      )
      .toBe("media_copy");
    await page.keyboard.press("Escape");
    await expect(inspector).toBeHidden();
    await page.reload();
    await page
      .getByRole("button", { name: `Open details for copy-${file.name}`, exact: true })
      .click();
    const copy = page.getByRole("dialog", { name: `copy-${file.name}`, exact: true });
    await expect(copy.getByText("Copies", { exact: true })).toBeVisible();
    const rows = await list();
    const stored = rows.find((item) => item.parent_media_id === originals[index].id)!;
    expect(stored.id).not.toBe(originals[index].id);
    expect(stored.mime_type).toBe(originals[index].mime_type);
    expect(rows.find((item) => item.id === originals[index].id)?.source).toBe("upload");
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`copy-${file.name}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(copy).toBeHidden();
  }
  expect(await list("media_copy")).toHaveLength(3);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filters", exact: true });
  await filters.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("option", { name: "Copies", exact: true }).click();
  await filters.getByRole("button", { name: "Apply filters", exact: true }).click();
  for (const file of files) {
    await expect(
      page.getByRole("button", { name: `Open details for copy-${file.name}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Open details for ${file.name}`, exact: true }),
    ).toBeHidden();
  }
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("copies-filter.png") });
});
