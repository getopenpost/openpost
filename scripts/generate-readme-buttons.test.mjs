import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BUTTON_NAMES, renderButton } from "./generate-readme-buttons.mjs";

const EXPECTED_WIDTHS = {
  "start-trial": 182,
  "self-host": 254,
  "report-bug": 142,
  "join-discord": 140,
};

test("keeps README button labels within compact horizontal bounds", () => {
  for (const [kind, expectedWidth] of Object.entries(EXPECTED_WIDTHS)) {
    for (const mode of ["light", "dark"]) {
      assert.match(renderButton(kind, mode), new RegExp(`<svg[^>]+width="${expectedWidth}"`, "u"));
    }
  }
});

test("keeps committed README buttons synchronized with the generator", async () => {
  for (const kind of BUTTON_NAMES) {
    for (const mode of ["light", "dark"]) {
      const asset = new URL(`../assets/buttons/${kind}-${mode}.svg`, import.meta.url);
      assert.equal(await readFile(asset, "utf8"), `${renderButton(kind, mode)}\n`);
    }
  }
});
