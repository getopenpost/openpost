const values = new Map([
  ["openpost.server.baseUrl", "https://mobile-review.invalid"],
  ["openpost.auth.token", "synthetic-review-token"],
  ["openpost.workspace.id", "mobile-review"],
]);
export async function getItemAsync(key) {
  return values.get(key) ?? null;
}
export async function setItemAsync(key, value) {
  values.set(key, value);
}
export async function deleteItemAsync(key) {
  values.delete(key);
}
