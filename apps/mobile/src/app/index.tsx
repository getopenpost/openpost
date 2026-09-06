import { Redirect, router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSyncExternalStore } from "react";

import { InitialQueryError, LaunchPlaceholder } from "@/components/query-state";
import { Brand } from "@/components/brand";
import { Screen } from "@/components/ui";
import { getServer, subscribeServer } from "@/lib/server";
import {
  getToken,
  getWorkspaceId,
  subscribeToken,
  subscribeWorkspaceId,
} from "@/lib/api/token-store";
import { destinationState } from "@/lib/first-use";
import { useLaunchSession } from "@/lib/launch-session";
import { getQueryOnline, subscribeQueryOnline } from "@/lib/query-lifecycle";
import { useAccounts } from "@/lib/queries";

export default function Gate() {
  const launch = useLaunchSession();
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const workspaceId = useSyncExternalStore(subscribeWorkspaceId, getWorkspaceId);
  const online = useSyncExternalStore(subscribeQueryOnline, getQueryOnline);
  const canCheckAccounts =
    launch.state.status === "ready" && Boolean(server && token && workspaceId);
  const accounts = useAccounts(canCheckAccounts);
  const pending =
    launch.state.status === "loading" ||
    (canCheckAccounts && accounts.isPending && accounts.data === undefined);

  if (pending) return <LaunchPlaceholder pending offline={!online} />;

  if (launch.state.status === "error") {
    return (
      <Screen>
        <View style={styles.content}>
          <Brand compact style={styles.brand} />
          <InitialQueryError
            title="Could not start OpenPost"
            message={launch.state.error.message}
            retry={launch.reload}
          />
        </View>
      </Screen>
    );
  }

  if (!server) return <Redirect href="/onboarding/server" />;
  if (!token) return <Redirect href="/onboarding/login" />;
  if (!workspaceId) return <Redirect href="/onboarding/workspace" />;

  if (accounts.data !== undefined) {
    const destination = destinationState(accounts.data, server.baseUrl);
    return (
      <Redirect
        href={destination.kind === "ready" ? destination.route : "/onboarding/destination"}
      />
    );
  }

  return (
    <Screen>
      <View style={styles.content}>
        <Brand compact style={styles.brand} />
        <InitialQueryError
          title="Could not check accounts"
          message={
            accounts.error instanceof Error
              ? accounts.error.message
              : "Check your connection and try again."
          }
          retry={() => void accounts.refetch()}
          secondaryAction={{
            label: "Back to workspaces",
            onPress: () =>
              router.replace({
                pathname: "/onboarding/workspace",
                params: { mode: "switch" },
              }),
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  brand: {
    marginBottom: 28,
  },
});
