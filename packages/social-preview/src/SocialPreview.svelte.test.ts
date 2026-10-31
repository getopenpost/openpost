import { createRawSnippet } from "svelte";
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
        media: [
          {
            id: "guide",
            kind: "document",
            src: "/guide.pdf",
            alt: "Launch guide.pdf",
          },
        ],
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

  it("renders the Reddit card with its community label and vote pill", async () => {
    const screen = await render(SocialPreview, {
      model: createPreviewModel({
        platform: "reddit",
        identity: { displayName: "alice", handle: "alice" },
        subtitle: "openpost",
        title: "Launch week recap",
        segments: [{ id: "primary", text: "" }],
      }),
    });

    await expect.element(screen.getByText("r/openpost")).toBeVisible();
    await expect.element(screen.getByText("u/alice · Now")).toBeVisible();
    await expect.element(screen.getByText("Upvote", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Downvote", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Share", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Save", { exact: true })).toBeVisible();
    const pill = document.querySelector(".community-actions .vote-pill");
    expect(pill?.textContent).toContain("0");
  });

  it("orders the Lemmy created line and action bar like the real feed card", async () => {
    const screen = await render(SocialPreview, {
      model: createPreviewModel({
        platform: "lemmy",
        identity: { displayName: "alice", handle: "alice" },
        subtitle: "!selfhosted@lemmy.world",
        title: "Why I self-host",
        segments: [{ id: "primary", text: "" }],
      }),
    });

    await expect.element(screen.getByText("!selfhosted@lemmy.world")).toBeVisible();
    const header = document.querySelector(".platform-lemmy header");
    expect(header?.lastElementChild?.classList.contains("published-time")).toBe(true);
    const comments = document.querySelector('.platform-lemmy .action[title="Comments"]');
    const pill = document.querySelector(".platform-lemmy .vote-pill");
    expect(pill?.textContent).toContain("0");
    expect(pill?.textContent).toContain("Upvote");
    // The real card lists the comment count before the vote group.
    expect(
      comments?.compareDocumentPosition(pill as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places the Pin image beside its details on wide containers", async () => {
    const host = document.createElement("div");
    host.style.width = "800px";
    document.body.append(host);
    try {
      const screen = render(SocialPreview, {
        target: host,
        props: {
          model: createPreviewModel({
            platform: "pinterest",
            identity: { displayName: "Studio", handle: "studio" },
            title: "Launch checklist",
            segments: [{ id: "primary", text: "Notes from the launch." }],
          }),
        },
      });
      await expect.element(screen.getByText("Save", { exact: true })).toBeVisible();
      await expect.element(screen.getByText("Follow")).toBeVisible();
      await expect.element(screen.getByText("0 Comments")).toBeVisible();
      const image = host.querySelector<HTMLElement>(".pin-image")?.getBoundingClientRect();
      const details = host.querySelector<HTMLElement>(".pin-details")?.getBoundingClientRect();
      expect(image?.right).toBeLessThanOrEqual((details?.left ?? 0) + 2);
    } finally {
      host.remove();
    }
  });

  it("stacks the Pin image above its details on narrow containers", async () => {
    const host = document.createElement("div");
    host.style.width = "320px";
    document.body.append(host);
    try {
      render(SocialPreview, {
        target: host,
        props: {
          model: createPreviewModel({
            platform: "pinterest",
            identity: { displayName: "Studio", handle: "studio" },
            title: "Launch checklist",
            segments: [{ id: "primary", text: "Notes from the launch." }],
          }),
        },
      });
      const image = host.querySelector<HTMLElement>(".pin-image")?.getBoundingClientRect();
      const details = host.querySelector<HTMLElement>(".pin-details")?.getBoundingClientRect();
      expect(image?.bottom).toBeLessThanOrEqual((details?.top ?? 0) + 2);
    } finally {
      host.remove();
    }
  });

  it("marks TikTok photo slides with dots instead of the video progress bar", async () => {
    const host = document.createElement("div");
    host.style.width = "360px";
    document.body.append(host);
    try {
      const media = [1, 2, 3].map((index) => ({
        id: `slide-${index}`,
        kind: "image" as const,
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3C/svg%3E",
        alt: `Slide ${index}`,
      }));
      const screen = render(SocialPreview, {
        target: host,
        props: {
          model: createPreviewModel({
            platform: "tiktok",
            format: "photo",
            segments: [{ id: "primary", text: "Photo caption" }],
            media,
          }),
        },
      });
      expect([...host.querySelectorAll(".photo-dots span")]).toHaveLength(3);
      expect(host.querySelector(".player-progress")).toBeNull();
      expect(host.querySelector(".photo-dots span")?.getAttribute("class")).toContain("active");
      await screen.getByRole("button", { name: "Next media" }).click();
      expect(host.querySelectorAll(".photo-dots span")[1]?.getAttribute("class")).toContain(
        "active",
      );
    } finally {
      host.remove();
    }
  });

  it("renders the PeerTube watch card with labeled actions and no comments yet", async () => {
    const screen = await render(SocialPreview, {
      model: createPreviewModel({
        platform: "peertube",
        format: "video",
        identity: { displayName: "Framasoft", handle: "framasoft" },
        title: "Launch demo",
        subtitle: "Recorded on the release branch.",
        segments: [{ id: "primary", text: "" }],
      }),
    });

    await expect.element(screen.getByText("Launch demo")).toBeVisible();
    await expect.element(screen.getByText("Now • 0 views")).toBeVisible();
    await expect.element(screen.getByText("By framasoft")).toBeVisible();
    await expect.element(screen.getByText("Support", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Share", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Download", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("No comments.")).toBeVisible();
  });

  it("shows the Telegram channel view count beside the message time", async () => {
    const screen = await render(SocialPreview, {
      model: createPreviewModel({
        platform: "telegram",
        segments: [{ id: "primary", text: "The launch is live." }],
      }),
    });

    const footer = document.querySelector(".telegram-preview footer");
    expect(footer?.textContent).toContain("0");
    expect(Boolean(footer?.querySelector("svg"))).toBe(true);
    await expect.element(screen.getByText("The launch is live.")).toBeVisible();
  });

  it("names dev/null commits with a stable hash chip and git actions", async () => {
    const commitModel = () =>
      createPreviewModel({
        platform: "devnull",
        identity: { displayName: "Alice", handle: "alice" },
        segments: [{ id: "primary", text: "Commit body for the preview." }],
      });
    const first = await render(SocialPreview, { model: commitModel() });
    await expect.element(first.getByText("Star", { exact: true })).toBeVisible();
    await expect.element(first.getByText("Quote", { exact: true })).toBeVisible();
    await expect.element(first.getByText("Reply", { exact: true })).toBeVisible();
    const chips = [...document.querySelectorAll(".platform-devnull .commit-hash")];
    expect(chips.length).toBe(1);
    expect(chips[0].textContent ?? "").toMatch(/^[0-9a-f]{7}$/u);
    expect(chips[0].getAttribute("title")).toBe(`Commit ${chips[0].textContent}`);
    // The same text always names the same commit.
    await render(SocialPreview, { model: commitModel() });
    const next = [...document.querySelectorAll(".platform-devnull .commit-hash")];
    expect(next.length).toBe(2);
    expect(next[1].textContent).toBe(chips[0].textContent);
  });

  it("orders the Pixelfed caption before its actions and shows the handle", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    try {
      const screen = render(SocialPreview, {
        target: host,
        props: {
          model: createPreviewModel({
            platform: "pixelfed",
            identity: { displayName: "Studio", handle: "studio" },
            segments: [{ id: "primary", text: "Photo caption text." }],
          }),
        },
      });
      await expect.element(screen.getByText("Photo caption text.")).toBeVisible();
      expect(host.querySelector(".platform-pixelfed .identity strong")?.textContent).toBe("studio");
      const caption = host.querySelector(".caption");
      const actions = host.querySelector(".post-actions");
      expect(
        caption?.compareDocumentPosition(actions as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      host.remove();
    }
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

describe("native caption editing slots", () => {
  it.each([
    "x",
    "bluesky",
    "mastodon",
    "threads",
    "linkedin",
    "facebook",
    "instagram",
    "pixelfed",
    "youtube",
    "peertube",
    "tiktok",
    "discord",
    "telegram",
    "pinterest",
    "googlebusiness",
    "lemmy",
    "piefed",
    "reddit",
    "unsupported",
  ] as const)("places the editor inside the %s presentation", async (platform) => {
    const text = "An editable account caption.";
    const model = createPreviewModel({
      platform,
      identity: { displayName: "Alice", handle: "alice" },
      segments: [{ id: "source", text }],
      title: platform === "youtube" ? "Video title" : undefined,
    });
    const editor = {
      text: createRawSnippet<[import("./model").PreviewSegment]>((segment) => ({
        render: () => `<textarea aria-label="Account caption">${segment().text}</textarea>`,
      })),
    };
    const screen = await render(SocialPreview, { model, editor });
    const input = screen.getByRole("textbox", {
      name: "Account caption",
      exact: true,
    });
    await expect.element(input).toBeVisible();
    await expect.element(input).toHaveValue(text);
    await input.fill("Changed here.");
    await expect.element(input).toHaveValue("Changed here.");
  });
});
