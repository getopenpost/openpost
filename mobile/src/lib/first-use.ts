export type FirstUseAccount = {
  is_active?: boolean | null;
};

type DestinationCheckingState = {
  kind: "checking";
  route: "/onboarding/destination";
};

type DestinationReadyState = {
  kind: "ready";
  route: "/(tabs)/drafts";
};

type DestinationSetupState = {
  kind: "setup";
  title: string;
  body: string;
  actions: readonly [
    { kind: "open-url"; label: string; url: string },
    { kind: "retry"; label: string },
    { kind: "navigate"; label: string; route: "/onboarding/workspace" },
  ];
};

export function workspaceEmptyState(serverBaseUrl: string) {
  return {
    actions: [
      { kind: "open-url", label: "Open web app", url: serverBaseUrl },
      { kind: "retry", label: "Retry" },
      {
        kind: "navigate",
        label: "Back to sign in",
        route: "/onboarding/login",
      },
    ] as const,
  };
}

export function destinationState(accounts: null): DestinationCheckingState;
export function destinationState(
  accounts: readonly FirstUseAccount[],
  serverBaseUrl: string,
): DestinationReadyState | DestinationSetupState;
export function destinationState(
  accounts: readonly FirstUseAccount[] | null,
  serverBaseUrl?: string,
): DestinationCheckingState | DestinationReadyState | DestinationSetupState {
  if (accounts === null) {
    return { kind: "checking", route: "/onboarding/destination" } as const;
  }
  if (accounts.some((account) => account.is_active)) {
    return { kind: "ready", route: "/(tabs)/drafts" } as const;
  }
  if (!serverBaseUrl) throw new Error("A server is required to connect a destination");

  return {
    kind: "setup",
    title: "Connect a destination",
    body: "Connect a social account in the web app, then return here.",
    actions: [
      {
        kind: "open-url",
        label: "Open account settings",
        url: new URL("/settings?tab=accounts", serverBaseUrl).toString(),
      },
      { kind: "retry", label: "Retry" },
      {
        kind: "navigate",
        label: "Back to workspaces",
        route: "/onboarding/workspace",
      },
    ] as const,
  } as const;
}
