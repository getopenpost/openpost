import * as WebBrowser from "expo-web-browser";
import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { Brand } from "@/components/brand";
import { BodyText, Button, Card, Screen, useColors } from "@/components/ui";
import { destinationState } from "@/lib/first-use";
import { useAccounts, useWorkspaceId } from "@/lib/queries";
import { getServer } from "@/lib/server";

export default function DestinationScreen() {
  const colors = useColors();
  const workspaceId = useWorkspaceId();
  const server = getServer();
  const accounts = useAccounts(Boolean(workspaceId));
  const state = !server
    ? null
    : accounts.data
      ? destinationState(accounts.data, server.baseUrl)
      : destinationState(null);
  const readyRoute = state?.kind === "ready" ? state.route : null;

  useEffect(() => {
    if (!workspaceId) {
      router.replace("/onboarding/workspace");
      return;
    }
    if (!server) {
      router.replace("/onboarding/server");
      return;
    }
    if (readyRoute) router.replace(readyRoute);
  }, [readyRoute, server, workspaceId]);

  const showProgress = !accounts.isError && (state?.kind === "checking" || state?.kind === "ready");

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Brand compact style={styles.brand} />

        {showProgress ? (
          <View accessibilityLiveRegion="polite" style={styles.progress}>
            <ActivityIndicator color={colors.tint} />
            <BodyText>Checking connected accounts</BodyText>
          </View>
        ) : null}

        {accounts.isError ? (
          <>
            <Text style={[styles.title, { color: colors.text }]}>Could not check accounts</Text>
            <Card style={styles.card}>
              <BodyText accessibilityRole="alert" style={{ color: colors.danger }}>
                {accounts.error instanceof Error
                  ? accounts.error.message
                  : "Could not load accounts"}
              </BodyText>
              <Button
                title="Retry"
                variant="tinted"
                loading={accounts.isFetching}
                onPress={() => void accounts.refetch()}
              />
            </Card>
          </>
        ) : null}

        {!accounts.isError && state?.kind === "setup" ? (
          <>
            <Text style={[styles.title, { color: colors.text }]}>{state.title}</Text>
            <BodyText style={styles.subtitle}>{state.body}</BodyText>
            <Card style={styles.card}>
              <Button
                title={state.actions[0].label}
                variant="focal"
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(state.actions[0].url)}
              />
              <Button
                title={state.actions[1].label}
                variant="tinted"
                loading={accounts.isFetching}
                onPress={() => void accounts.refetch()}
              />
            </Card>
          </>
        ) : null}

        {!showProgress ? (
          <Button
            title={state?.kind === "setup" ? state.actions[2].label : "Back to workspaces"}
            variant="plain"
            onPress={() =>
              router.replace({
                pathname:
                  state?.kind === "setup" ? state.actions[2].route : "/onboarding/workspace",
                params: { from: "destination", mode: "switch" },
              })
            }
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
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  progress: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  card: {
    gap: 12,
  },
  back: {
    marginTop: 12,
  },
});
