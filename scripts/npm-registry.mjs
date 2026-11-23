// npm 11 prints one-element arrays where npm 12 prints objects or scalars.
// Both CLI generations publish OpenPost packages, so accept either shape.
export function parseNpmPackResult(output, packageName) {
  const value = JSON.parse(output);
  const pack = Array.isArray(value) ? value[0] : value?.[packageName];
  if (!pack || typeof pack !== "object") {
    throw new Error(`npm pack did not return metadata for ${packageName}.`);
  }
  return pack;
}

export function parseNpmViewResult(output, description) {
  const value = JSON.parse(output);
  const result = Array.isArray(value) ? value[0] : value;
  if (result === undefined || result === null) {
    throw new Error(`npm view did not return metadata for ${description}.`);
  }
  return result;
}
