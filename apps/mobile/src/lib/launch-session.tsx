import { createContext, useContext } from "react";

import type { SessionState } from "./session";

export type LaunchSessionState =
  | { status: "loading" }
  | { status: "ready"; session: SessionState }
  | { status: "error"; error: Error };

export type LaunchSession = {
  state: LaunchSessionState;
  reload: () => void;
};

const LaunchSessionContext = createContext<LaunchSession | null>(null);

export const LaunchSessionProvider = LaunchSessionContext.Provider;

export function useLaunchSession(): LaunchSession {
  const launch = useContext(LaunchSessionContext);
  if (!launch) throw new Error("Launch session is not available");
  return launch;
}
