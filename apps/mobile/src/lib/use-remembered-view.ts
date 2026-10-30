import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

/**
 * Remembers a tab view per workspace. Stored values are validated against the
 * allowed set so unknown or stale entries reset to the first view, and writes
 * only land after the stored value has been read.
 */
export function useRememberedView<T extends string>({
  allowedValues,
  key,
  onPersistError,
}: {
  allowedValues: readonly T[];
  key: string;
  onPersistError?: () => void;
}): {
  ready: boolean;
  select: (value: T) => void;
  value: T;
} {
  const [value, setValue] = useState<T>(allowedValues[0]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(key)
      .then((stored) => {
        if (active && allowedValues.includes(stored as T)) setValue(stored as T);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [allowedValues, key]);
  function select(next: T) {
    setValue(next);
    if (!ready) return;
    void SecureStore.setItemAsync(key, next).catch(() => onPersistError?.());
  }
  return { ready, select, value };
}
