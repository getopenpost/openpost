import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoots = ["frontend", "marketing-site"];
const nativeControlPattern = /<(input|select|textarea)\b/gu;
const primitiveImplementations = new Set([
  "frontend/src/lib/components/ui/input/input.svelte",
  "frontend/src/lib/components/ui/textarea/textarea.svelte",
  // The shadcn-svelte calendar keeps a transparent native select behind its
  // styled month and year captions for mobile-picker and form semantics.
  "frontend/src/lib/components/ui/calendar/calendar-month-select.svelte",
  "frontend/src/lib/components/ui/calendar/calendar-year-select.svelte",
]);

function svelteFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      files.push(...svelteFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".svelte")) {
      files.push(path);
    }
  }
  return files;
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
    process.stderr.write(
      `- ${violation.file}:${violation.line} native <${violation.control}>\n`,
    );
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
