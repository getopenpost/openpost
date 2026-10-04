import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  docsSocialEntries,
  marketingSocialEntries,
} from "../../packages/social-images/src/index.js";
import {
  appEditorSocialEntries,
  generateAppEditorImages,
  generateSocialImages,
  readDocsSocialEntries,
  renderAppEditorCard,
  renderSocialCard,
  SOCIAL_IMAGE_HEIGHT,
  SOCIAL_IMAGE_WIDTH,
} from "./render.mjs";

function dimensions(png) {
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("renders distinct 1200 x 630 cards for representative page types", async () => {
  const entries = [
    marketingSocialEntries.find((entry) => entry.path === "/"),
    marketingSocialEntries.find((entry) => entry.path === "/platforms/bluesky"),
    marketingSocialEntries.find((entry) => entry.path === "/tools/social-media-video-editor"),
    docsSocialEntries.find((entry) => entry.path === "/guides/quickstart"),
    docsSocialEntries.find((entry) => entry.path === "/self-hosting/integrations/mastodon"),
  ];
  assert.ok(entries.every(Boolean));

  const cards = await Promise.all(entries.map(renderSocialCard));
  for (const card of cards) {
    assert.deepEqual(dimensions(card), {
      width: SOCIAL_IMAGE_WIDTH,
      height: SOCIAL_IMAGE_HEIGHT,
    });
  }
  assert.equal(new Set(cards.map((card) => card.toString("base64"))).size, entries.length);
});

test("docs generation input covers every maintained docs route", async () => {
  const generatedEntries = await readDocsSocialEntries();
  const generatedPaths = new Set(generatedEntries.map((entry) => entry.path));
  for (const entry of docsSocialEntries) {
    assert.ok(generatedPaths.has(entry.path), `missing generated card input for ${entry.path}`);
  }
  for (const entry of generatedEntries) {
    assert.ok(entry.socialTitle.length <= 80, `${entry.path} social title exceeds 80 characters`);
  }
  assert.equal(new Set(generatedEntries.map((entry) => entry.key)).size, generatedEntries.length);
});

test("selected generation writes stable page-key filenames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openpost-social-images-"));
  try {
    await writeFile(join(directory, "stale.png"), "stale");
    await generateSocialImages({
      surface: "marketing",
      outputDirectory: directory,
      keys: ["home", "platform-bluesky"],
    });
    assert.deepEqual(dimensions(await readFile(join(directory, "home.png"))), {
      width: SOCIAL_IMAGE_WIDTH,
      height: SOCIAL_IMAGE_HEIGHT,
    });
    assert.deepEqual(dimensions(await readFile(join(directory, "platform-bluesky.png"))), {
      width: SOCIAL_IMAGE_WIDTH,
      height: SOCIAL_IMAGE_HEIGHT,
    });
    await assert.rejects(readFile(join(directory, "stale.png")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selected generation cannot delete a build output", async () => {
  await assert.rejects(
    generateSocialImages({ surface: "marketing", keys: ["home"] }),
    /requires an explicit output directory/u,
  );
});

test("renders distinct 1200 x 630 cards for app editor start pages", async () => {
  assert.deepEqual(
    appEditorSocialEntries.map((entry) => entry.key),
    ["app-quick-cut", "app-video-editor", "app-image-editor"],
  );
  const cards = await Promise.all(appEditorSocialEntries.map(renderAppEditorCard));
  for (const card of cards) {
    assert.deepEqual(dimensions(card), {
      width: SOCIAL_IMAGE_WIDTH,
      height: SOCIAL_IMAGE_HEIGHT,
    });
  }
  assert.equal(new Set(cards.map((card) => card.toString("base64"))).size, cards.length);
  await assert.rejects(renderAppEditorCard({ key: "app-unknown" }), /Unknown app editor/u);

  const directory = await mkdtemp(join(tmpdir(), "openpost-app-editor-images-"));
  try {
    const result = await generateAppEditorImages({
      outputDirectory: directory,
      keys: ["app-quick-cut"],
    });
    assert.equal(result.entries.length, 1);
    assert.deepEqual(dimensions(await readFile(join(directory, "app-quick-cut.png"))), {
      width: SOCIAL_IMAGE_WIDTH,
      height: SOCIAL_IMAGE_HEIGHT,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
