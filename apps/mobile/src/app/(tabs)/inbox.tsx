import { InboxSessionBoundary } from "@/components/inbox/session-boundary";
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  conversationsQueryOptions,
  engagementQueryOptions,
  inboxQueryKeys,
} from "@openpost/query-catalog";
import { Screen, BodyText, Button, ContentTitle, EmptyState, TextField } from "@/components/ui";
import { XMessagingRecovery } from "@/components/inbox/account-recovery";
import { WorkspaceHeader } from "@/components/workspace-header";
import { AccountAvatar } from "@/components/account-avatar";
import { Segments } from "@/components/segments";
import { InboxStatusTabs, AccountFilter, InboxDivider } from "@/components/inbox/controls";
import { useRememberedView } from "@/lib/use-remembered-view";
import { DelayedQueryPlaceholder, QueryNotice } from "@/components/query-state";
import { NativeText as Text } from "@/components/native-text";
import { useAccounts, useWorkspaceCapabilities, useWorkspaceId } from "@/lib/queries";
import {
  mobileInboxAPI,
  setConversationState,
  setCommentState,
  markMatchingCommentsRead,
  type Conversation,
  type Comment,
} from "@/lib/inbox/api";
import { lastSuccessfulSync } from "@/lib/inbox/refresh";
import { useInboxRefresh } from "@/lib/inbox/use-refresh";
import { useInboxUpdates } from "@/lib/inbox/lifecycle";
import { relativeTime, platformLabel } from "@/lib/format";
import { useNativeTheme } from "@/theme";
import { captureApiRequestIdentity, apiRequestIdentityIsCurrent } from "@/lib/api/client";

