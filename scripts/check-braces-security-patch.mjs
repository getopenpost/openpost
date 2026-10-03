import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

try {
  // PR72 bounds the published 3.0.3 parser and all public AST walkers. Version
  // metadata cannot distinguish that artifact, so admission requires exact bytes.
  const expected = JSON.parse(
    readFileSync(new URL("../patches/braces@3.0.3.sha256.json", import.meta.url), "utf8"),
  );
  // Workspace links can cycle through build/cache trees. Enumerate package entries
  // without following them, then verify a matched Braces link through ordinary reads.
  const installs = Array.from(
    new Bun.Glob("**/braces").scanSync({
      cwd: "node_modules",
      dot: true,
      followSymlinks: false,
      onlyFiles: false,
    }),
  );
  if (installs.length === 0) throw new Error("Install dependencies before the security audit");
  for (const install of installs) {
    const directory = path.join("node_modules", install);
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
} catch (error) {
  process.stderr.write(
    `Braces security verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
