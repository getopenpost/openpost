import { Redirect } from "expo-router";
import { useSyncExternalStore } from "react";

import { getServer, subscribeServer } from "@/lib/server";
import {
  getToken,
  getWorkspaceId,
  subscribeToken,
  subscribeWorkspaceId,
} from "@/lib/api/token-store";
import { destinationState } from "@/lib/first-use";

export default function Gate() {
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const workspaceId = useSyncExternalStore(subscribeWorkspaceId, getWorkspaceId);

  if (!server) return <Redirect href="/onboarding/server" />;
  if (!token) return <Redirect href="/onboarding/login" />;
  if (!workspaceId) return <Redirect href="/onboarding/workspace" />;
  return <Redirect href={destinationState(null).route} />;
}
