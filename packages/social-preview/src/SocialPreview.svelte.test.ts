import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
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

  it.each([
    "x",
    "discord",
    "telegram",
    "pinterest",
    "googlebusiness",
    "reddit",
    "youtube",
    "tiktok",
  ] as const)(
    "resolves mixed-script post direction in %s without reversing the card",
    async (platform) => {
      const text = "مرحبا OpenPost!";
      const model = createPreviewModel({
        platform,
        identity: { displayName: "Alice", handle: "alice" },
        title: "عنوان OpenPost!",
        segments: [{ id: "primary", text }],
      });
      const screen = await render(SocialPreview, { model });
      const caption = screen.getByText(text, { exact: true }).element();
      expect(getComputedStyle(caption).direction).toBe("rtl");
      expect(
        getComputedStyle(
          screen.getByLabelText(`${platformNames[platform]} ${model.format} preview`).element(),
        ).direction,
      ).toBe("ltr");
    },
  );

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

  it("renders Pixelfed content warnings like Mastodon", async () => {
    const model = {
      ...previewModel("pixelfed"),
      contentWarning: "Product details",
    };
    const screen = await render(SocialPreview, { model });

    await expect.element(screen.getByText("Content warning")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Show more" })).toBeVisible();
  });

  it("renders a PeerTube video with its title", async () => {
    const screen = await render(SocialPreview, {
      model: {
        ...previewModel("peertube", "video"),
        title: "Launch demo",
        subtitle: "Recorded on the release branch.",
      },
    });

    await expect.element(screen.getByLabelText("PeerTube video preview")).toBeVisible();
    await expect.element(screen.getByText("Launch demo")).toBeVisible();
  });

  it("renders a Lemmy community post with its title", async () => {
    const screen = await render(SocialPreview, {
      model: {
        ...previewModel("lemmy"),
        title: "Why I self-host",
        subtitle: "!selfhosted@lemmy.world",
      },
    });

    await expect.element(screen.getByText("Why I self-host")).toBeVisible();
    await expect.element(screen.getByText("!selfhosted@lemmy.world")).toBeVisible();
    await expect.element(screen.getByText("Upvote", { exact: true })).toBeVisible();
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

it("keeps a large carousel position window visible while keyboard navigation reaches every item", async () => {
  const host = document.createElement("div");
  host.style.width = "320px";
  document.body.append(host);
  try {
    const screen = render(SocialPreview, {
      target: host,
      props: {
        model: createPreviewModel({
          platform: "instagram",
          media: Array.from({ length: 35 }, (_, index) => ({
            id: `slide-${index}`,
            kind: "image" as const,
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3C/svg%3E",
            alt: `Slide ${index + 1}`,
          })),
        }),
      },
    });
    const positions = () => [
      ...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Show media"]'),
    ];
    await expect.poll(() => positions().length).toBe(5);
    for (let slide = 1; slide <= 35; slide += 1) {
      await expect
        .element(screen.getByRole("img", { name: `Slide ${slide}`, exact: true }))
        .toBeVisible();
      const dots = positions();
      expect(dots).toHaveLength(5);
      const active = dots.find((dot) => dot.getAttribute("aria-current") === "true")!;
      expect(active.getAttribute("aria-label")).toBe(`Show media ${slide}`);
      const bounds = active.getBoundingClientRect();
      const frame = host.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(frame.left);
      expect(bounds.right).toBeLessThanOrEqual(frame.right);
      if (slide >= 3 && slide <= 33) expect(dots[2]).toBe(active);
      if (slide < 35) {
        screen.getByRole("button", { name: "Next media" }).element().focus();
        await userEvent.keyboard("{Enter}");
      }
    }
    await expect
      .element(screen.getByRole("button", { name: "Next media" }))
      .not.toBeInTheDocument();
    screen.getByRole("button", { name: "Previous media" }).element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("img", { name: "Slide 34", exact: true })).toBeVisible();
  } finally {
    host.remove();
  }
});
