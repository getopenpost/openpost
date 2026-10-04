#!/usr/bin/env bun

import { generateAppEditorImages, generateSocialImages } from "./social-images/render.mjs";

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const surface = readOption("--surface");
const outputDirectory = readOption("--out");
const keys = readOption("--keys")?.split(",").filter(Boolean);

if (!surface || !["marketing", "docs", "app-editors"].includes(surface)) {
  throw new Error(
    "Usage: bun scripts/generate-social-images.mjs --surface <marketing|docs|app-editors> [--out <path> [--keys <key,...>]]",
  );
}

if (surface === "app-editors") {
  const result = await generateAppEditorImages({ outputDirectory, keys });
  console.log(
    `Generated ${result.entries.length} app editor social images in ${result.destination}`,
  );
} else {
  const result = await generateSocialImages({ surface, outputDirectory, keys });
  console.log(
    `Generated ${result.entries.length} ${surface} social images in ${result.destination}`,
  );
}
