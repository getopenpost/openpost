import { createContext, useContext, type PropsWithChildren } from "react";

import type { NativeThemeScheme } from "./contract";

export interface NativeThemeReference {
  readonly kind: "built_in" | "custom";
  readonly id: string;
  readonly version: number;
}

export interface NativeThemeChoice {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly reference: NativeThemeReference | null;
  readonly supportedSchemes: readonly NativeThemeScheme[];
  readonly swatches?: readonly [string, string, string];
}

export interface NativeThemeSettingsController {
  readonly choices: readonly NativeThemeChoice[];
  readonly selectedKey: string;
  readonly inherited: boolean;
  readonly locked: boolean;
  readonly canManageWorkspace: boolean;
  assign(reference: NativeThemeReference | null): Promise<void>;
}

const NativeThemeSettingsContext = createContext<NativeThemeSettingsController | null>(null);

export function NativeThemeSettingsProvider({
  children,
  value,
}: PropsWithChildren<{ value: NativeThemeSettingsController | null }>) {
  return (
    <NativeThemeSettingsContext.Provider value={value}>
      {children}
    </NativeThemeSettingsContext.Provider>
  );
}

export function useNativeThemeSettings(): NativeThemeSettingsController | null {
  return useContext(NativeThemeSettingsContext);
}