export default function InboxScreen() {
  const workspaceId = useWorkspaceId();
  return (
    <InboxSessionBoundary>
      <InboxContent key={workspaceId} workspaceId={workspaceId ?? ""} />
    </InboxSessionBoundary>
  );
}
const INBOX_VIEWS = ["chats", "comments"] as const;
function InboxContent({ workspaceId }: { workspaceId: string }) {
  const { colors, spacing, typography } = useNativeTheme().manifest;
  const accounts = useAccounts();
  const canEdit = !!useWorkspaceCapabilities()?.can_edit;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread" | "archived">("all");
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<"" | "comment" | "mention" | "review">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [bulkReading, setBulkReading] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{
    kind: "chat" | "comment";
    id: string;
    archived: boolean;
  } | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const { select: selectRememberedView, value: view } = useRememberedView({
    allowedValues: INBOX_VIEWS,
    key: `inbox-view-${workspaceId}`,
    onPersistError: () => setError("Could not remember Inbox view."),
  });
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const liveError = useInboxUpdates(view);
  const filters = {
    accountId,
    archived: filter === "archived",
    unreadOnly: filter === "unread",
    search: query,
    limit: 50,
  };
  const chats = useInfiniteQuery({
    ...conversationsQueryOptions(mobileInboxAPI, workspaceId, filters),
    enabled: !!workspaceId && view === "chats",
  });
  const comments = useInfiniteQuery({
    ...engagementQueryOptions(mobileInboxAPI, workspaceId, { ...filters, kind: kind || undefined }),
    enabled: !!workspaceId && view === "comments",
  });
  const activeQuery = view === "chats" ? chats : comments;
  const chatItems = [
    ...new Map(
      chats.data?.pages.flatMap((page) => page.items ?? []).map((row) => [row.id, row]) ?? [],
    ).values(),
  ];
  const commentItems = [
    ...new Map(
      comments.data?.pages.flatMap((page) => page.items ?? []).map((row) => [row.id, row]) ?? [],
    ).values(),
  ];
  const syncStates =
    view === "chats" ? chats.data?.pages[0]?.sync_states : comments.data?.pages[0]?.sync_states;
  const syncIssue = syncStates?.find(
    (state) => state.error_message || state.status === "failed" || state.status === "unavailable",
  );
  const successfulAt = lastSuccessfulSync(syncStates, accountId);
  const refresh = useInboxRefresh({
    workspaceId,
    view,
    viewKey: `${view}:${filter}:${accountId}:${kind}`,
    canEdit,
    previousSuccess: successfulAt,
    reloadStored: async () => {
      const loaded = await activeQuery.refetch();
      return lastSuccessfulSync(loaded.data?.pages[0]?.sync_states, accountId);
    },
  });
  async function updateArchive(
    kind: "chat" | "comment",
    id: string,
    archived: boolean,
    previous: boolean | null,
  ) {
    if (!canEdit || archiving) return;
    const identity = captureApiRequestIdentity();
    setArchiving(id);
    setError(null);
    try {
      if (kind === "chat") await setConversationState(workspaceId, id, { archived }, canEdit);
      else await setCommentState(workspaceId, id, { archived }, canEdit);
      if (!apiRequestIdentityIsCurrent(identity)) return;
      setUndo(previous === null ? null : { kind, id, archived: previous });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey:
            kind === "chat"
              ? inboxQueryKeys.conversationsRoot(workspaceId)
              : inboxQueryKeys.engagementRoot(workspaceId),
        }),
        queryClient.invalidateQueries({ queryKey: inboxQueryKeys.summary(workspaceId) }),
      ]);
    } catch (cause) {
      if (apiRequestIdentityIsCurrent(identity))
        setError(cause instanceof Error ? cause.message : "Could not update Inbox");
    } finally {
      if (apiRequestIdentityIsCurrent(identity)) setArchiving(null);
    }
  }
  async function markAllRead() {
    if (!canEdit || bulkReading || !workspaceId) return;
    const identity = captureApiRequestIdentity();
    setBulkReading(true);
    setError(null);
    setBulkNotice("");
    try {
      const result = await markMatchingCommentsRead(
        workspaceId,
        accountId,
        filter === "archived",
        kind || undefined,
      );
      if (!apiRequestIdentityIsCurrent(identity)) return;
      await queryClient.invalidateQueries({ queryKey: inboxQueryKeys.engagementRoot(workspaceId) });
      if (apiRequestIdentityIsCurrent(identity))
        setBulkNotice(
          `${result.updated_count} matching items marked read for everyone in this Workspace.`,
        );
    } catch (cause) {
      if (apiRequestIdentityIsCurrent(identity))
        setError(cause instanceof Error ? cause.message : "Could not mark comments read");
    } finally {
      if (apiRequestIdentityIsCurrent(identity)) setBulkReading(false);
    }
  }
  function accountName(id: string) {
    const account = accounts.data?.find((account) => account.id === id);
    return account?.alias || account?.account_username || "Connected account";
  }
  function openChat(chat: Conversation) {
    router.push({ pathname: "/inbox/[id]", params: { id: chat.id } });
  }
  function openComment(comment: Comment) {
    router.push({ pathname: "/inbox/comment/[id]", params: { id: comment.id } });
  }
  const header = (
    <View style={{ gap: 12, paddingHorizontal: spacing.large, paddingBottom: 12 }}>
      <Segments
        values={[
          { value: "chats", label: "Chats" },
          { value: "comments", label: "Activity" },
        ]}
        selected={view}
        onSelect={(value) => {
          selectRememberedView(value);
          setSearch("");
        }}
      />
      {view === "chats" ? (
        <TextField
          accessibilityLabel="Search all chats"
          placeholder="Search people and messages"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      ) : null}
      <InboxStatusTabs
        values={[
          { value: "all", label: "All" },
          { value: "unread", label: "Unread" },
          { value: "archived", label: "Archived" },
        ]}
        selected={filter}
        onSelect={setFilter}
      />
      {view === "comments" ? (
        <InboxStatusTabs
          values={[
            { value: "", label: "All activity" },
            { value: "comment", label: "Comments" },
            { value: "mention", label: "Mentions" },
            { value: "review", label: "Reviews" },
          ]}
          selected={kind}
          onSelect={setKind}
        />
      ) : null}
      <AccountFilter accounts={accounts.data ?? []} value={accountId} onChange={setAccountId} />
      {accounts.data?.some((account) => account.id === accountId && account.platform === "x") ? (
        <XMessagingRecovery accountId={accountId} workspaceId={workspaceId} />
      ) : null}
      {view === "comments" && canEdit ? (
        <View style={{ gap: 8 }}>
          <Button
            title="Mark all matching read"
            intent="ordinary"
            disabled={bulkReading}
            onPress={() => void markAllRead()}
          />
          <BodyText>Read status is shared by everyone in this Workspace.</BodyText>
          {bulkNotice ? <BodyText accessibilityLiveRegion="polite">{bulkNotice}</BodyText> : null}
        </View>
      ) : null}
      {undo && canEdit ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <BodyText style={{ flex: 1 }}>
            {undo.kind === "chat" ? "Chat" : "Comment"} {undo.archived ? "reopened" : "archived"}
          </BodyText>
          <Button
            title="Undo"
            intent="ordinary"
            onPress={() => void updateArchive(undo.kind, undo.id, undo.archived, null)}
            disabled={!!archiving}
          />
        </View>
      ) : null}
      {refresh.notice ? (
        <BodyText accessibilityLiveRegion="polite">{refresh.notice}</BodyText>
      ) : null}
      {error ? <QueryNotice message={error} /> : null}
      {syncIssue ? (
        <QueryNotice
          message={
            syncIssue.error_message ||
            `${platformLabel(syncIssue.platform)} needs attention. Check account settings.`
          }
        />
      ) : null}
      {liveError ? (
        <BodyText accessibilityLiveRegion="polite">Reconnecting to Inbox…</BodyText>
      ) : null}
      <DelayedQueryPlaceholder
        pending={activeQuery.isPending}
        shape="list"
        offline={activeQuery.fetchStatus === "paused"}
      />
      {activeQuery.isError ? (
        <QueryNotice
          message={
            activeQuery.error instanceof Error ? activeQuery.error.message : "Could not load Inbox"
          }
          retry={() => void activeQuery.refetch()}
        />
      ) : null}
    </View>
  );
  return (
    <Screen>
      <WorkspaceHeader />
      <FlatList<Conversation | Comment>
        key={view}
        data={view === "chats" ? chatItems : commentItems}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ItemSeparatorComponent={InboxDivider}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refresh.refreshing}
            onRefresh={() => void refresh.refresh()}
            tintColor={colors.onSurfaceVariant}
          />
        }
        onEndReached={() => {
          if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage)
            void activeQuery.fetchNextPage();
        }}
        ListFooterComponent={
          <View style={{ gap: 8, paddingHorizontal: spacing.large, paddingTop: 12 }}>
            {activeQuery.hasNextPage ? (
              <Button
                title={activeQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                loading={activeQuery.isFetchingNextPage}
                intent="ordinary"
                onPress={() => void activeQuery.fetchNextPage()}
              />
            ) : null}
            <BodyText style={[typography.labelMedium]}>
              {successfulAt
                ? `Last successful collection: ${new Date(successfulAt).toLocaleString()}. Networks may deliver updates later.`
                : "No successful collection recorded. Showing stored items."}
            </BodyText>
          </View>
        }
        ListEmptyComponent={
          !activeQuery.isPending && !activeQuery.isError ? (
            <EmptyState
              iconRole="notification"
              title={
                query
                  ? "No matching chats"
                  : filter === "unread"
                    ? "You're caught up"
                    : filter === "archived"
                      ? "Nothing archived"
                      : view === "chats"
                        ? "No chats yet"
                        : "No activity yet"
              }
              body={
                view === "chats"
                  ? "Conversations from enabled accounts appear here. Availability depends on the network and account permissions."
                  : "Comments, incoming mentions and business reviews from enabled accounts appear here."
              }
            />
          ) : null
        }
        renderItem={({ item }) =>
          "counterpart_name" in item ? (
            <SwipeableRow
              enabled={canEdit}
              actionLabel={filter === "archived" ? "Reopen" : "Archive"}
              onAction={() =>
                void updateArchive("chat", item.id, filter !== "archived", !!item.archived_at)
              }
            >
              <View style={{ paddingHorizontal: spacing.large }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.counterpart_name || item.counterpart_handle}, ${item.unread_count} unread, ${platformLabel(item.platform)}, received by ${accountName(item.social_account_id)}, ${item.last_message_preview || "No messages"}`}
                  onPress={() => openChat(item)}
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: "row",
                    gap: 12,
                    paddingVertical: 12,
                    alignItems: "center",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <AccountAvatar
                    name={item.counterpart_name || item.counterpart_handle}
                    platform={item.platform}
                    avatarUrl={item.counterpart_avatar_url}
                    size={44}
                  />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ContentTitle numberOfLines={1} style={{ flex: 1 }}>
                        {item.counterpart_name || item.counterpart_handle || "Conversation"}
                      </ContentTitle>
                      <BodyText>{relativeTime(item.last_message_at)}</BodyText>
                      {item.unread_count ? <UnreadBadge count={item.unread_count} /> : null}
                    </View>
                    <BodyText
                      numberOfLines={2}
                      style={item.unread_count ? { color: colors.onSurface } : null}
                    >
                      {item.last_message_preview || "No messages"}
                    </BodyText>
                    <BodyText numberOfLines={1}>{accountName(item.social_account_id)}</BodyText>
                  </View>
                </Pressable>
              </View>
            </SwipeableRow>
          ) : (
            <SwipeableRow
              enabled={canEdit}
              actionLabel={item.archived_at ? "Reopen" : "Archive"}
              onAction={() =>
                void updateArchive("comment", item.id, !item.archived_at, !!item.archived_at)
              }
            >
              <View style={{ paddingHorizontal: spacing.large }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${activityAuthor(item)}${item.read_at ? "" : ", unread"}, ${platformLabel(item.platform)}, received by ${accountName(item.social_account_id)}, ${item.body ? `${item.body}, ` : ""}${activityContext(item)}`}
                  onPress={() => openComment(item)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    gap: 12,
                    paddingVertical: 12,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <AccountAvatar
                    name={activityAuthor(item)}
                    platform={item.platform}
                    avatarUrl={item.author_avatar_url}
                    size={36}
                  />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ContentTitle numberOfLines={1} style={{ flex: 1 }}>
                        {activityAuthor(item)}
                      </ContentTitle>
                      <BodyText>{relativeTime(item.remote_created_at || item.created_at)}</BodyText>
                      {item.read_at ? null : <UnreadBadge />}
                    </View>
                    <BodyText
                      numberOfLines={2}
                      style={item.read_at ? null : { color: colors.onSurface }}
                    >
                      {item.body ||
                        (item.kind === "review" ? "Rating without written feedback" : "")}
                    </BodyText>
                    <BodyText numberOfLines={1}>{activityContext(item)}</BodyText>
                  </View>
                </Pressable>
              </View>
            </SwipeableRow>
          )
        }
      />
    </Screen>
  );
}

