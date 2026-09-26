import { afterEach, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import SocialPreviewPage from "./SocialPreviewPage.svelte";
import { createPreviewModel } from "./model";

const model = createPreviewModel({
  platform: "x",
  identity: { displayName: "A publisher", handle: "publisher" },
  segments: [
    {
      id: "post",
      text: "The authored post stays visible in an embedded preview.",
    },
  ],
});
let host: HTMLDivElement | undefined;
afterEach(() => host?.remove());

it("uses the preview width for navigation and keeps mobile chrome inside the preview", async () => {
  await page.viewport(1280, 900);
  host = document.createElement("div");
  host.style.width = "320px";
  document.body.append(host);
  await render(SocialPreviewPage, {
    target: host,
    props: { model, scheme: "light" },
  });
  await expect
    .poll(() => host?.querySelector(".micro-left")?.getBoundingClientRect().width)
    .toBe(0);
  const navigation = host.querySelector(".mobile-native-nav")!;
  expect(navigation.getBoundingClientRect().width).toBe(320);
  expect(host.scrollWidth).toBe(320);
  host.style.width = "1200px";
  await expect
    .poll(() => host?.querySelector(".micro-left")?.getBoundingClientRect().width)
    .toBeGreaterThan(100);
  expect(navigation.getBoundingClientRect().width).toBe(0);
});

it("keeps explicit preview colors independent from the host application theme", async () => {
  document.documentElement.classList.add("dark");
  try {
    const screen = await render(SocialPreviewPage, { model, scheme: "light" });
    await expect.element(screen.getByLabelText("X page preview")).toBeVisible();
    expect(
      getComputedStyle(document.querySelector('[data-preview-shell="x"]')!).backgroundColor,
    ).toBe("rgb(255, 255, 255)");
  } finally {
    document.documentElement.classList.remove("dark");
  }
});

it("aligns Facebook stories and feed cards in one desktop column", async () => {
  await page.viewport(1280, 900);
  host = document.createElement("div");
  host.style.width = "1280px";
  document.body.append(host);
  await render(SocialPreviewPage, {
    target: host,
    props: { model: { ...model, platform: "facebook" }, scheme: "dark" },
  });
  const authored = host.querySelector(".facebook-preview")!.getBoundingClientRect();
  for (const selector of [".facebook-stories", ".facebook-composer", ".native-context-post"]) {
    const neighbor = host.querySelector(selector)!.getBoundingClientRect();
    expect(neighbor.left).toBeCloseTo(authored.left);
    expect(neighbor.width).toBeCloseTo(authored.width);
  }
});
