import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const defaultValue = allowedValues[0];
  const [state, setState] = useState({
    key,
    epoch: 0,
    value: defaultValue,
    ready: false,
  });
  if (state.key !== key) {
    setState({ key, epoch: state.epoch + 1, value: defaultValue, ready: false });
  }
  const epoch = state.epoch;
  // Reject callbacks from an earlier visit, including when the key is reused.
  const activeEpoch = useRef<number | null>(null);
  useLayoutEffect(() => {
    activeEpoch.current = epoch;
    return () => {
      activeEpoch.current = null;
    };
  }, [epoch]);
  const ready = state.key === key && state.ready;
  const value = state.key === key ? state.value : defaultValue;
  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(key)
      .catch(() => null)
      .then((stored) => {
        if (!active) return;
        setState({
          key,
          epoch,
          value: allowedValues.includes(stored as T) ? (stored as T) : defaultValue,
          ready: true,
        });
      });
    return () => {
      active = false;
    };
  }, [allowedValues, defaultValue, epoch, key]);
  const select = useCallback(
    (next: T) => {
      if (activeEpoch.current !== epoch) return;
      setState((current) => (current.key === key ? { ...current, value: next } : current));
      if (!ready) return;
      void SecureStore.setItemAsync(key, next).catch(() => onPersistError?.());
    },
    [epoch, key, onPersistError, ready],
  );
  return { ready, select, value };
}
