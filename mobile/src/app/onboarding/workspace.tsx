import * as WebBrowser from "expo-web-browser";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from "react-native";

import {
  BodyText,
  Button,
  Card,
  ContentTitle,
  PageTitle,
  Screen,
  SectionHeader,
} from "@/components/ui";
import { Brand } from "@/components/brand";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import { getWorkspaceId } from "@/lib/api/token-store";
import { destinationState, workspaceEmptyState } from "@/lib/first-use";
import { selectionHaptic } from "@/lib/haptics";
import { useWorkspaces } from "@/lib/queries";
import { getServer } from "@/lib/server";
import {
  automaticWorkspaceSelectionId,
  idleWorkspaceSelection,
  selectWorkspaceForNavigation,
} from "@/lib/workspace-selection";
import {
  beginNativeThemeWorkspaceTransition,
  cancelNativeThemeWorkspaceTransition,
  useNativeTheme,
} from "@/theme";

export default function WorkspaceScreen() {
  const theme = useNativeTheme();
  const { colors, typography } = theme.manifest;
  const { from, mode } = useLocalSearchParams<{
    from?: string;
    mode?: string;
  }>();
  const switching = mode === "switch";
  const [selection, setSelection] = useState(idleWorkspaceSelection);
  const selectionInFlight = useRef(false);
  const automaticAttempted = useRef<string | null>(null);
  const server = getServer();
  const emptyState = server ? workspaceEmptyState(server.baseUrl) : null;

  const workspaces = useWorkspaces();

  const list = useMemo(() => workspaces.data ?? [], [workspaces.data]);
  const hasData = workspaces.data !== undefined;

  const finish = useCallback(async (id: string) => {
    if (selectionInFlight.current) return false;
    selectionInFlight.current = true;
    beginNativeThemeWorkspaceTransition(id);
    try {
      const committed = await selectWorkspaceForNavigation(
        id,
        () => router.replace(destinationState(null).route),
        setSelection,
      );
      if (!committed) cancelNativeThemeWorkspaceTransition(id);
      return committed;
    } finally {
      selectionInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (switching || selection.selected || list.length === 0) return;
    const automatic = automaticWorkspaceSelectionId(
      list,
      getWorkspaceId(),
      switching,
      automaticAttempted.current,
    );
    if (!automatic) return;
    automaticAttempted.current = automatic;
    void finish(automatic);
  }, [finish, list, selection.selected, switching]);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Brand compact style={styles.brand} />
        <PageTitle>Choose workspace</PageTitle>
        <BodyText style={styles.subtitle}>Each workspace has its own posts and accounts.</BodyText>
        {switching ? (
          <Button
            title="Cancel"
            intent="quiet"
            onPress={() =>
              from === "destination" ? router.replace("/onboarding/destination") : router.back()
            }
            style={styles.cancel}
          />
        ) : null}

        <DelayedQueryPlaceholder
          pending={!hasData && workspaces.isPending}
          shape="list"
          offline={workspaces.fetchStatus === "paused"}
        />
        {workspaces.isError && !hasData ? (
          <InitialQueryError
            title="Could not load workspaces"
            message={
              workspaces.error instanceof Error ? workspaces.error.message : "Failed to load"
            }
            retry={() => void workspaces.refetch()}
          />
        ) : null}
        {workspaces.isError && hasData ? (
          <QueryNotice
            message="Could not refresh workspaces. The current list remains visible."
            retry={() => void workspaces.refetch()}
          />
        ) : null}
        {hasData && workspaces.fetchStatus === "paused" ? (
          <QueryNotice
            message="You are offline. The current workspace list remains visible."
            offline
          />
        ) : null}
        {selection.error && selection.retryWorkspaceId ? (
          <QueryNotice
            message={selection.error}
            retry={() => {
              const retryWorkspaceId = selection.retryWorkspaceId;
              if (retryWorkspaceId) void finish(retryWorkspaceId);
            }}
          />
        ) : null}

        {hasData && list.length === 0 ? (
          <Card style={styles.emptyState}>
            <ContentTitle>No workspaces found</ContentTitle>
            <BodyText>Create a workspace in the web app, then return here and try again.</BodyText>
            {emptyState ? (
              <>
                <Button
                  title={emptyState.actions[0].label}
                  intent="focal"
                  accessibilityRole="link"
                  onPress={() => void WebBrowser.openBrowserAsync(emptyState.actions[0].url)}
                  style={styles.emptyPrimary}
                />
                <Button
                  title={emptyState.actions[1].label}
                  intent="ordinary"
                  loading={workspaces.isFetching}
                  onPress={() => void workspaces.refetch()}
                />
              </>
            ) : null}
          </Card>
        ) : null}

        {list.length > 1 || (switching && list.length > 0) ? (
          <>
            <SectionHeader label="Your workspaces" />
            <Card style={styles.list}>
              {list.map((workspace, index) => (
                <Pressable
                  key={workspace.id}
                  accessibilityRole="button"
                  accessibilityState={{ busy: selection.selected === workspace.id }}
                  disabled={selection.selected !== null}
                  onPress={() => {
                    void selectionHaptic();
                    void finish(workspace.id);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.outlineVariant,
                    },
                    pressed && { opacity: 0.5 },
                  ]}
                >
                  <Text
                    style={[typography.bodyLarge, { color: colors.onSurface, flexShrink: 1 }]}
                    numberOfLines={2}
                  >
                    {workspace.name}
                  </Text>
                  {selection.selected === workspace.id ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : null}
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

        {!switching ? (
          <Button
            title={emptyState?.actions[2].label ?? "Back to sign in"}
            intent="quiet"
            onPress={() => router.replace(emptyState?.actions[2].route ?? "/onboarding/login")}
            style={styles.back}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 40,
  },
  brand: {
    marginBottom: 28,
  },
  subtitle: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  cancel: {
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  list: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  emptyState: {
    gap: 6,
  },
  emptyPrimary: {
    marginTop: 10,
  },
  back: {
    marginTop: 12,
  },
});
