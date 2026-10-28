import { platformLabel } from "./format";

function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Search is a view of the catalogue; it never changes selection or account order. */
export function filterDestinationAccounts<
  T extends {
    platform: string;
    account_username?: string | null;
    alias?: string | null;
  },
>(accounts: readonly T[], query: string): T[] {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  return accounts.filter((account) => {
    const text = normalizeSearch(
      [account.alias, account.account_username, account.platform, platformLabel(account.platform)]
        .filter(Boolean)
        .join(" "),
    );
    return terms.every((term) => text.includes(term));
  });
}

export type KnownDestination = {
  id: string;
  platform?: string | null;
};

export type StoredDestinationRendition = {
  social_account_id?: string | null;
  platform?: string | null;
};

export type UnavailableDestination = {
  accountId: string;
  platform: string;
};

export type SocialSetLike = {
  id: string;
  name?: string | null;
  is_default?: boolean | null;
};

export type SocialSetAccountLike = {
  social_account_id: string;
};

/**
 * One summary label for every native destination chooser: `<set> · N
 * destinations` when a set is applied, otherwise `N destination(s)`. Matches
 * the composer drawer; Ideate's bare `N destinations` never named the set.
 */
export function destinationSummaryLabel(setName: string | null | undefined, count: number): string {
  if (setName?.trim()) return `${setName.trim()} · ${count} destinations`;
  return `${count} ${count === 1 ? "destination" : "destinations"}`;
}

/**
 * Saved sets with the default set first, otherwise in API order. Both native
 * drawers present sets this way; the sort is stable so non-default sets keep
 * their relative order.
 */
export function orderedSocialSets<T extends SocialSetLike>(sets: readonly T[]): T[] {
  return [...sets].sort((a, b) => Number(b.is_default === true) - Number(a.is_default === true));
}

/**
 * Selection for an applied set: member ids in authored order, deduplicated,
 * with no publishability filtering. Members whose account is gone stay in the
 * selection so the drawer renders them as explicit, removable rows (via
 * {@link reconcileDestinationSelection}) instead of silently reducing the
 * set. Callers send only `selectable` to the server.
 */
export function applySocialSetSelection(accounts: readonly SocialSetAccountLike[]): string[] {
  const seen = new Set<string>();
  const selection: string[] = [];
  for (const account of accounts) {
    if (seen.has(account.social_account_id)) continue;
    seen.add(account.social_account_id);
    selection.push(account.social_account_id);
  }
  return selection;
}

/**
 * Split a destination selection into ids the workspace can still publish to
 * and ids whose account is gone (disconnected) but still has an authored
 * rendition. Unknown ids never survive into `selectable`, so callers can send
 * it to the rendition upsert without tripping the server's active-account
 * check, while `unavailable` keeps every dropped id visible for an explicit,
 * removable drawer row instead of a silent delete.
 */
export function reconcileDestinationSelection(
  selected: Iterable<string>,
  known: readonly KnownDestination[],
  renditions?: readonly StoredDestinationRendition[] | null,
): { selectable: string[]; unavailable: UnavailableDestination[] } {
  const knownIds = new Set(known.map((account) => account.id));
  const platformByAccount = new Map<string, string>();
  for (const rendition of renditions ?? []) {
    if (rendition.social_account_id && rendition.platform) {
      if (!platformByAccount.has(rendition.social_account_id)) {
        platformByAccount.set(rendition.social_account_id, rendition.platform);
      }
    }
  }
  const seen = new Set<string>();
  const selectable: string[] = [];
  const unavailable: UnavailableDestination[] = [];
  for (const accountId of selected) {
    if (seen.has(accountId)) continue;
    seen.add(accountId);
    if (knownIds.has(accountId)) {
      selectable.push(accountId);
    } else {
      unavailable.push({ accountId, platform: platformByAccount.get(accountId) ?? "" });
    }
  }
  return { selectable, unavailable };
}
