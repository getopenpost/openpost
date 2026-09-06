import path from "node:path";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Quick Cut saves a source project to OpenPost and opens it again", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `quick-cut-cloud-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Quick Cut Cloud E2E")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);

  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/quick-cut");
  await expect(page.getByRole("button", { name: "Saved to OpenPost" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const chooserPromise = page.waitForEvent("filechooser");
  const cloudCreatePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/v1/video-projects"),
  );
  await page.getByRole("button", { name: "Open videos" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(
    path.join(process.cwd(), "e2e-app/fixtures/product-screenshots/study-sos-demo.mp4"),
  );

  await expect((await cloudCreatePromise).ok()).toBe(true);
  await expect(page.getByRole("status")).toContainText("Saved to OpenPost");
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/video-projects?workspace_id=${workspace.id}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        return response.ok() ? ((await response.json()) as unknown[]).length : -response.status();
      },
      { timeout: 90_000 },
    )
    .toBe(1);

  await page.goto("/quick-cut");
  const savedProject = page.getByRole("listitem").filter({ hasText: "study-sos-demo" });
  await expect(savedProject).toBeVisible();
  await savedProject.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("study-sos-demo.mp4", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole("status")).toContainText("Saved to OpenPost");
});
