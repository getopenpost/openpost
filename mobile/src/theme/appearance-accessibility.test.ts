import { expect, test } from "bun:test";

test("Appearance exposes each radio option set as a named group", async () => {
  const source = await Bun.file(new URL("../app/appearance.tsx", import.meta.url)).text();

  expect(source.match(/accessibilityRole="radiogroup"/g)).toHaveLength(2);
  expect(source).toContain('accessibilityLabel="Color scheme"');
  expect(source).toContain('accessibilityLabel="Workspace theme"');
});
