import { expect, test, type Page } from "@playwright/test";

async function installLocalWorkspacePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        if (!("queryPermission" in prototype)) {
          Object.defineProperty(prototype, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (!("requestPermission" in prototype)) {
          Object.defineProperty(prototype, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
}

async function createProject(page: Page): Promise<string> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Recovery proof");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

async function seedMissingMedia(page: Page, projectId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory();
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      ),
      (character) => character.charCodeAt(0),
    );
    async function directory(path: string[]): Promise<FileSystemDirectoryHandle> {
      let current = root;
      for (const segment of path)
        current = await current.getDirectoryHandle(segment, { create: true });
      return current;
    }
    async function write(path: string[], value: string | Uint8Array): Promise<void> {
      const parent = await directory(path.slice(0, -1));
      const handle = await parent.getFileHandle(path.at(-1)!, { create: true });
      const writable = await handle.createWritable();
      await writable.write(value);
      await writable.close();
    }

    await write(["recovery", "exact", "source.png"], png);
    await write(["recovery", "one", "duplicate.png"], png);
    await write(["recovery", "two", "duplicate.png"], png);

    const metadata = (mediaId: string, fileName: string, sourcePath?: string) => ({
      id: mediaId,
      storageType: "workspace",
      fileName,
      fileSize: png.byteLength,
      sourcePath,
      mimeType: "image/png",
      duration: 0,
      width: 1,
      height: 1,
      fps: 0,
      codec: "",
      bitrate: 0,
      tags: ["image"],
    });
    await write(
      ["media", "exact", "metadata.json"],
      JSON.stringify(metadata("exact", "source.png", "recovery/exact/source.png")),
    );
    await write(
      ["media", "conflict", "metadata.json"],
      JSON.stringify(metadata("conflict", "duplicate.png")),
    );
    await write(
      ["media", "unmatched", "metadata.json"],
      JSON.stringify(metadata("unmatched", "gone.png")),
    );
    await write(
      ["projects", id, "media-links.json"],
      JSON.stringify({
        version: "1.0",
        mediaIds: ["exact", "conflict", "unmatched"].map((mediaId) => ({
          id: mediaId,
          addedAt: Date.now(),
        })),
      }),
    );
  }, projectId);
}

test("Video Editor previews safe folder matches before batch recovery", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: "light" });
  const projectId = await createProject(page);
  await seedMissingMedia(page, projectId);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Restore project media" })).toBeVisible();
  await page.getByRole("button", { name: "Scan folder" }).click();
  await expect(page.getByText("1 ready, 1 need review, 1 not found")).toBeVisible();
  await expect(page.getByText("recovery/exact/source.png", { exact: true })).toBeVisible();
  await expect(page.getByText("recovery/one/duplicate.png", { exact: true })).toBeVisible();
  await expect(page.getByText("recovery/two/duplicate.png", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Relink files (1)" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(false);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.getByRole("button", { name: "Relink files (1)" }).click();
  await expect(page.getByText("Files restored: 1.")).toBeVisible();
  await expect(page.getByText("0 ready, 1 need review, 1 not found")).toBeVisible();
});
