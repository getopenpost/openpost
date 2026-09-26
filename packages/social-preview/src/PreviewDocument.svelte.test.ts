import { expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import SocialPreview from "./SocialPreview.svelte";
import { createPreviewModel } from "./model";
import documentURL from "./fixtures/two-pages.pdf?url";
import resourceDocumentURL from "./fixtures/cjk-jpeg2000.pdf?url";

const model = (src = documentURL) =>
  createPreviewModel({
    platform: "linkedin",
    format: "document",
    title: "Launch deck",
    media: [{ id: "deck", kind: "document", src, alt: "Launch deck" }],
  });

it("renders the actual PDF pages and lets readers page through the document", async () => {
  const screen = render(SocialPreview, { model: model() });
  const page = screen.getByRole("img", { name: "Document page 1", exact: true });
  await expect.element(page).toBeVisible();
  await expect.element(screen.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      Array.from(
        (page.element().querySelector("canvas") as HTMLCanvasElement)
          .getContext("2d")!
          .getImageData(1, 1, 1, 1).data,
      ),
    )
    .toEqual([255, 0, 0, 255]);
  await screen.getByRole("button", { name: "Next page", exact: true }).click();
  const second = screen.getByRole("img", { name: "Document page 2", exact: true });
  await expect.element(second).toBeVisible();
  await expect
    .poll(() =>
      Array.from(
        (second.element().querySelector("canvas") as HTMLCanvasElement)
          .getContext("2d")!
          .getImageData(1, 1, 1, 1).data,
      ),
    )
    .toEqual([0, 0, 255, 255]);
  await expect
    .element(screen.getByRole("region", { name: "Launch deck" }))
    .toHaveTextContent("Delivery notes");
  await expect
    .element(screen.getByRole("button", { name: "Next page", exact: true }))
    .toBeDisabled();
  await screen.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect.element(page).toBeVisible();
});

it("reports a corrupt PDF and can recover when the attachment is replaced", async () => {
  const broken = URL.createObjectURL(new Blob(["not a PDF"], { type: "application/pdf" }));
  try {
    const screen = render(SocialPreview, { model: model(broken) });
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("The document could not load");
    await screen.rerender({ model: model() });
    await expect
      .element(screen.getByRole("img", { name: "Document page 1", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("1 / 2", { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  } finally {
    URL.revokeObjectURL(broken);
  }
});

it("renders CJK text, standard symbols, and JPEG2000 images from a valid PDF", async () => {
  const screen = render(SocialPreview, { model: model(resourceDocumentURL) });
  const page = screen.getByRole("img", { name: "Document page 1", exact: true });
  await expect.element(page).toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Launch deck" }))
    .toHaveTextContent("日本語");
  await expect
    .poll(() =>
      Array.from(
        (page.element().querySelector("canvas") as HTMLCanvasElement)
          .getContext("2d")!
          .getImageData(1, 1, 1, 1).data,
      ),
    )
    .toEqual([255, 0, 0, 255]);
  const canvas = page.element().querySelector("canvas") as HTMLCanvasElement;
  const symbols = canvas
    .getContext("2d")!
    .getImageData(
      0,
      Math.floor(canvas.height * 0.75),
      canvas.width,
      Math.floor(canvas.height * 0.2),
    );
  expect(Array.from(symbols.data).some((value, index) => index % 4 !== 3 && value < 128)).toBe(
    true,
  );
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});
