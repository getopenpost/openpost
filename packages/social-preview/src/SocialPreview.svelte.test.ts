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

  it("renders Telegram channel text with image and video attachments", async () => {
    const model = createPreviewModel({
      platform: "telegram",
      identity: { displayName: "OpenPost updates", handle: "openpost" },
      segments: [
        {
          id: "primary",
          text: "The launch is live.",
          media: [
            {
              id: "image",
              kind: "image",
              src: "/launch.png",
              alt: "Launch artwork",
            },
            {
              id: "video",
              kind: "video",
              src: "/launch.mp4",
              alt: "Launch clip",
            },
          ],
        },
      ],
    });
    const screen = await render(SocialPreview, { model });

    await expect.element(screen.getByText("The launch is live.")).toBeVisible();
    await expect.element(screen.getByRole("img", { name: "Launch artwork" })).toBeVisible();
    await expect.element(screen.getByLabelText("Launch clip")).toBeVisible();
  });

  it("shows a Telegram document as a file attachment", async () => {
    const screen = await render(SocialPreview, {
      model: createPreviewModel({
        platform: "telegram",
        segments: [{ id: "primary", text: "Read the guide." }],
        media: [{ id: "guide", kind: "document", src: "/guide.pdf", alt: "Launch guide.pdf" }],
      }),
    });

    await expect.element(screen.getByText("Launch guide.pdf")).toBeVisible();
    await expect.element(screen.getByText("File attachment")).toBeVisible();
    await expect.element(screen.getByText("Read the guide.")).toBeVisible();
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
  it("places a Telegram post inside a channel page", async () => {
    const screen = await render(SocialPreviewPage, {
      model: previewModel("telegram"),
    });

    await expect.element(screen.getByLabelText("Telegram page preview")).toBeVisible();
    await expect
      .element(screen.getByLabelText("Telegram channel message").getByText("Launch update"))
      .toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "OpenPost" })).toBeVisible();
  });

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
