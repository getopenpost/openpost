import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const messagesDirectory = path.join(root, "frontend", "messages");
const locales = ["en", "pt"];
const catalogs = new Map();

for (const locale of locales) {
  const content = await readFile(
    path.join(messagesDirectory, `${locale}.json`),
    "utf8",
  );
  catalogs.set(locale, new Set(Object.keys(JSON.parse(content))));
}

const referenceLocale = locales[0];
const referenceKeys = catalogs.get(referenceLocale);
let failed = false;

for (const locale of locales.slice(1)) {
  const keys = catalogs.get(locale);
  const missing = [...referenceKeys].filter((key) => !keys.has(key)).sort();
  const extra = [...keys].filter((key) => !referenceKeys.has(key)).sort();

  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`${locale}.json does not match ${referenceLocale}.json:`);
    if (missing.length > 0) console.error(`  Missing: ${missing.join(", ")}`);
    if (extra.length > 0) console.error(`  Extra: ${extra.join(", ")}`);
  }
}

if (failed) process.exit(1);
console.log(
  `Translation catalogs match (${referenceKeys.size} messages per locale).`,
);
