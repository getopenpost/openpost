import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import SocialPreview from "./SocialPreview.svelte";
import { createPreviewModel } from "./model";

const image = (id: string) => ({
  id,
  kind: "image" as const,
  src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='500'%3E%3Crect width='400' height='500' fill='teal'/%3E%3C/svg%3E",
  alt: `${id} artwork`,
});

describe("authored content in destination cards", () => {
  it("keeps every Discord attachment visible in a message", async () => {
    const screen = render(SocialPreview, {
      model: createPreviewModel({
        platform: "discord",
        media: [image("First"), image("Second")],
      }),
    });
    await expect.element(screen.getByRole("img", { name: "First artwork" })).toBeVisible();
    await expect.element(screen.getByRole("img", { name: "Second artwork" })).toBeVisible();
  });

  it("keeps LinkedIn multi-image attachments visible", async () => {
    const screen = render(SocialPreview, {
      model: createPreviewModel({
        platform: "linkedin",
        media: [image("First"), image("Second")],
      }),
    });
    await expect.element(screen.getByRole("img", { name: "Second artwork" })).toBeVisible();
  });

  it("lets a reader reveal and hide the actual content warning and post", async () => {
    const screen = render(SocialPreview, {
      model: createPreviewModel({
        platform: "threads",
        contentWarning: "Launch spoilers",
        segments: [{ id: "one", text: "The ending is a surprise." }],
      }),
    });
    await expect.element(screen.getByText("Launch spoilers", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("The ending is a surprise.")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Show more" }).click();
    await expect.element(screen.getByText("The ending is a surprise.")).toBeVisible();
    await screen.getByRole("button", { name: "Hide", exact: true }).click();
    await expect.element(screen.getByText("The ending is a surprise.")).not.toBeInTheDocument();
  });
});

describe("preview reader controls", () => {
  it("changes an Instagram carousel without forcing portrait artwork into a square", async () => {
    const screen = render(SocialPreview, {
      model: createPreviewModel({
        platform: "instagram",
        media: [image("First"), image("Second")],
      }),
    });
    const artwork = screen.getByRole("img", { name: "First artwork" });
    await expect.element(artwork).toBeVisible();
    await expect
      .poll(() => {
        const bounds = artwork.element().getBoundingClientRect();
        return bounds.width / bounds.height;
      })
      .toBeCloseTo(0.8, 1);
    await screen.getByRole("button", { name: "Next media" }).click();
    await expect.element(screen.getByRole("img", { name: "Second artwork" })).toBeVisible();
    await screen.getByRole("button", { name: "Previous media" }).click();
    await expect.element(artwork).toBeVisible();
  });

  it("keeps a thread reply warning independent from its first post", async () => {
    const screen = render(SocialPreview, {
      model: createPreviewModel({
        platform: "mastodon",
        format: "thread",
        segments: [
          { id: "one", text: "Public introduction." },
          {
            id: "two",
            text: "A hidden ending.",
            contentWarning: "Spoilers",
            card: { kind: "link", title: "Read the ending" },
          },
        ],
      }),
    });
    await expect.element(screen.getByText("Public introduction.")).toBeVisible();
    await expect.element(screen.getByText("A hidden ending.")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Show more" }).click();
    await expect.element(screen.getByText("A hidden ending.")).toBeVisible();
    await expect.element(screen.getByText("Read the ending")).toBeVisible();
  });

  it("honors an explicit light card inside a dark application", async () => {
    const host = document.createElement("div");
    host.className = "dark";
    document.body.append(host);
    try {
      const screen = render(SocialPreview, {
        target: host,
        props: { scheme: "light", model: createPreviewModel({ platform: "discord" }) },
      });
      const preview = screen.getByLabelText("Discord post preview");
      await expect.element(preview).toBeVisible();
      expect(getComputedStyle(preview.element().querySelector("article")!).backgroundColor).toBe(
        "rgb(255, 255, 255)",
      );
    } finally {
      host.remove();
    }
  });
});

it("shows offer terms and coupon instead of the standard Business Profile action", async () => {
  const screen = render(SocialPreview, {
    model: createPreviewModel({
      platform: "googlebusiness",
      title: "Autumn offer",
      business: {
        topic: "offer",
        action: "book",
        startDate: "2026-09-26",
        endDate: "2026-10-02",
        couponCode: "AUTUMN",
        terms: "Valid this week.",
      },
    }),
  });
  await expect.element(screen.getByText("AUTUMN", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Valid this week.")).toBeVisible();
  await expect.element(screen.getByText("View offer", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Book", { exact: true })).not.toBeInTheDocument();
});

describe("destination-specific video text", () => {
  it("does not invent an Instagram Story text overlay", async () => {
    const screen = render(SocialPreview, {
      model: createPreviewModel({
        platform: "instagram",
        format: "story",
        segments: [{ id: "one", text: "This is not burned into the image." }],
        media: [image("Story")],
      }),
    });
    await expect
      .element(screen.getByText("This is not burned into the image."))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("img", { name: "Story artwork" })).toBeVisible();
  });

  it.each(["video", "reel"] as const)(
    "shows the destination description for a Facebook %s",
    async (format) => {
      const screen = render(SocialPreview, {
        model: createPreviewModel({
          platform: "facebook",
          format,
          subtitle: "The published video description.",
          segments: [{ id: "one", text: "The source draft text." }],
        }),
      });
      await expect.element(screen.getByText("The published video description.")).toBeVisible();
      await expect.element(screen.getByText("The source draft text.")).not.toBeInTheDocument();
    },
  );

  it("shows the explicit YouTube Short title instead of the source body", async () => {
    const screen = render(SocialPreview, {
      model: createPreviewModel({
        platform: "youtube",
        format: "short",
        title: "The Short title",
        segments: [{ id: "one", text: "The source description." }],
      }),
    });
    await expect.element(screen.getByText("The Short title", { exact: true })).toBeVisible();
  });
});

it.each(["x", "discord"] as const)(
  "does not restore explicitly removed media in %s",
  async (platform) => {
    const screen = render(SocialPreview, {
      model: createPreviewModel({
        platform,
        media: [image("Removed")],
        segments: [{ id: "one", text: "Text only.", media: [] }],
      }),
    });
    await expect.element(screen.getByText("Text only.")).toBeVisible();
    await expect
      .element(screen.getByRole("img", { name: "Removed artwork" }))
      .not.toBeInTheDocument();
  },
);

it("lets readers reach every attachment in a mixed 20-item Threads post", async () => {
  const screen = render(SocialPreview, {
    model: createPreviewModel({
      platform: "threads",
      media: [
        ...Array.from({ length: 19 }, (_, index) => image(`Item ${index + 1}`)),
        {
          id: "last",
          kind: "video",
          src: "data:video/mp4;base64,",
          alt: "Final clip",
          poster: image("Poster").src,
        },
      ],
    }),
  });
  await expect.element(screen.getByRole("img", { name: "Item 1 artwork" })).toBeVisible();
  const next = screen.getByRole("button", { name: "Next media" });
  for (let index = 1; index < 20; index += 1) await next.click();
  await expect.element(screen.getByLabelText("Final clip")).toBeVisible();
  await expect.element(screen.getByText("20/20", { exact: true })).toBeVisible();
  await expect.element(next).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Previous media" }).click();
  await expect.element(screen.getByRole("img", { name: "Item 19 artwork" })).toBeVisible();
});
