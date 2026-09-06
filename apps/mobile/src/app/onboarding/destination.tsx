import * as WebBrowser from "expo-web-browser";
import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { Brand } from "@/components/brand";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import { BodyText, Button, Card, PageTitle, Screen } from "@/components/ui";
import { destinationState } from "@/lib/first-use";
import { useAccounts, useWorkspaceId } from "@/lib/queries";
import { getServer } from "@/lib/server";

export default function DestinationScreen() {
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

  const hasData = accounts.data !== undefined;
  const showProgress = !hasData && accounts.isPending;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Brand compact style={styles.brand} />

        {showProgress ? (
          <DelayedQueryPlaceholder
            pending
            shape="list"
            offline={accounts.fetchStatus === "paused"}
          />
        ) : null}

        {accounts.isError && !hasData ? (
          <InitialQueryError
            title="Could not check accounts"
            message={
              accounts.error instanceof Error ? accounts.error.message : "Could not load accounts"
            }
            retry={() => void accounts.refetch()}
          />
        ) : null}
        {accounts.isError && hasData ? (
          <QueryNotice
            message="Could not refresh accounts. Current destinations remain visible."
            retry={() => void accounts.refetch()}
          />
        ) : null}
        {hasData && accounts.fetchStatus === "paused" ? (
          <QueryNotice message="You are offline. Current accounts remain visible." offline />
        ) : null}

        {hasData && state?.kind === "setup" ? (
          <>
            <PageTitle>{state.title}</PageTitle>
            <BodyText style={styles.subtitle}>{state.body}</BodyText>
            <Card style={styles.card}>
              <Button
                title={state.actions[0].label}
                intent="focal"
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(state.actions[0].url)}
              />
              <Button
                title={state.actions[1].label}
                intent="ordinary"
                loading={accounts.isFetching}
                onPress={() => void accounts.refetch()}
              />
            </Card>
          </>
        ) : null}

        {!showProgress ? (
          <Button
            title={state?.kind === "setup" ? state.actions[2].label : "Back to workspaces"}
            intent="quiet"
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
  subtitle: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  card: {
    gap: 12,
  },
  back: {
    marginTop: 12,
  },
});
