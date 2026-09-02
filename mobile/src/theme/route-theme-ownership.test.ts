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

const CORE_COLLECTION_ROUTES = [
  "../app/(tabs)/drafts.tsx",
  "../app/(tabs)/calendar.tsx",
  "../app/(tabs)/queue.tsx",
] as const;

test("high-traffic authenticated routes inherit typography from the active theme", async () => {
  for (const relativePath of AUTHENTICATED_CHROME) {
    const source = await Bun.file(new URL(relativePath, import.meta.url)).text();
    expect(source, relativePath).not.toMatch(
      /\b(?:fontSize|fontWeight|letterSpacing|lineHeight)\s*:/,
    );
  }
});

test("core collection routes use the shared themed loading and empty states", async () => {
  for (const relativePath of CORE_COLLECTION_ROUTES) {
    const source = await Bun.file(new URL(relativePath, import.meta.url)).text();
    expect(source, relativePath).toContain("<LoadingState");
    expect(source, relativePath).toContain("<EmptyState");
    expect(source, relativePath).not.toContain("<ActivityIndicator");
  }
});

test("appearance keeps accessibility text in one reflowing scroll surface", async () => {
  const source = await Bun.file(new URL("../app/appearance.tsx", import.meta.url)).text();
  const scrollStart = source.indexOf("<ScrollView");
  const header = source.indexOf("styles.header");

  expect(scrollStart).toBeGreaterThan(-1);
  expect(header).toBeGreaterThan(scrollStart);
  expect(source).toContain("appearanceLayoutPresentation(useWindowDimensions().fontScale)");
  expect(source).not.toContain("numberOfLines={2}");
});
