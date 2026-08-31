const messageImportPattern =
  /import\s*\{[^}]*\bm\b[^}]*\}\s*from\s*["']\$lib\/paraglide\/messages["']/;

export function referencedMessageKeys(source) {
  if (!messageImportPattern.test(source)) return [];
  return [
    ...new Set([...source.matchAll(/\bm\.([A-Za-z][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1])),
  ].sort();
}
