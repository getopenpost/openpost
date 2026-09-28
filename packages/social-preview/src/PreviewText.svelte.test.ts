import { afterEach, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import PreviewText from "./PreviewText.svelte";

let host: HTMLDivElement | undefined;
afterEach(() => host?.remove());

function container() {
  host = document.createElement("div");
  host.style.cssText = "width:240px;font:16px/20px Arial";
  document.body.append(host);
  return host;
}

it("collapses long captions, expands them, and resets when the caption changes", async () => {
  const target = container();
  const text = "First paragraph.\n\nSecond paragraph.\n\nThe final paragraph stays available.";
  const screen = await render(PreviewText, { target, props: { text, lines: 3 } });
  await expect.poll(() => target.querySelector("p")!.getBoundingClientRect().height).toBe(60);
  const more = screen.getByRole("button", { name: "See more" });
  await expect.element(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect
    .element(screen.getByRole("button", { name: "See less" }))
    .toHaveAttribute("aria-expanded", "true");
  expect(target.querySelector("p")!.getBoundingClientRect().height).toBeGreaterThan(60);
  expect(target.querySelector("p")!.textContent).toBe(text);
  await screen.rerender({ text: `${text}\nA new ending.` });
  await expect
    .element(screen.getByRole("button", { name: "See more" }))
    .toHaveAttribute("aria-expanded", "false");
  await screen.rerender({ text: "One line.\nTwo lines.\nThree lines." });
  await expect.poll(() => target.querySelector("button")).toBeNull();
  expect(target.querySelector("p")!.getBoundingClientRect().height).toBe(60);
  await screen.rerender({ text: "A short update." });
  await expect.poll(() => target.querySelector("button")).toBeNull();
  expect(target.querySelector("p")!.textContent).toBe("A short update.");
});

it("measures wrapping on resize instead of applying a character cutoff", async () => {
  const target = container();
  const text =
    "A publication can contain a long link: https://example.com/a/very/long/unbroken/path/that/must/remain/inside/the/preview.";
  const screen = await render(PreviewText, { target, props: { text, lines: 2 } });
  await expect.element(screen.getByRole("button", { name: "See more" })).toBeVisible();
  expect(target.scrollWidth).toBe(target.clientWidth);
  target.style.width = "1200px";
  await expect.poll(() => target.querySelector("button")).toBeNull();
  target.style.width = "240px";
  await expect.element(screen.getByRole("button", { name: "See more" })).toBeVisible();
});

it("lays out mixed Arabic and Hebrew paragraphs independently of an English author", async () => {
  const target = container();
  const text = "مرحبا OpenPost!\nשלום OpenPost!\nHello OpenPost!";
  const screen = await render(PreviewText, {
    target,
    props: { text, author: "alice", lines: 10 },
  });
  const paragraph = target.querySelector("p")!;
  const textNode = [...paragraph.childNodes].find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("مرحبا"),
  )!;
  function characterBounds(offset: number) {
    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);
    return range.getBoundingClientRect();
  }
  for (const line of ["مرحبا OpenPost!", "שלום OpenPost!"]) {
    const start = textNode.textContent!.indexOf(line);
    expect(characterBounds(start).x).toBeGreaterThan(characterBounds(start + line.length - 1).x);
  }
  const english = textNode.textContent!.indexOf("Hello");
  expect(characterBounds(english).x).toBeLessThan(characterBounds(english + 13).x);
  await screen.rerender({ text: "Hello OpenPost!" });
  expect(getComputedStyle(paragraph).direction).toBe("ltr");
});
