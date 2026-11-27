import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sourceFiles } from "./check-query-shared.mjs";

const sourceRoots = ["apps/web", "apps/marketing"];
const nativeControlPattern = /<(input|select|textarea)\b/gu;
const primitiveImplementations = new Set([
  "packages/ui/src/lib/components/input/input.svelte",
  "packages/ui/src/lib/components/textarea/textarea.svelte",
  // The shadcn-svelte calendar keeps a transparent native select behind its
  // styled month and year captions for mobile-picker and form semantics.
  "packages/ui/src/lib/components/calendar/calendar-month-select.svelte",
  "packages/ui/src/lib/components/calendar/calendar-year-select.svelte",
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

// Physical Tailwind direction utilities do not mirror for Arabic. Centering
// with left-1/2 plus a translate stays physical because it is symmetric.
const value = String.raw`(?:\d+(?:\.\d+)?|px|auto|full|\d+/\d+|\[[^\]\s"'\x60]+\]|\([^)\s"'\x60]+\))`;
const radius = String.raw`(?:none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[[^\]\s"'\x60]+\]|\([^)\s"'\x60]+\))`;
const before = String.raw`(?<=^|[\s"'\x60:!{(,])`;
const after = String.raw`(?=$|[\s"'\x60}),!=])`;
const physicalDirectionPattern = new RegExp(
  [
    String.raw`-?(?:scroll-)?[mp][lr]-${value}`,
    String.raw`-?(?:left|right)-(?!1/2${after})${value}`,
    String.raw`border-[lr](?:-[\w\[\]#%./()-]+)?`,
    String.raw`rounded-(?:[tb])?[lr](?:-${radius})?`,
    String.raw`(?:text|float)-(?:left|right)`,
  ]
    .map((token) => `${before}${token}${after}`)
    .join("|"),
  "gu",
);
const directionRoots = ["apps/web/src", "packages/ui/src", "packages/social-preview/src"];

export function findPhysicalDirectionClasses(repoRoot) {
  const violations = [];
  for (const sourceRoot of directionRoots) {
    for (const file of svelteFiles(resolve(repoRoot, sourceRoot))) {
      if (/\.(?:test|spec)\./u.test(file)) continue;
      const source = readFileSync(file, "utf8").replace(/<style[\s\S]*?<\/style>/gu, (block) =>
        block.replace(/[^\n]/gu, " "),
      );
      for (const match of source.matchAll(physicalDirectionPattern)) {
        violations.push({
          file: relative(repoRoot, file).replaceAll("\\", "/"),
          line: source.slice(0, match.index).split("\n").length,
          token: match[0],
        });
      }
    }
  }
  return violations;
}

function main() {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const violations = findNativeFormControlViolations(repoRoot);
  const nativeTextViolations = [];
  for (const file of sourceFiles(resolve(repoRoot, "apps/mobile/src/app"), {
    extensions: new Set([".tsx"]),
    skipDirectoryNames: ["node_modules"],
  })) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']react-native["']/gu)) {
      if (match[1].split(",").some((name) => /^Text(?:\s+as\s+\w+)?$/u.test(name.trim()))) {
        nativeTextViolations.push(relative(repoRoot, file));
      }
    }
  }
  const directionViolations = findPhysicalDirectionClasses(repoRoot);
  for (const violation of directionViolations) {
    process.stderr.write(
      `- ${violation.file}:${violation.line} ${violation.token} does not mirror for right-to-left languages; use the logical utility (ms, me, ps, pe, start, end, text-start, border-s, rounded-s)\n`,
    );
  }
  if (directionViolations.length > 0) process.exitCode = 1;
  if (
    directionViolations.length > 0 &&
    violations.length === 0 &&
    nativeTextViolations.length === 0
  )
    return;
  if (violations.length === 0 && nativeTextViolations.length === 0) {
    process.stdout.write(
      "ui-consistency: shared form primitives, native text and logical direction utilities cover page controls\n",
    );
    return;
  }

  process.stderr.write(
    "ui-consistency: use the shared Shadcn-svelte Input, Textarea, Select/AppSelect, Checkbox, RadioGroup, Slider, or Switch primitive:\n",
  );
  for (const violation of violations) {
    process.stderr.write(`- ${violation.file}:${violation.line} native <${violation.control}>\n`);
  }
  for (const file of nativeTextViolations) {
    process.stderr.write(
      `- ${file} use NativeText for Dynamic Type instead of react-native Text\n`,
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
