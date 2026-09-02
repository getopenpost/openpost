import { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import { useColorScheme } from "react-native";

import type {
  NativeResolvedThemeContract,
  NativeStagedThemeResources,
  NativeThemePreference,
  NativeThemeScheme,
  NativeThemeSnapshot,
} from "./contract";
import { resolveNativeTheme } from "./runtime";

const DEFAULT_THEME = resolveNativeTheme({
  contract: null,
  preference: "system",
  systemScheme: "light",
  workspaceId: null,
});

const NativeThemeContext = createContext<NativeThemeSnapshot>(DEFAULT_THEME);

/**
 * Pure rendering boundary for the native app. The query/session layer may pass a
 * contract later, but fetching stays outside this module.
 */
export function NativeThemeRuntime({
  children,
  contract = null,
  preference = "system",
  stagedResources = null,
  systemScheme: systemSchemeOverride,
  workspaceId,
}: PropsWithChildren<{
  contract?: NativeResolvedThemeContract | null;
  preference?: NativeThemePreference;
  stagedResources?: NativeStagedThemeResources | null;
  systemScheme?: NativeThemeScheme | null;
  workspaceId: string | null;
}>) {
  const detectedScheme = useColorScheme();
  const systemScheme =
    systemSchemeOverride ??
    (detectedScheme === "dark" ? "dark" : detectedScheme === "light" ? "light" : null);
  const snapshot = useMemo(
    () =>
      resolveNativeTheme({
        contract,
        preference,
        stagedResources,
        systemScheme,
        workspaceId,
      }),
    [contract, preference, stagedResources, systemScheme, workspaceId],
  );

  return <NativeThemeContext.Provider value={snapshot}>{children}</NativeThemeContext.Provider>;
}

export function useNativeTheme(): NativeThemeSnapshot {
  return useContext(NativeThemeContext);
}
