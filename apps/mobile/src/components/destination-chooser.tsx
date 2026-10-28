// One destination chooser for the native post composer and Ideate.
//
// Both surfaces decide the same thing (which accounts a post goes to, with an
// optional saved Social Set), so they share this drawer body: the same
// checkbox rows, the same default-first set chips, the same loading, offline
// and error states, and a Done action that is disabled with an explanation
// when nothing is selected. Each screen keeps its own selection state and its
// own mutation owners; the composer passes its per-account text overrides
// through the optional row slots.

import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { AccountAvatar } from "@/components/account-avatar";
import { NativeText as Text } from "@/components/native-text";
import { DelayedQueryPlaceholder, QueryNotice } from "@/components/query-state";
import { ThemeIcon } from "@/components/theme-icon";
import { BodyText, Button, ContentSection, TextField } from "@/components/ui";
import {
  filterDestinationAccounts,
  orderedSocialSets,
  reconcileDestinationSelection,
} from "@/lib/destination-selection";
import { accountHandle, platformLabel } from "@/lib/format";
import { useNativeTheme, withAlpha } from "@/theme";

export type DestinationChooserAccount = {
  id: string;
  platform: string;
  account_username?: string | null;
  alias?: string | null;
  account_avatar_url?: string | null;
};

export type DestinationChooserSet = {
  id: string;
  name?: string | null;
  is_default?: boolean | null;
  accounts?: readonly { social_account_id: string }[] | null;
};

export type DestinationChooserRendition = {
  social_account_id?: string | null;
  platform?: string | null;
};

type CatalogQuery<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  refetch: () => unknown;
};

