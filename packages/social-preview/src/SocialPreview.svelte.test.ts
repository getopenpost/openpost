import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import SocialPreview from "./SocialPreview.svelte";
import SocialPreviewPage from "./SocialPreviewPage.svelte";
import {
  createPreviewModel,
  platformNames,
  type PreviewFormat,
  type PreviewPlatformKey,
} from "./model";

function previewModel(platform: PreviewPlatformKey, format: PreviewFormat = "post") {
  return createPreviewModel({
    platform,
    format,
    identity: { displayName: "OpenPost", handle: "openpost" },
    segments: [
      {
        id: "primary",
        text: "Launch update\nShip notes for every social channel.",
      },
    ],
    title: platform === "youtube" ? "Launch update" : undefined,
    subtitle: platform === "youtube" ? "Scheduled video" : undefined,
  });
}

describe("SocialPreview destination presentations", () => {
  // One representative native presentation: per-platform chrome is static
  // markup, so ten copies of "text appears" add browser minutes, not signal.
  it("renders the native post presentation", async () => {
    const screen = await render(SocialPreview, {
      model: previewModel("x", "post"),
    });

    await expect.element(screen.getByLabelText(`${platformNames["x"]} post preview`)).toBeVisible();
    await expect.element(screen.getByText("Views", { exact: true })).toBeVisible();
  });

  it("renders Mastodon content warnings", async () => {
    const model = {
      ...previewModel("mastodon"),
      contentWarning: "Product details",
    };
    const screen = await render(SocialPreview, { model });

    await expect.element(screen.getByText("Content warning")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Show more" })).toBeVisible();
  });

  it("fails explicitly for an unsupported provider", async () => {
    const screen = await render(SocialPreview, {
      model: previewModel("unsupported"),
    });

    await expect.element(screen.getByRole("status")).toHaveTextContent("Preview unavailable");
    await expect.element(screen.getByText("Discord post preview")).not.toBeInTheDocument();
  });
});

describe("SocialPreviewPage destination shells", () => {
  it("renders a complete thread without OpenPost application chrome", async () => {
    const screen = await render(SocialPreviewPage, {
      model: createPreviewModel({
        platform: "x",
        format: "thread",
        identity: { displayName: "OpenPost", handle: "openpost" },
        segments: [
          { id: "one", text: "First destination post." },
          { id: "two", text: "Second destination post." },
        ],
      }),
    });

    const shell = screen.getByLabelText("X page preview");
    await expect.element(shell).toBeVisible();
    await expect.element(shell).toHaveAttribute("data-preview-shell", "x");
    await expect.element(shell).toHaveTextContent("What’s happening?");
    await expect.element(screen.getByText("First destination post.")).toBeVisible();
    await expect.element(screen.getByText("Second destination post.")).toBeVisible();
  });
});
