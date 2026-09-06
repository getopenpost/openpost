import { throwIfAborted } from "@openpost/query-catalog";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { BottomSheetProvider } from "@swmansion/react-native-bottom-sheet";
import * as SplashScreen from "expo-splash-screen";
import { ShareIntentProvider } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { queryClient } from "@/lib/query-client";
import { configureNativeQueryLifecycle } from "@/lib/query-lifecycle";
import { getQueryActorRevision, subscribeQueryActor } from "@/lib/query-session";
import { getServer, loadServer, subscribeServer } from "@/lib/server";
import {
  getToken,
  getWorkspaceId,
  loadToken,
  loadWorkspaceId,
  subscribeToken,
  subscribeWorkspaceId,
} from "@/lib/api/token-store";
import {
  apiRequestIdentityIsCurrent,
  captureApiRequestIdentity,
  clearTokenForIdentity,
  commitWorkspaceIdForIdentity,
  registerUnauthorizedDeviceDataPurge,
} from "@/lib/api/client";
import { readAppBootstrap } from "@/lib/app-bootstrap";
import { registerSignedOutDeviceDataPurge } from "@/lib/auth";
import { LaunchSessionProvider, type LaunchSessionState } from "@/lib/launch-session";
import { loadSessionState, synchronizeSession } from "@/lib/session";
import { purgeVideoProjectDeviceData } from "@/lib/video-projects";
import {
  bindNativeThemeSession,
  getNativeThemeActivation,
  getThemePreference,
  isNativeThemeSessionCurrent,
  loadThemePreference,
  NativeThemeRuntime,
  navigationColorsFor,
  subscribeNativeThemeActivation,
  subscribeThemePreference,
  useNativeTheme,
} from "@/theme";

SplashScreen.preventAutoHideAsync();
registerSignedOutDeviceDataPurge(purgeVideoProjectDeviceData);
registerUnauthorizedDeviceDataPurge(purgeVideoProjectDeviceData);
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
  const [hydrated, setHydrated] = useState(false);
  const hydration = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    hydration.current ??= Promise.all([
      loadSessionState({
        loadServer,
        loadToken,
        loadWorkspaceId,
        getServer,
        getToken,
        getWorkspaceId,
      }),
      loadThemePreference(),
    ]);
    void hydration.current
      .then(() => {
        throwIfAborted(controller.signal);
        setHydrated(true);
        return synchronizeSession(
          {
            queryClient,
            getServer,
            getToken,
            getWorkspaceId,
            captureIdentity: captureApiRequestIdentity,
            identityIsCurrent: apiRequestIdentityIsCurrent,
            commitWorkspaceId: commitWorkspaceIdForIdentity,
            clearToken: clearTokenForIdentity,
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
      hydration.current = Promise.all([
        loadSessionState({
          loadServer,
          loadToken,
          loadWorkspaceId,
          getServer,
          getToken,
          getWorkspaceId,
        }),
        loadThemePreference(),
      ]);
    }
    setReloadRevision((revision) => revision + 1);
  }, [identity, result.state.status]);

  const state = result.identity === identity ? result.state : { status: "loading" as const };
  return { state, reload, signedIn: Boolean(server && token), hydrated };
}

export default function RootLayout() {
  const launch = useSessionReady();
  const workspaceId = useSyncExternalStore(subscribeWorkspaceId, getWorkspaceId);
  const preference = useSyncExternalStore(subscribeThemePreference, getThemePreference);
  const activation = useSyncExternalStore(subscribeNativeThemeActivation, getNativeThemeActivation);
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const signedIn = Boolean(server && token);
  const sessionIdentity = `${server?.baseUrl ?? ""}\u0000${token ?? ""}`;
  const activationMatchesSession = isNativeThemeSessionCurrent(sessionIdentity);
  // QueryClient.clear() does not reset a mounted observer's last result.
  // Remount routes when the server or actor changes. Workspace data stays
  // mounted behind Workspace-partitioned query keys.
  const queryActorRevision = useSyncExternalStore(subscribeQueryActor, getQueryActorRevision);

  useEffect(() => {
    if (!launch.hydrated) return;
    if (!isNativeThemeSessionCurrent(sessionIdentity)) {
      bindNativeThemeSession(sessionIdentity);
    }
  }, [launch.hydrated, sessionIdentity]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NativeThemeRuntime
          contract={signedIn && activationMatchesSession ? activation.contract : null}
          preference={preference}
          stagedResources={signedIn && activationMatchesSession ? activation.resources : null}
          workspaceId={signedIn ? workspaceId : null}
        >
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
                  <ThemedApplication />
                </ShareIntentProvider>
              </BottomSheetProvider>
            </KeyboardProvider>
          </LaunchSessionProvider>
        </NativeThemeRuntime>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function ThemedApplication() {
  const theme = useNativeTheme();
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const signedIn = Boolean(server && token);

  const navigationTheme = useMemo(() => {
    const baseTheme = theme.effectiveScheme === "dark" ? DarkTheme : DefaultTheme;
    return Object.freeze({
      ...baseTheme,
      colors: Object.freeze({
        ...baseTheme.colors,
        ...navigationColorsFor(theme),
      }),
    });
  }, [theme]);

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={theme.effectiveScheme === "dark" ? "light" : "dark"} />
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="appearance" options={{ headerShown: false }} />
        <Stack.Screen
          name="onboarding/server"
          options={{
            headerShown: !signedIn,
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
  );
}
