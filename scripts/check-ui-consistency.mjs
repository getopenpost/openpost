import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sourceFiles } from "./check-query-shared.mjs";

const sourceRoots = ["apps/web", "apps/marketing"];
const nativeControlPattern = /<(input|select|textarea)\b/gu;
const primitiveImplementations = new Set([
  "apps/web/src/lib/components/ui/input/input.svelte",
  "apps/web/src/lib/components/ui/textarea/textarea.svelte",
  // The shadcn-svelte calendar keeps a transparent native select behind its
  // styled month and year captions for mobile-picker and form semantics.
  "apps/web/src/lib/components/ui/calendar/calendar-month-select.svelte",
  "apps/web/src/lib/components/ui/calendar/calendar-year-select.svelte",
]);

const svelteExtensions = new Set([".svelte"]);

function svelteFiles(directory) {
  return sourceFiles(directory, {
    extensions: svelteExtensions,
    skipDirectoryNames: ["node_modules"],
  });
}

export function findNativeFormControlViolations(repoRoot) {
  const violations = [];
  for (const sourceRoot of sourceRoots) {
    const root = resolve(repoRoot, sourceRoot);
    for (const file of svelteFiles(root)) {
      const repoPath = relative(repoRoot, file).replaceAll("\\", "/");
      if (primitiveImplementations.has(repoPath)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(nativeControlPattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push({
          file: repoPath,
          line,
          control: match[1],
        });
      }
    }
  }
  return violations;
}

function main() {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const violations = findNativeFormControlViolations(repoRoot);
  if (violations.length === 0) {
    process.stdout.write(
      "ui-consistency: shared form primitives cover every visible Svelte control\n",
    );
    return;
  }

  process.stderr.write(
    "ui-consistency: use the shared Shadcn-svelte Input, Textarea, Select/AppSelect, Checkbox, RadioGroup, Slider, or Switch primitive:\n",
  );
  for (const violation of violations) {
    process.stderr.write(`- ${violation.file}:${violation.line} native <${violation.control}>\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
