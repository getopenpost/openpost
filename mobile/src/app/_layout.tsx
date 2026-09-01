import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { BottomSheetProvider } from "@swmansion/react-native-bottom-sheet";
import * as SplashScreen from "expo-splash-screen";
import { ShareIntentProvider } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DARK_COLORS, LIGHT_COLORS } from "@/components/ui";
import { queryClient } from "@/lib/query-client";
import { configureNativeQueryLifecycle } from "@/lib/query-lifecycle";
import { getQueryActorRevision, subscribeQueryActor } from "@/lib/query-session";
import { getServer, loadServer, subscribeServer } from "@/lib/server";
import {
  clearToken,
  clearWorkspaceId,
  getToken,
  getWorkspaceId,
  loadToken,
  loadWorkspaceId,
  saveWorkspaceId,
  subscribeToken,
} from "@/lib/api/token-store";
import { readAppBootstrap } from "@/lib/app-bootstrap";
import { LaunchSessionProvider, type LaunchSessionState } from "@/lib/launch-session";
import { loadSessionState, synchronizeSession } from "@/lib/session";

SplashScreen.preventAutoHideAsync();
configureNativeQueryLifecycle();

function useSessionReady() {
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const identity = `${server?.baseUrl ?? ""}\u0000${token ?? ""}`;
  const [result, setResult] = useState<{ identity: string; state: LaunchSessionState }>(() => ({
    identity,
    state: { status: "loading" },
  }));
  const [reloadRevision, setReloadRevision] = useState(0);
  const hydration = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    hydration.current ??= loadSessionState({
      loadServer,
      loadToken,
      loadWorkspaceId,
      getServer,
      getToken,
      getWorkspaceId,
    });
    void hydration.current
      .then(() => {
        controller.signal.throwIfAborted();
        return synchronizeSession(
          {
            queryClient,
            getServer,
            getToken,
            getWorkspaceId,
            saveWorkspaceId,
            clearWorkspaceId,
            clearToken,
            readAppBootstrap,
          },
          controller.signal,
        );
      })
      .then((session) => {
        if (!controller.signal.aborted) {
          setResult({ identity, state: { status: "ready", session } });
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          identity,
          state: {
            status: "error",
            error: cause instanceof Error ? cause : new Error("Could not start OpenPost"),
          },
        });
      });
    return () => controller.abort();
  }, [identity, reloadRevision]);

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  const reload = useCallback(() => {
    setResult({ identity, state: { status: "loading" } });
    if (result.state.status === "error") {
      hydration.current = loadSessionState({
        loadServer,
        loadToken,
        loadWorkspaceId,
        getServer,
        getToken,
        getWorkspaceId,
      });
    }
    setReloadRevision((revision) => revision + 1);
  }, [identity, result.state.status]);

  const state = result.identity === identity ? result.state : { status: "loading" as const };
  return { state, reload, signedIn: Boolean(server && token) };
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const launch = useSessionReady();
  // QueryClient.clear() does not reset a mounted observer's last result.
  // Remount routes when the server or actor changes. Workspace data stays
  // mounted behind Workspace-partitioned query keys.
  const queryActorRevision = useSyncExternalStore(subscribeQueryActor, getQueryActorRevision);

  const baseTheme = scheme === "dark" ? DarkTheme : DefaultTheme;
  const colors = scheme === "dark" ? DARK_COLORS : LIGHT_COLORS;
  const navigationTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: colors.tint,
      background: colors.bg,
      card: colors.card,
      text: colors.text,
      border: colors.separator,
      notification: colors.danger,
    },
  };

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <LaunchSessionProvider
          key={queryActorRevision}
          value={{ state: launch.state, reload: launch.reload }}
        >
          <KeyboardProvider
            navigationBarTranslucent
            preload={false}
            preserveEdgeToEdge
            statusBarTranslucent
          >
            <BottomSheetProvider>
              <ShareIntentProvider>
                <ThemeProvider value={navigationTheme}>
                  <StatusBar style="auto" />
                  <Stack>
                    <Stack.Screen name="index" options={{ headerShown: false }} />
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="onboarding/server"
                      options={{
                        headerShown: !launch.signedIn,
                        title: "Server",
                        headerBackTitle: "Back",
                      }}
                    />
                    <Stack.Screen name="onboarding/login" options={{ headerShown: false }} />
                    <Stack.Screen name="onboarding/pair" options={{ headerShown: false }} />
                    <Stack.Screen name="onboarding/workspace" options={{ headerShown: false }} />
                    <Stack.Screen name="onboarding/destination" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="publications/[id]/edit"
                      options={{
                        presentation: "modal",
                        title: "Edit publication",
                        headerShown: false,
                      }}
                    />
                    <Stack.Screen name="publications/[id]" options={{ title: "Publication" }} />
                  </Stack>
                </ThemeProvider>
              </ShareIntentProvider>
            </BottomSheetProvider>
          </KeyboardProvider>
        </LaunchSessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
