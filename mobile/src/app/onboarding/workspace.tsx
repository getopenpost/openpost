import * as WebBrowser from "expo-web-browser";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  BodyText,
  Button,
  Card,
  PageTitle,
  Screen,
  SectionHeader,
  useColors,
} from "@/components/ui";
import { Brand } from "@/components/brand";
import { api, errorMessage } from "@/lib/api/client";
import { getWorkspaceId, loadWorkspaceId, saveWorkspaceId } from "@/lib/api/token-store";
import { destinationState, workspaceEmptyState } from "@/lib/first-use";
import { selectionHaptic } from "@/lib/haptics";
import { getServer } from "@/lib/server";
import { beginNativeThemeWorkspaceTransition, cancelNativeThemeWorkspaceTransition } from "@/theme";

export default function WorkspaceScreen() {
  const colors = useColors();
  const { from, mode } = useLocalSearchParams<{
    from?: string;
    mode?: string;
  }>();
  const switching = mode === "switch";
  const [selected, setSelected] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const server = getServer();
  const emptyState = server ? workspaceEmptyState(server.baseUrl) : null;

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error, response } = await api().GET("/workspaces");
      if (error || !data)
        throw new Error(await errorMessage(response, "Could not load workspaces"));
      return data.filter((w): w is NonNullable<typeof w> => Boolean(w));
    },
  });

  useEffect(() => {
    void loadWorkspaceId();
  }, []);

  const list = useMemo(() => workspaces.data ?? [], [workspaces.data]);

  const finish = useCallback(async (id: string) => {
    setSelected(id);
    setSelectionError(null);
    beginNativeThemeWorkspaceTransition(id);
    try {
      await saveWorkspaceId(id);
      router.replace(destinationState(null).route);
    } catch {
      cancelNativeThemeWorkspaceTransition(id);
      setSelected(null);
      setSelectionError("Could not switch workspaces. Try again.");
    }
  }, []);

  useEffect(() => {
    if (switching || selected || list.length === 0) return;
    const stored = getWorkspaceId();
    let automatic: string | null = null;
    if (stored && list.some((workspace) => workspace.id === stored)) automatic = stored;
    else if (list.length === 1) automatic = list[0].id;
    if (automatic) {
      const timer = setTimeout(() => void finish(automatic), 0);
      return () => clearTimeout(timer);
    }
  }, [finish, list, selected, switching]);

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

        {workspaces.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {workspaces.isError ? (
          <View style={styles.errorState}>
            <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
              {workspaces.error instanceof Error ? workspaces.error.message : "Failed to load"}
            </BodyText>
            <Button title="Retry" intent="ordinary" onPress={() => void workspaces.refetch()} />
          </View>
        ) : null}
        {selectionError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
            {selectionError}
          </BodyText>
        ) : null}

        {!workspaces.isLoading && !workspaces.isError && list.length === 0 ? (
          <Card style={styles.emptyState}>
            <Text
              style={{
                color: colors.onSurface,
                fontSize: 17,
                fontWeight: "600",
              }}
            >
              No workspaces found
            </Text>
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
                  accessibilityState={{ busy: selected === workspace.id }}
                  disabled={selected !== null}
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
                  <Text style={[styles.rowTitle, { color: colors.onSurface }]} numberOfLines={2}>
                    {workspace.name}
                  </Text>
                  {selected === workspace.id ? <ActivityIndicator color={colors.primary} /> : null}
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
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
    flexShrink: 1,
  },
  errorState: {
    gap: 12,
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
