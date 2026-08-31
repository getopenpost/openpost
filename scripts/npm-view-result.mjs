export function parseNpmViewResult(output, description) {
  const value = JSON.parse(output);
  const result = Array.isArray(value) ? value[0] : value;
  if (result === undefined || result === null) {
    throw new Error(`npm view did not return metadata for ${description}.`);
  }
  return result;
}
