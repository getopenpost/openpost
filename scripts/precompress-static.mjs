import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const brotli = promisify(brotliCompress);
const gzipFile = promisify(gzip);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const defaultPublicDirectory = resolve(
  scriptDirectory,
  "../frontend/build",
);
const compressibleExtensions = new Set([".css", ".js", ".svg", ".webmanifest"]);
const minimumBytes = 1024;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const pathname = resolve(directory, entry.name);
      return entry.isDirectory() ? filesBelow(pathname) : [pathname];
    }),
  );
  return nested.flat();
}

export async function precompressDirectory(
  publicDirectory = defaultPublicDirectory,
) {
  const candidates = [];
  for (const pathname of await filesBelow(publicDirectory)) {
    if (!compressibleExtensions.has(extname(pathname))) continue;
    if ((await stat(pathname)).size < minimumBytes) continue;
    candidates.push(pathname);
  }

  let sourceBytes = 0;
  let brotliBytes = 0;
  let gzipBytes = 0;
  for (const pathname of candidates.sort()) {
    const source = await readFile(pathname);
    const [brotliOutput, gzipOutput] = await Promise.all([
      brotli(source, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 9,
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        },
      }),
      gzipFile(source, { level: 9 }),
    ]);
    await Promise.all([
      writeFile(`${pathname}.br`, brotliOutput),
      writeFile(`${pathname}.gz`, gzipOutput),
    ]);
    sourceBytes += source.length;
    brotliBytes += brotliOutput.length;
    gzipBytes += gzipOutput.length;
  }

  return {
    candidates: candidates.length,
    sourceBytes,
    brotliBytes,
    gzipBytes,
  };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path`);
  }
  return value;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const requestedDirectory = optionValue("--directory");
  const result = await precompressDirectory(
    requestedDirectory
      ? resolve(process.cwd(), requestedDirectory)
      : defaultPublicDirectory,
  );
  const formatMiB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  console.log(
    `Precompressed ${result.candidates} text assets: ${formatMiB(result.sourceBytes)} source, ` +
      `${formatMiB(result.brotliBytes)} Brotli, ${formatMiB(result.gzipBytes)} gzip.`,
  );
}
