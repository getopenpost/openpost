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

it("shows the verified badge in the page chrome when verified is set", async () => {
  await page.viewport(1280, 900);
  host = document.createElement("div");
  host.style.width = "1200px";
  document.body.append(host);
  const verifiedModel = createPreviewModel({
    platform: "x",
    identity: { displayName: "A publisher", handle: "publisher", verified: true },
    segments: [
      {
        id: "post",
        text: "The authored post stays visible in an embedded preview.",
      },
    ],
  });
  await render(SocialPreviewPage, {
    target: host,
    props: { model: verifiedModel, scheme: "light" },
  });
  const railBadge = host.querySelector(".rail-profile [aria-label='Verified']");
  expect(railBadge).not.toBeNull();
});

it("shows no verified badge in the page chrome when verified is unset", async () => {
  await page.viewport(1280, 900);
  host = document.createElement("div");
  host.style.width = "1200px";
  document.body.append(host);
  await render(SocialPreviewPage, {
    target: host,
    props: { model, scheme: "light" },
  });
  expect(host.querySelector(".rail-profile [aria-label='Verified']")).toBeNull();
  expect(host.querySelector("[aria-label='Verified']")).toBeNull();
});

it("shows related Pins beside the closeup and the Other videos rail beside the watch card", async () => {
  await page.viewport(1280, 900);
  const pinHost = document.createElement("div");
  pinHost.style.width = "1200px";
  document.body.append(pinHost);
  try {
    await render(SocialPreviewPage, {
      target: pinHost,
      props: {
        model: createPreviewModel({
          platform: "pinterest",
          identity: { displayName: "Studio", handle: "studio" },
          title: "Launch checklist",
          segments: [{ id: "primary", text: "Notes from the launch." }],
        }),
        scheme: "light",
      },
    });
    const related = pinHost.querySelector(".related-pins")!;
    expect(related).not.toBeNull();
    expect([...pinHost.querySelectorAll(".related-pin")].length).toBeGreaterThan(3);
    const closeup = pinHost.querySelector(".pin-closeup .pin-detail")!;
    expect(related.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      closeup.getBoundingClientRect().right - 2,
    );
  } finally {
    pinHost.remove();
  }

  const watchHost = document.createElement("div");
  watchHost.style.width = "1200px";
  document.body.append(watchHost);
  try {
    await render(SocialPreviewPage, {
      target: watchHost,
      props: {
        model: createPreviewModel({
          platform: "peertube",
          format: "video",
          identity: { displayName: "Framasoft", handle: "framasoft" },
          title: "Launch demo",
          segments: [{ id: "primary", text: "" }],
        }),
        scheme: "light",
      },
    });
    const rail = watchHost.querySelector(".other-videos")!;
    expect(rail).not.toBeNull();
    expect([...watchHost.querySelectorAll(".video-miniature")].length).toBeGreaterThan(3);
    const watchMain = watchHost.querySelector(".watch-layout .video-main")!;
    expect(rail.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      watchMain.getBoundingClientRect().right - 2,
    );
  } finally {
    watchHost.remove();
  }
});

it("renders the dev/null log page instead of the generic fallback", async () => {
  await page.viewport(1280, 900);
  host = document.createElement("div");
  host.style.width = "1200px";
  document.body.append(host);
  await render(SocialPreviewPage, {
    target: host,
    props: {
      model: createPreviewModel({
        platform: "devnull",
        identity: { displayName: "Alice", handle: "alice" },
        segments: [{ id: "primary", text: "Commit body for the preview." }],
      }),
      scheme: "light",
    },
  });
  expect(host.querySelector(".unsupported-page")).toBeNull();
  expect(host.querySelector(".devnull-page")).not.toBeNull();
  expect(host.textContent).toContain("Starred");
  expect(host.textContent).toContain("Latest");
  expect(host.textContent).toContain("New to /dev/null?");
  expect(host.textContent).toContain("Sign in with GitHub");
  const hash = host.querySelector(".commit-hash");
  expect(hash?.getAttribute("title")).toContain("Commit");
});
