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

function previewModel(
  platform: PreviewPlatformKey,
  format: PreviewFormat = "post",
) {
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
  it.each([
    ["x", "post", "Views"],
    ["mastodon", "post", "Boost"],
    ["bluesky", "post", "Repost"],
    ["linkedin", "post", "Comment"],
    ["threads", "post", "Share"],
    ["instagram", "post", "View all 0 comments"],
    ["facebook", "post", "Like"],
    ["youtube", "video", "Subscribe"],
    ["tiktok", "video", "@openpost"],
    ["discord", "post", "APP"],
  ] as const)(
    "renders the native %s %s presentation",
    async (platform, format, expectedText) => {
      const screen = await render(SocialPreview, {
        model: previewModel(platform, format),
      });

      await expect
        .element(
          screen.getByLabelText(`${platformNames[platform]} ${format} preview`),
        )
        .toBeVisible();
      await expect
        .element(screen.getByText(expectedText, { exact: true }))
        .toBeVisible();
    },
  );

  it.each([
    ["instagram", "story", "Instagram story player"],
    ["youtube", "short", "YouTube short player"],
  ] as const)(
    "renders the %s %s in its vertical player",
    async (platform, format, playerLabel) => {
      const screen = await render(SocialPreview, {
        model: previewModel(platform, format),
      });

      await expect.element(screen.getByLabelText(playerLabel)).toBeVisible();
    },
  );

  it("renders Mastodon content warnings", async () => {
    const model = {
      ...previewModel("mastodon"),
      contentWarning: "Product details",
    };
    const screen = await render(SocialPreview, { model });

    await expect.element(screen.getByText("Content warning")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Show more" }))
      .toBeVisible();
  });

  it("renders LinkedIn document details", async () => {
    const model = {
      ...previewModel("linkedin", "document"),
      title: "Launch brief",
    };
    const screen = await render(SocialPreview, { model });

    await expect.element(screen.getByText("Launch brief")).toBeVisible();
    await expect.element(screen.getByText("PDF")).toBeVisible();
  });

  it("renders Discord video attachments", async () => {
    const screen = await render(SocialPreview, {
      model: previewModel("discord", "video"),
    });

    await expect
      .element(screen.getByText("Video preview", { exact: true }))
      .toBeVisible();
  });

  it("fails explicitly for an unsupported provider", async () => {
    const screen = await render(SocialPreview, {
      model: previewModel("unsupported"),
    });

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Preview unavailable");
    await expect
      .element(screen.getByText("Discord post preview"))
      .not.toBeInTheDocument();
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
    await expect
      .element(screen.getByText("First destination post."))
      .toBeVisible();
    await expect
      .element(screen.getByText("Second destination post."))
      .toBeVisible();
  });

  it.each([
    ["mastodon", "post", "What is on your mind?"],
    ["bluesky", "post", "Discover"],
    ["threads", "post", "Start a thread..."],
    ["linkedin", "document", "LinkedIn News"],
    ["facebook", "post", "What’s on your mind?"],
    ["instagram", "post", "Suggested for you"],
    ["youtube", "video", "Subscriptions"],
    ["tiktok", "video", "Suggested accounts"],
    ["discord", "post", "Welcome to #general!"],
  ] as const)(
    "renders the %s destination website around the authored post",
    async (platform, format, chromeText) => {
      const screen = await render(SocialPreviewPage, {
        model: createPreviewModel({
          platform,
          format,
          identity: { displayName: "OpenPost", handle: "openpost" },
          segments: [{ id: "one", text: `Authored ${platform} post.` }],
          title: format === "document" ? "Launch brief" : "Launch video",
        }),
      });

      const shell = screen.getByLabelText(
        `${platformNames[platform]} page preview`,
      );
      await expect
        .element(shell)
        .toHaveAttribute("data-preview-shell", platform);
      await expect.element(shell).toHaveTextContent(chromeText);
      await expect
        .element(shell)
        .toHaveTextContent(`Authored ${platform} post.`);
    },
  );
});
