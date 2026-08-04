import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedPrefixes = [
  ".agents/",
  ".hermes/",
  "docs/research/",
  "frontend/static/studio-models/",
];

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(path.join(root, file)))
  .filter(
    (file) => !excludedPrefixes.some((prefix) => file.startsWith(prefix)),
  );

const failures = [];

for (const file of files) {
  const sourcePath = path.join(root, file);
  const contents = readFileSync(sourcePath, "utf8");
  const targets = [
    ...[...contents.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(
      (match) => match[1],
    ),
    ...[
      ...contents.matchAll(/<(?:a|img)\b[^>]*(?:href|src)=["']([^"']+)["']/gi),
    ].map((match) => match[1]),
    ...[...contents.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)].map(
      (match) => match[1],
    ),
  ];

  for (const rawTarget of targets) {
    const target = rawTarget.replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(target)) {
      continue;
    }

    const localTarget = decodeURIComponent(target.split("#")[0].split("?")[0]);
    if (!localTarget) {
      continue;
    }

    const bases =
      localTarget.startsWith("/") && file.startsWith("docs-site/")
        ? [
            path.join(root, "docs-site", localTarget),
            path.join(root, "docs-site/public", localTarget),
            ...(localTarget === "/openapi.json"
              ? [path.join(root, "frontend/openapi.json")]
              : []),
          ]
        : [path.resolve(path.dirname(sourcePath), localTarget)];
    const candidates = bases.flatMap((base) => [
      base,
      `${base}.md`,
      path.join(base, "README.md"),
      path.join(base, "index.md"),
    ]);

    if (!candidates.some((candidate) => existsSync(candidate))) {
      failures.push(`${file} -> ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken local documentation links:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(
  `Checked local links in ${files.length} maintained Markdown files.`,
);
