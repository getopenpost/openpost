import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BodyText, Button, Card, Screen, SectionHeader, useColors } from "@/components/ui";
import { Brand } from "@/components/brand";
import { api, errorMessage } from "@/lib/api/client";
import { getWorkspaceId, loadWorkspaceId, saveWorkspaceId } from "@/lib/api/token-store";
import * as Haptics from "expo-haptics";

export default function WorkspaceScreen() {
  const colors = useColors();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const switching = mode === "switch";
  const [selected, setSelected] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (switching) router.back();
        return true;
      });
      return () => subscription.remove();
    }, [switching]),
  );

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
    await saveWorkspaceId(id);
    router.replace("/(tabs)/drafts");
  }, []);

  useEffect(() => {
    if (list.length === 0) return;
    const stored = getWorkspaceId();
    let automatic: string | null = null;
    if (stored && list.some((workspace) => workspace.id === stored)) automatic = stored;
    else if (list.length === 1) automatic = list[0].id;
    if (automatic) {
      void saveWorkspaceId(automatic).then(() => router.replace("/(tabs)/drafts"));
    }
  }, [list]);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Brand compact style={styles.brand} />
        <Text style={[styles.title, { color: colors.text }]}>Choose workspace</Text>
        <BodyText style={styles.subtitle}>Each workspace has its own posts and accounts.</BodyText>
        {switching ? (
          <Button title="Cancel" variant="plain" onPress={() => router.back()} style={styles.cancel} />
        ) : null}

        {workspaces.isLoading ? <ActivityIndicator color={colors.tint} /> : null}
        {workspaces.isError ? (
          <View style={styles.errorState}>
            <BodyText accessibilityRole="alert" style={{ color: colors.danger }}>
              {workspaces.error instanceof Error ? workspaces.error.message : "Failed to load"}
            </BodyText>
            <Button title="Try again" variant="tinted" onPress={() => void workspaces.refetch()} />
          </View>
        ) : null}

        {!workspaces.isLoading && !workspaces.isError && list.length === 0 ? (
          <Card style={styles.emptyState}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>
              No workspaces found
            </Text>
            <BodyText>Create a workspace in the web app, then return here and try again.</BodyText>
          </Card>
        ) : null}

        {list.length > 1 ? (
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
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    void finish(workspace.id);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.separator,
                    },
                    pressed && { opacity: 0.5 },
                  ]}
                >
                  <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>
                    {workspace.name}
                  </Text>
                  {selected === workspace.id ? <ActivityIndicator color={colors.tint} /> : null}
                </Pressable>
              ))}
            </Card>
          </>
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
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
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
});
