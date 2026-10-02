import { expect, test, type Page } from "@playwright/test";

async function savedAuthoredProject(page: Page, projectURL: string) {
  const id = new URL(projectURL).pathname.split("/").at(-1)!;
  return page.evaluate(async (projectId) => {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle("projects");
    const project = await projects.getDirectoryHandle(projectId);
    const file = await project.getFileHandle("project.json");
    const document = JSON.parse(await (await file.getFile()).text());
    return { timeline: document.timeline, metadata: document.metadata };
  }, id);
}

test("an explicit recording handoff reveals persisted main-sequence media from remembered Motion", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [],
    });
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const root = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(root);
        for (const method of ["queryPermission", "requestPermission"])
          if (!(method in prototype))
            Object.defineProperty(prototype, method, {
              configurable: true,
              value: async () => "granted",
            });
        return root;
      },
    });
  });
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder", exact: true }).click();
  await page.getByRole("button", { name: "Custom project", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Synthetic recording handoff");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  const ordinaryURL = page.url();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "red";
    context.fillRect(0, 0, 160, 90);
    const stream = canvas.captureStream(30);
    const recording = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recording.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const finished = new Promise<void>((resolve) => {
      recording.onstop = () => resolve();
    });
    recording.start();
    const drawing = setInterval(() => context.fillRect(0, 0, 160, 90), 33);
    await new Promise((resolve) => setTimeout(resolve, 350));
    recording.stop();
    await finished;
    clearInterval(drawing);
    stream.getTracks().forEach((track) => track.stop());
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("fixture-sources", { create: true });
    const handle = await directory.getFileHandle("synthetic-recording.webm", { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Blob(chunks, { type: "video/webm" }));
    await writable.close();
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [handle],
    });
  });
  await page.getByRole("button", { name: "Import media", exact: true }).click();
  await page
    .getByRole("button", { name: "Place on timeline: synthetic-recording.webm", exact: true })
    .click();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("banner").getByRole("status")).toHaveAttribute("data-state", "saved");
  const authored = await savedAuthoredProject(page, ordinaryURL);
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "New composition", exact: true })).toBeVisible();
  await page.goto(`${ordinaryURL}?workspace=edit`);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("tab", { name: "Edit", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(await savedAuthoredProject(page, ordinaryURL)).toEqual(authored);
  await page.screenshot({ path: testInfo.outputPath("recording-visible-edit.png") });
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await page.goto(ordinaryURL);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "New composition", exact: true })).toBeVisible();
});
