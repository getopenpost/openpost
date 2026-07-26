import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const tinyPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("media library uploads and lists a local media file", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `media-library-${unique}@example.com`;

  const auth = await registerUser(request, email);
  const workspaceBody = await createWorkspace(
    request,
    auth.token,
    "Media Library E2E",
  );

  await authenticatePage(page, auth.token);
  await page.goto("/media");

  await expect(page.getByRole("heading", { name: "Media" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Media sections" }),
  ).toHaveCount(0);
  await expect(page.getByText("No media found")).toBeVisible();

  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "Upload media" }).click();
  await expect(
    page.getByRole("dialog", { name: "Upload Media" }),
  ).toBeVisible();
  await page.locator("#file-upload").setInputFiles({
    name: "launch-card.png",
    mimeType: "image/png",
    buffer: tinyPNG,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload" })
    .click();

  await expect(
    page.getByRole("status").getByText("Uploaded 1 file", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("launch-card.png")).toBeVisible();
  await expect(
    page
      .getByTestId("page-header")
      .getByText(/1 assets · 0 designs · .* stored/, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Studio edits")).toHaveCount(0);

  await page
    .getByRole("button", { name: "Open details for launch-card.png" })
    .click();
  const detailsDialog = page.getByRole("dialog", { name: "launch-card.png" });
  await expect(detailsDialog).toBeVisible();
  await expect(
    detailsDialog.getByRole("img", { name: "launch-card.png" }),
  ).toHaveAttribute("src", /\/media\//);
  await expect(detailsDialog.getByLabel("Alt text")).toBeVisible();
  await detailsDialog.getByRole("button", { name: "Close" }).last().click();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select launch-card.png" }).click();
  await expect(
    page.getByRole("toolbar", { name: "Selected media actions" }),
  ).toContainText("1 selected");

  const media = await request.get(
    `/api/v1/media?workspace_id=${workspaceBody.id}`,
    {
      headers: { Authorization: `Bearer ${auth.token}` },
    },
  );
  expect(media.ok()).toBeTruthy();
  const mediaBody = await media.json();
  expect(mediaBody.total).toBe(1);
  expect(mediaBody.media[0]).toMatchObject({
    original_filename: "launch-card.png",
    mime_type: "image/png",
    usage_count: 0,
    can_delete: true,
    processing_status: "ready",
  });

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const assetCard = page.locator('[data-library-kind="asset"]');
  await assetCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Favorite", exact: true }).click();
  await expect(assetCard.locator("svg.fill-red-500")).toBeVisible();

  await assetCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete media?" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("No media found")).toBeVisible();
});

test("brand kit inputs keep focus while editing", async ({ page, request }) => {
  const unique = Date.now().toString(36);
  const email = `brand-inputs-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Brand Inputs E2E");

  await authenticatePage(page, auth.token);
  await page.goto("/media?view=brand");
  await expect(page).toHaveURL(/\/settings\?tab=brand$/);
  await expect(page.locator('[data-settings-tab="brand"]')).toHaveAttribute(
    "aria-current",
    "page",
  );

  const kitName = page.getByLabel("Brand kit name");
  await expect(kitName).toBeVisible();
  await kitName.fill("");
  await kitName.pressSequentially("Field Notes", { delay: 20 });
  await expect(kitName).toBeFocused();
  await expect(kitName).toHaveValue("Field Notes");

  await page.getByRole("button", { name: "Add color" }).click();
  const colorName = page.getByLabel("Color name");
  await colorName.fill("");
  await colorName.pressSequentially("Signal orange", { delay: 20 });
  await expect(colorName).toBeFocused();
  await expect(colorName).toHaveValue("Signal orange");

  await page.getByRole("button", { name: "Add style" }).click();
  await page.getByText("Text style 1", { exact: true }).click();
  const styleName = page.getByLabel("Style name");
  await styleName.fill("");
  await styleName.pressSequentially("Campaign heading", { delay: 20 });
  await expect(styleName).toBeFocused();
  await expect(styleName).toHaveValue("Campaign heading");

  const fontFamily = page.getByLabel("Font family");
  await fontFamily.click();
  const fontSearch = page.getByLabel("Search fonts");
  await fontSearch.fill("");
  await fontSearch.pressSequentially("Geist Variable", { delay: 20 });
  await expect(fontSearch).toBeFocused();
  await expect(fontSearch).toHaveValue("Geist Variable");
  await page
    .getByRole("button", { name: "Geist Variable", exact: true })
    .click();
  await expect(fontFamily).toContainText("Geist Variable");
});
