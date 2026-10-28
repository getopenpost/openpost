import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import PreviewAvatar from "./PreviewAvatar.svelte";

const identity = {
  displayName: "Rodrigo Dias",
  handle: "rodrigo",
  avatarUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='42' height='42'%3E%3C/svg%3E",
};

describe("PreviewAvatar", () => {
  it("sends no referrer and lazy-loads the provider avatar", async () => {
    const screen = await render(PreviewAvatar, { identity });
    const img = screen.container.querySelector(".preview-avatar img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("only reveals the photo after a successful load", async () => {
    const screen = await render(PreviewAvatar, { identity });
    const img = screen.container.querySelector(".preview-avatar img") as HTMLImageElement;
    expect(img.classList.contains("ready")).toBe(false);
    expect(getComputedStyle(img).opacity).toBe("0");
    await img.dispatchEvent(new Event("load"));
    await expect
      .poll(() =>
        (
          screen.container.querySelector(".preview-avatar img") as HTMLImageElement
        ).classList.contains("ready"),
      )
      .toBe(true);
    expect(
      getComputedStyle(screen.container.querySelector(".preview-avatar img") as HTMLElement)
        .opacity,
    ).toBe("1");
    expect(screen.container.querySelector(".preview-avatar")?.textContent).toContain("R");
  });

  it("renders the Instagram story ring from the shared avatar implementation", async () => {
    const screen = await render(PreviewAvatar, { identity, ring: true });
    expect(screen.container.querySelector(".preview-avatar-ring")).not.toBeNull();
    expect(screen.container.querySelector(".preview-avatar")).not.toBeNull();
  });
  it("lets a visible primary avatar opt into eager loading", async () => {
    const screen = await render(PreviewAvatar, { identity, loading: "eager" });
    const img = screen.container.querySelector(".preview-avatar img") as HTMLImageElement | null;
    expect(img?.getAttribute("loading")).toBe("eager");
  });

  it("falls back to the monogram when the provider image fails", async () => {
    const screen = await render(PreviewAvatar, {
      identity: { ...identity, avatarUrl: "https://cdn.example.invalid/avatar.png" },
    });
    const img = screen.container.querySelector(".preview-avatar img") as HTMLImageElement;
    expect(img).not.toBeNull();
    await img.dispatchEvent(new Event("error"));
    await expect.poll(() => screen.container.querySelector(".preview-avatar img")).toBeNull();
    expect(screen.container.querySelector(".preview-avatar")?.textContent).toContain("R");
  });

  it("keeps the monogram fallback readable in the dark scheme", async () => {
    const lightHost = document.createElement("div");
    lightHost.style.colorScheme = "light";
    document.body.append(lightHost);
    const darkHost = document.createElement("div");
    darkHost.style.colorScheme = "dark";
    document.body.append(darkHost);
    try {
      const light = await render(PreviewAvatar, {
        target: lightHost,
        props: { identity: { displayName: "Rodrigo Dias", handle: "rodrigo" } },
      });
      const dark = await render(PreviewAvatar, {
        target: darkHost,
        props: { identity: { displayName: "Rodrigo Dias", handle: "rodrigo" } },
      });
      expect(light.container.querySelector(".preview-avatar")?.textContent).toContain("R");
      const lightBg = getComputedStyle(
        light.container.querySelector(".preview-avatar") as HTMLElement,
      ).backgroundColor;
      const darkBg = getComputedStyle(
        dark.container.querySelector(".preview-avatar") as HTMLElement,
      ).backgroundColor;
      expect(lightBg).not.toBe(darkBg);
    } finally {
      lightHost.remove();
      darkHost.remove();
    }
  });
});
