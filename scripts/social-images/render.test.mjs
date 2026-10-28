import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { docsSocialEntries } from "../../packages/social-images/src/index.js";
import {
  appEditorSocialEntries,
  generateAppEditorImages,
  generateSocialImages,
  readDocsSocialEntries,
  renderAppEditorCard,
} from "./render.mjs";

function dimensions(png) {
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

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
  const marketingDirectory = join(directory, "marketing");
  const docsDirectory = join(directory, "docs");
  try {
    await mkdir(marketingDirectory);
    await writeFile(join(marketingDirectory, "stale.png"), "stale");
    await generateSocialImages({
      surface: "marketing",
      outputDirectory: marketingDirectory,
      keys: ["home", "platform-bluesky", "tool-social-media-video-editor"],
    });
    await generateSocialImages({
      surface: "docs",
      outputDirectory: docsDirectory,
      keys: ["guides--quickstart", "self-hosting--integrations--mastodon"],
    });
    const cards = await Promise.all(
      [
        join(marketingDirectory, "home.png"),
        join(marketingDirectory, "platform-bluesky.png"),
        join(marketingDirectory, "tool-social-media-video-editor.png"),
        join(docsDirectory, "guides--quickstart.png"),
        join(docsDirectory, "self-hosting--integrations--mastodon.png"),
      ].map((file) => readFile(file)),
    );
    for (const card of cards) {
      assert.deepEqual(dimensions(card), { width: 1200, height: 630 });
    }
    assert.equal(new Set(cards.map((card) => card.toString("base64"))).size, 5);
    await assert.rejects(readFile(join(marketingDirectory, "stale.png")), {
      code: "ENOENT",
    });
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
      width: 1200,
      height: 630,
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
      width: 1200,
      height: 630,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
