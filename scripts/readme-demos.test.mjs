import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("README demo stills cannot be forced on by GitHub's theme override", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const demos = [...readme.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gu)].filter(([html]) =>
    /<img\b[^>]*src="[^"]*\/demos\/[^"]*\.gif"/u.test(html),
  );
  assert.ok(demos.length > 0, "README must include product demos");
  for (const [html] of demos) {
    const media = [...html.matchAll(/<source\b[^>]*media="([^"]+)"/gu)].map((match) => match[1]);
    assert.ok(media.length > 0, "Demos need a reduced-motion still");
    for (const query of media) {
      assert.match(query, /prefers-reduced-motion:\s*reduce/u);
      // GitHub replaces the whole query when it recognizes a color-scheme condition.
      assert.doesNotMatch(query, /prefers-color-scheme/u);
    }
  }
});
