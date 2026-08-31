import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { referencedMessageKeys } from "./i18n-source-usage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const messagesDirectory = path.join(root, "frontend", "messages");
const settings = JSON.parse(
  await readFile(path.join(root, "frontend", "project.inlang", "settings.json"), "utf8"),
);
const locales = settings.locales;
const catalogs = new Map();

for (const locale of locales) {
  const content = await readFile(path.join(messagesDirectory, `${locale}.json`), "utf8");
  catalogs.set(locale, JSON.parse(content));
}

const referenceLocale = settings.baseLocale;
const referenceCatalog = catalogs.get(referenceLocale);
const referenceKeys = new Set(Object.keys(referenceCatalog));
let failed = false;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entryPath === path.join(root, "frontend", "src", "lib", "paraglide")) continue;
      files.push(...(await sourceFiles(entryPath)));
    } else if (/\.(?:js|svelte|ts)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function placeholders(message) {
  return [
    ...new Set([...message.matchAll(/\{([A-Za-z][\w]*)\b[^}]*\}/g)].map((match) => match[1])),
  ].sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function translationArtifact(message) {
  if (/\bPLCE\d+\b|プレース\d+/i.test(message)) return "placeholder stand-in";
  if (/^(?:译|翻译)[：:]|^(?:translation|translated)[：:]/i.test(message)) {
    return "translation marker";
  }
  return null;
}

const missingSourceMessages = new Map();
for (const sourcePath of await sourceFiles(path.join(root, "frontend", "src"))) {
  const source = await readFile(sourcePath, "utf8");
  for (const key of referencedMessageKeys(source)) {
    if (referenceKeys.has(key)) continue;
    const paths = missingSourceMessages.get(key) ?? [];
    paths.push(path.relative(root, sourcePath));
    missingSourceMessages.set(key, paths);
  }
}

if (missingSourceMessages.size > 0) {
  failed = true;
  console.error(`${referenceLocale}.json is missing messages used by frontend source:`);
  for (const [key, paths] of [...missingSourceMessages].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.error(`  ${key}: ${[...new Set(paths)].join(", ")}`);
  }
}

for (const locale of locales.filter((locale) => locale !== referenceLocale)) {
  const catalog = catalogs.get(locale);
  const keys = new Set(Object.keys(catalog));
  const missing = [...referenceKeys].filter((key) => !keys.has(key)).sort();
  const extra = [...keys].filter((key) => !referenceKeys.has(key)).sort();

  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`${locale}.json does not match ${referenceLocale}.json:`);
    if (missing.length > 0) console.error(`  Missing: ${missing.join(", ")}`);
    if (extra.length > 0) console.error(`  Extra: ${extra.join(", ")}`);
  }

  const placeholderMismatches = [...referenceKeys].filter(
    (key) =>
      key in catalog && !sameList(placeholders(referenceCatalog[key]), placeholders(catalog[key])),
  );
  if (placeholderMismatches.length > 0) {
    failed = true;
    console.error(`${locale}.json changes placeholders used by ${referenceLocale}.json:`);
    for (const key of placeholderMismatches) {
      console.error(
        `  ${key}: expected {${placeholders(referenceCatalog[key]).join(", ")}}, found {${placeholders(catalog[key]).join(", ")}}`,
      );
    }
  }

  const invalidMessages = [...referenceKeys].flatMap((key) => {
    const message = catalog[key];
    if (typeof message !== "string" || message.trim().length === 0) {
      return [[key, "empty or non-string message"]];
    }
    const artifact = translationArtifact(message);
    return artifact ? [[key, artifact]] : [];
  });
  if (invalidMessages.length > 0) {
    failed = true;
    console.error(`${locale}.json contains invalid translation artifacts:`);
    for (const [key, reason] of invalidMessages) console.error(`  ${key}: ${reason}`);
  }

  if (catalog.language_label === referenceCatalog.language_label) {
    failed = true;
    console.error(`${locale}.json must localize language_label for the locale picker.`);
  }
}

if (failed) process.exit(1);
console.log(`Translation catalogs match (${referenceKeys.size} messages per locale).`);
