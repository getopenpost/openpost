import { expect, test } from "bun:test";
import {
  applySocialSetSelection,
  destinationSummaryLabel,
  filterDestinationAccounts,
  orderedSocialSets,
  reconcileDestinationSelection,
} from "./destination-selection";

test("destination search matches aliases, handles, and network labels without reordering", () => {
  const accounts = [
    { id: "b", platform: "mastodon", account_username: "founder@social.example", alias: "Work" },
    { id: "a", platform: "instagram", account_username: "founder", alias: "Studio" },
    { id: "c", platform: "instagram", account_username: "personal", alias: "Home" },
  ];
  expect(filterDestinationAccounts(accounts, "  FOUNDER ").map((account) => account.id)).toEqual([
    "b",
    "a",
  ]);
  expect(filterDestinationAccounts(accounts, "studio instagram")).toEqual([accounts[1]]);
  expect(filterDestinationAccounts(accounts, "@social.example")).toEqual([accounts[0]]);
  expect(filterDestinationAccounts(accounts, "missing")).toEqual([]);
  expect(filterDestinationAccounts(accounts, " ")).toEqual(accounts);
});

test("destination search finds accented names without changing authored labels", () => {
  const account = { id: "international", platform: "mastodon", alias: "José Álvarez" };
  expect(filterDestinationAccounts([account], "JOSE alvarez")).toEqual([account]);
  expect(account.alias).toBe("José Álvarez");
});

const known = [
  { id: "active-a", platform: "x" },
  { id: "active-b", platform: "mastodon" },
];

const renditions = [
  { social_account_id: "active-a", platform: "x" },
  { social_account_id: "gone", platform: "bluesky" },
];

test("an unknown id never survives into selectable", () => {
  const result = reconcileDestinationSelection(["active-a", "gone"], known, renditions);
  expect(result.selectable).toEqual(["active-a"]);
  expect(result.unavailable).toEqual([{ accountId: "gone", platform: "bluesky" }]);
});

test("known ids stay selectable in order without duplicates", () => {
  const result = reconcileDestinationSelection(
    ["active-b", "active-a", "active-a"],
    known,
    renditions,
  );
  expect(result.selectable).toEqual(["active-b", "active-a"]);
  expect(result.unavailable).toEqual([]);
});

test("an unavailable id without a stored rendition keeps an empty platform", () => {
  const result = reconcileDestinationSelection(["active-a", "ghost"], known, renditions);
  expect(result.selectable).toEqual(["active-a"]);
  expect(result.unavailable).toEqual([{ accountId: "ghost", platform: "" }]);
});

test("an empty selection reconciles to empty rows", () => {
  const result = reconcileDestinationSelection([], known, renditions);
  expect(result.selectable).toEqual([]);
  expect(result.unavailable).toEqual([]);
});

test("the summary names the set with its destination count", () => {
  expect(destinationSummaryLabel("Creators", 3)).toBe("Creators · 3 destinations");
});

test("the summary without a set counts destinations", () => {
  expect(destinationSummaryLabel("", 0)).toBe("0 destinations");
  expect(destinationSummaryLabel(null, 1)).toBe("1 destination");
  expect(destinationSummaryLabel(undefined, 2)).toBe("2 destinations");
});

test("saved sets order the default set first without reordering the rest", () => {
  const sets = [
    { id: "a", name: "A", is_default: false },
    { id: "b", name: "B", is_default: true },
    { id: "c", name: "C", is_default: false },
  ];
  expect(orderedSocialSets(sets).map((set) => set.id)).toEqual(["b", "a", "c"]);
});

test("applying a set keeps every member in order instead of dropping any", () => {
  expect(
    applySocialSetSelection([
      { social_account_id: "active-a" },
      { social_account_id: "gone" },
      { social_account_id: "active-a" },
    ]),
  ).toEqual(["active-a", "gone"]);
});
