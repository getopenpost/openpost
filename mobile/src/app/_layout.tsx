import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BottomSheetProvider } from "@swmansion/react-native-bottom-sheet";
import * as SplashScreen from "expo-splash-screen";
import { ShareIntentProvider } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { getServer, loadServer, subscribeServer } from "@/lib/server";
import {
  getToken,
  getWorkspaceId,
  loadToken,
  loadWorkspaceId,
  subscribeToken,
  subscribeWorkspaceId,
} from "@/lib/api/token-store";
import { loadSessionState } from "@/lib/session";
import { NativeThemeRuntime, navigationColorsFor, useNativeTheme } from "@/theme";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function useSessionReady() {
  const [loaded, setLoaded] = useState(false);
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);

  useEffect(() => {
    void (async () => {
      await loadSessionState({
        loadServer,
        loadToken,
        loadWorkspaceId,
        getServer,
        getToken,
        getWorkspaceId,
      });
      setLoaded(true);
      void SplashScreen.hideAsync();
    })();
  }, []);

  return { loaded, server, token, signedIn: Boolean(server && token) };
}

export default function RootLayout() {
  const { loaded, server, token, signedIn } = useSessionReady();
  const workspaceId = useSyncExternalStore(subscribeWorkspaceId, getWorkspaceId);
  const previousSession = useRef<string | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const session = `${server?.baseUrl ?? ""}\n${token ?? ""}`;
    if (previousSession.current === null) {
      previousSession.current = session;
      return;
    }
    if (previousSession.current !== session) {
      previousSession.current = session;
      queryClient.clear();
    }
  }, [loaded, server?.baseUrl, token]);

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NativeThemeRuntime workspaceId={workspaceId}>
          <KeyboardProvider
            navigationBarTranslucent
            preload={false}
            preserveEdgeToEdge
            statusBarTranslucent
          >
            <BottomSheetProvider>
              <ShareIntentProvider>
                <ThemedApplication signedIn={signedIn} />
              </ShareIntentProvider>
            </BottomSheetProvider>
          </KeyboardProvider>
        </NativeThemeRuntime>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function ThemedApplication({ signedIn }: { signedIn: boolean }) {
  const theme = useNativeTheme();
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
