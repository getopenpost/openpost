import type { NativeThemePreference } from "./contract";

export interface ThemePreferencePersistence {
  get(): Promise<string | null>;
  set(value: NativeThemePreference): Promise<void>;
}

export interface ThemePreferenceStore {
  get(): NativeThemePreference;
  load(): Promise<NativeThemePreference>;
  save(value: NativeThemePreference): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function normalizeThemePreference(value: unknown): NativeThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function createThemePreferenceStore(
  persistence: ThemePreferencePersistence,
): ThemePreferenceStore {
  let preference: NativeThemePreference = "system";
  const listeners = new Set<() => void>();

  function publish(next: NativeThemePreference) {
    if (preference === next) return;
    preference = next;
    for (const listener of listeners) listener();
  }

  return {
    get: () => preference,
    async load() {
      let stored: string | null = null;
      try {
        stored = await persistence.get();
      } catch {
        stored = null;
      }
      const next = normalizeThemePreference(stored);
      publish(next);
      return next;
    },
    async save(next) {
      await persistence.set(next);
      publish(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
