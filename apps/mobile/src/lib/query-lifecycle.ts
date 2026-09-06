import { focusManager, onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { networkStateIsOnline } from "./query-policy";

let configured = false;

export function subscribeQueryOnline(listener: () => void): () => void {
  return onlineManager.subscribe(listener);
}

export function getQueryOnline(): boolean {
  return onlineManager.isOnline();
}

export function configureNativeQueryLifecycle(): void {
  if (configured) return;
  configured = true;

  focusManager.setEventListener((setFocused) => {
    setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      setFocused(state === "active");
    });
    return () => subscription.remove();
  });

  onlineManager.setEventListener((setOnline) => {
    let listening = true;
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (listening) setOnline(networkStateIsOnline(state));
      })
      .catch(() => undefined);
    const subscription = Network.addNetworkStateListener((state) => {
      if (listening) setOnline(networkStateIsOnline(state));
    });
    return () => {
      listening = false;
      subscription.remove();
    };
  });
}
