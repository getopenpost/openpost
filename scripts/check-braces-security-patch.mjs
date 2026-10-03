import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// PR72 bounds the published 3.0.3 parser and all public AST walkers. Version
// metadata cannot distinguish that artifact, so admission requires exact bytes.
const expected = JSON.parse(
  readFileSync(new URL("../patches/braces@3.0.3.sha256.json", import.meta.url), "utf8"),
);
const installs = Array.from(
  new Bun.Glob("**/braces/package.json").scanSync({
    cwd: "node_modules",
    dot: true,
    followSymlinks: true,
  }),
);
if (installs.length === 0) throw new Error("Install dependencies before the security audit");
for (const manifest of installs) {
  const directory = path.dirname(path.join("node_modules", manifest));
  const metadata = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  if (metadata.name !== "braces" || metadata.version !== "3.0.3") {
    throw new Error("Re-review the Braces security patch when upgrading the dependency");
  }
  for (const [file, hash] of Object.entries(expected)) {
    const actual = createHash("sha256")
      .update(readFileSync(path.join(directory, file)))
      .digest("hex");
    if (actual !== hash)
      throw new Error(`Unverified Braces security artifact: ${directory}/${file}`);
  }
}
console.log(`Verified upstream Braces security patch in ${installs.length} installed artifacts`);