export function DestinationChooser({
  accounts,
  socialSets,
  selectedIds,
  activeSetId,
  renditions,
  notice,
  onApplySet,
  onToggle,
  onConfirm,
  rowAction,
  rowNote,
  expandedContent,
}: {
  accounts: CatalogQuery<readonly DestinationChooserAccount[]>;
  socialSets: CatalogQuery<readonly DestinationChooserSet[]>;
  /** Full selection in the order the user chose, including members whose account is gone. */
  selectedIds: readonly string[];
  activeSetId: string;
  renditions?: readonly DestinationChooserRendition[] | null;
  /** Extra notice shown with the catalog states, e.g. a readiness error. */
  notice?: ReactNode;
  onApplySet: (setId: string, accountIds: string[]) => void;
  onToggle: (accountId: string) => void;
  onConfirm: () => void;
  /** Optional per-row trailing action, e.g. the composer Edit/Hide affordance. */
  rowAction?: (accountId: string, selected: boolean) => ReactNode;
  /** Optional per-row note below the platform label, e.g. a readiness warning. */
  rowNote?: (accountId: string) => ReactNode;
  /** Optional content below a selected row, e.g. per-account text overrides. */
  expandedContent?: (accountId: string) => ReactNode;
}) {
  const theme = useNativeTheme();
  const { colors, typography } = theme.manifest;
  const [search, setSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const hasSearch = search.trim().length > 0;
  const visibleAccounts = filterDestinationAccounts(accounts.data ?? [], search).filter(
    (account) => !selectedOnly || selectedIds.includes(account.id),
  );
  // Inline account editors need the full drawer width. Narrow screens and
  // enlarged text always keep a single reading column.
  const columns = contentWidth >= 720 && fontScale <= 1.2 && !expandedContent ? 2 : 1;
  const catalogFailed = accounts.isError || socialSets.isError;
  const catalogPending =
    (accounts.data === undefined && accounts.isPending) ||
    (socialSets.data === undefined && socialSets.isPending);
  const catalogOffline =
    (accounts.data !== undefined || socialSets.data !== undefined) &&
    (accounts.fetchStatus === "paused" || socialSets.fetchStatus === "paused");
  const showOfflinePlaceholder =
    accounts.data === undefined &&
    socialSets.data === undefined &&
    (accounts.fetchStatus === "paused" || socialSets.fetchStatus === "paused");
  const { unavailable } =
    accounts.data === undefined
      ? { unavailable: [] as { accountId: string; platform: string }[] }
      : reconcileDestinationSelection(selectedIds, accounts.data, renditions);
  const accountsLoadedEmpty = (accounts.data?.length ?? 0) === 0 && accounts.data !== undefined;
  const retryCatalog = () => {
    void accounts.refetch();
    void socialSets.refetch();
  };

  return (
    <View style={styles.body} onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
      <View style={styles.summary}>
        <BodyText style={{ flex: 1 }}>
          {`${selectedIds.length} ${selectedIds.length === 1 ? "destination" : "destinations"} selected`}
        </BodyText>
        <Button title="Done" onPress={onConfirm} disabled={selectedIds.length === 0} />
      </View>
      {(socialSets.data?.length ?? 0) > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {orderedSocialSets(socialSets.data ?? []).map((set) => (
            <Pressable
              key={set.id}
              accessibilityRole="button"
              accessibilityState={{ selected: activeSetId === set.id }}
              hitSlop={8}
              onPress={() =>
                onApplySet(
                  set.id,
                  (set.accounts ?? []).map((account) => account.social_account_id),
                )
              }
              style={({ pressed }) => [
                styles.chip,
                pressed && { opacity: 0.6 },
                {
                  backgroundColor:
                    activeSetId === set.id ? withAlpha(colors.primary, 0.15) : colors.surface,
                  borderColor: activeSetId === set.id ? colors.primary : colors.outlineVariant,
                },
              ]}
            >
              <Text
                style={[
                  typography.labelMedium,
                  { color: activeSetId === set.id ? colors.primary : colors.onSurface },
                ]}
              >
                {set.name ?? "Social Set"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <BodyText>Choose a saved set or fine-tune the accounts below.</BodyText>
      {catalogPending ? (
        <DelayedQueryPlaceholder pending shape="list" offline={showOfflinePlaceholder} />
      ) : null}
      {catalogFailed ? (
        <QueryNotice
          message={
            accounts.data !== undefined || socialSets.data !== undefined
              ? "Could not refresh every destination. Current destinations remain visible."
              : "Could not load your Social Sets and accounts."
          }
          retry={retryCatalog}
        />
      ) : null}
      {catalogOffline ? (
        <QueryNotice message="You are offline. Current destinations remain visible." offline />
      ) : null}
      {notice}
      {(accounts.data?.length ?? 0) > 5 || search || selectedOnly ? (
        <View style={styles.body}>
          <TextField
            accessibilityLabel="Search accounts"
            placeholder="Search name, handle, or network"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          <View style={styles.chipRow}>
            <Button
              title={selectedOnly ? "Show all accounts" : "Show selected"}
              intent="ordinary"
              accessibilityState={{ selected: selectedOnly }}
              onPress={() => setSelectedOnly(!selectedOnly)}
            />
            {hasSearch ? (
              <Button title="Clear search" intent="quiet" onPress={() => setSearch("")} />
            ) : null}
          </View>
          <BodyText accessibilityLiveRegion="polite">
            {visibleAccounts.length} {visibleAccounts.length === 1 ? "account" : "accounts"} shown
          </BodyText>
        </View>
      ) : null}
      {accountsLoadedEmpty && unavailable.length === 0 && !catalogFailed ? (
        <ContentSection>
          <BodyText>No connected accounts. Connect them in the web app first.</BodyText>
        </ContentSection>
      ) : (
        <View style={styles.body}>
          {accounts.data !== undefined && visibleAccounts.length === 0 && !accountsLoadedEmpty ? (
            <ContentSection>
              <BodyText>
                {hasSearch ? "No accounts match your search." : "No connected accounts selected."}
              </BodyText>
            </ContentSection>
          ) : null}
          <View style={[styles.accountList, columns === 2 && styles.accountGrid]}>
            {visibleAccounts.map((account) => {
              const selected = selectedIds.includes(account.id);
              return (
                <View
                  key={account.id}
                  style={columns === 2 ? { width: (contentWidth - 8) / 2 } : undefined}
                >
                  <View
                    style={[
                      styles.accountRow,
                      {
                        backgroundColor: colors.background,
                        borderColor: selected ? colors.primary : colors.outlineVariant,
                      },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => onToggle(account.id)}
                      style={({ pressed }) => [
                        styles.accountSelection,
                        pressed && { opacity: 0.65 },
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: selected ? colors.primary : colors.outlineVariant,
                            backgroundColor: selected ? colors.primary : "transparent",
                          },
                        ]}
                      >
                        {selected ? (
                          <ThemeIcon role="check" size={15} tintColor={colors.onPrimary} />
                        ) : null}
                      </View>
                      <AccountAvatar
                        name={
                          account.alias ||
                          account.account_username ||
                          platformLabel(account.platform)
                        }
                        platform={account.platform}
                        avatarUrl={account.account_avatar_url}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[typography.labelLarge, { color: colors.onSurface }]}>
                          {accountHandle(
                            account.account_username,
                            platformLabel(account.platform),
                            account.platform,
                            account.alias ?? "",
                          )}
                        </Text>
                        <BodyText>{platformLabel(account.platform)}</BodyText>
                        {rowNote?.(account.id)}
                      </View>
                    </Pressable>
                    {rowAction?.(account.id, selected)}
                  </View>
                  {selected ? expandedContent?.(account.id) : null}
                </View>
              );
            })}
          </View>
          {unavailable.length > 0 ? (
            <BodyText>Disconnected destinations remain selected until you remove them.</BodyText>
          ) : null}
          {unavailable.map((destination) => (
            <View key={destination.accountId}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: true }}
                accessibilityLabel={
                  destination.platform
                    ? `Unavailable destination, ${platformLabel(destination.platform)}. Remove from this post.`
                    : "Unavailable destination. Remove from this post."
                }
                onPress={() => onToggle(destination.accountId)}
                style={({ pressed }) => [
                  styles.accountRow,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.primary,
                  },
                  pressed && { opacity: 0.65 },
                ]}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.primary,
                    },
                  ]}
                >
                  <ThemeIcon role="check" size={15} tintColor={colors.onPrimary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[typography.labelLarge, { color: colors.onSurface }]}>
                    {destination.platform
                      ? `Unavailable destination, ${platformLabel(destination.platform)}`
                      : "Unavailable destination"}
                  </Text>
                  <BodyText>This account was disconnected. Tap to remove it.</BodyText>
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {selectedIds.length === 0 ? (
        <BodyText>Select at least one destination to continue.</BodyText>
      ) : null}
      {visibleAccounts.length + unavailable.length > 5 ? (
        <Button title="Done" onPress={onConfirm} disabled={selectedIds.length === 0} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: 12,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 44,
    justifyContent: "center",
  },
  accountList: {
    gap: 8,
  },
  accountGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    minHeight: 52,
  },
  accountSelection: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
