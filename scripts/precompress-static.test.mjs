import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { precompressDirectory } from "./precompress-static.mjs";

test("precompresses only eligible package-local text assets", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-precompress-static-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = Buffer.from("const openpost = true;\n".repeat(100));
  await Promise.all([
    writeFile(path.join(directory, "app.js"), source),
    writeFile(path.join(directory, "catalog.json"), source),
    writeFile(path.join(directory, "small.css"), "body{}\n"),
    writeFile(path.join(directory, "image.png"), source),
  ]);
  await chmod(path.join(directory, "image.png"), 0o666);

  const result = await precompressDirectory(directory);

  assert.equal(result.candidates, 2);
  assert.deepEqual(gunzipSync(await readFile(path.join(directory, "app.js.gz"))), source);
  assert.deepEqual(brotliDecompressSync(await readFile(path.join(directory, "app.js.br"))), source);
  assert.deepEqual(gunzipSync(await readFile(path.join(directory, "catalog.json.gz"))), source);
  assert.deepEqual(
    brotliDecompressSync(await readFile(path.join(directory, "catalog.json.br"))),
    source,
  );
  await assert.rejects(readFile(path.join(directory, "small.css.gz")), /ENOENT/);
  await assert.rejects(readFile(path.join(directory, "image.png.gz")), /ENOENT/);
  assert.equal((await stat(path.join(directory, "image.png"))).mode & 0o777, 0o644);
  assert.equal((await stat(path.join(directory, "app.js.gz"))).mode & 0o777, 0o644);
});
