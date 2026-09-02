import { expect, test } from "bun:test";

const AUTHENTICATED_CHROME = [
  "../app/(tabs)/drafts.tsx",
  "../app/(tabs)/calendar.tsx",
  "../app/(tabs)/queue.tsx",
  "../app/appearance.tsx",
  "../app/onboarding/workspace.tsx",
  "../app/onboarding/destination.tsx",
  "../app/publications/[id].tsx",
  "../app/publications/[id]/edit.tsx",
] as const;

test("high-traffic authenticated routes inherit typography from the active theme", async () => {
  for (const relativePath of AUTHENTICATED_CHROME) {
    const source = await Bun.file(new URL(relativePath, import.meta.url)).text();
    expect(source, relativePath).not.toMatch(
      /\b(?:fontSize|fontWeight|letterSpacing|lineHeight)\s*:/,
    );
  }
});