function UnreadBadge({ count }: { count?: number }) {
  const { colors, shape, typography } = useNativeTheme().manifest;
  if (count === undefined) {
    return (
      <View
        style={{ backgroundColor: colors.primary, borderRadius: shape.full, height: 8, width: 8 }}
      />
    );
  }
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.primaryContainer,
        borderRadius: shape.full,
        justifyContent: "center",
        minWidth: 20,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={[typography.labelMedium, { color: colors.onPrimaryContainer }]}>{count}</Text>
    </View>
  );
}

function SwipeableRow({
  actionLabel,
  children,
  enabled,
  onAction,
}: {
  actionLabel: string;
  children: React.ReactNode;
  enabled: boolean;
  onAction: () => void;
}) {
  const { colors, shape, spacing, typography } = useNativeTheme().manifest;
  if (!enabled) return <>{children}</>;
  return (
    <Swipeable
      friction={1.6}
      overshootRight={false}
      rightThreshold={72}
      renderRightActions={() => (
        <View
          style={{
            alignItems: "flex-start",
            backgroundColor: colors.secondaryContainer,
            borderRadius: shape.medium,
            justifyContent: "center",
            paddingHorizontal: spacing.large,
            width: 112,
          }}
        >
          <Text style={[typography.labelLarge, { color: colors.onSecondaryContainer }]}>
            {actionLabel}
          </Text>
        </View>
      )}
      onSwipeableOpen={onAction}
    >
      {children}
    </Swipeable>
  );
}

function activityContext(item: Comment) {
  if (item.kind === "review")
    return `Business review${item.subject?.review?.stars == null ? "" : ` · ${item.subject.review.stars}/5`}`;
  if (item.kind === "mention") return "Incoming mention";
  return `On: ${item.publication_title || item.publication_excerpt || "Public post"}`;
}

function activityAuthor(item: Comment): string {
  return item.subject?.review?.anonymous
    ? "Anonymous reviewer"
    : item.author_name || item.author_handle || "Unknown author";
}
