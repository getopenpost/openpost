export function parseNpmPackResult(output, packageName) {
  const value = JSON.parse(output);
  const pack = Array.isArray(value) ? value[0] : value?.[packageName];
  if (!pack || typeof pack !== "object") {
    throw new Error(`npm pack did not return metadata for ${packageName}.`);
  }
  return pack;
}
