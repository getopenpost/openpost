import * as SecureStore from "expo-secure-store";

import type { NativeThemePreference } from "./contract";
import { createThemePreferenceStore } from "./preference-store";

const THEME_PREFERENCE_KEY = "openpost.appearance.preference";

const store = createThemePreferenceStore({
  get: () => SecureStore.getItemAsync(THEME_PREFERENCE_KEY),
  set: (value) => SecureStore.setItemAsync(THEME_PREFERENCE_KEY, value),
});

export function getThemePreference(): NativeThemePreference {
  return store.get();
}

export function subscribeThemePreference(listener: () => void): () => void {
  return store.subscribe(listener);
}

export function loadThemePreference(): Promise<NativeThemePreference> {
  return store.load();
}

export function saveThemePreference(value: NativeThemePreference): Promise<void> {
  return store.save(value);
}
