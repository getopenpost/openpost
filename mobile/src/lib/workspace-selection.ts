import { captureApiRequestIdentity, commitWorkspaceIdForIdentity } from "./api/client";

export type WorkspaceSelectionState = {
  selected: string | null;
  error: string | null;
  retryWorkspaceId: string | null;
};

export const idleWorkspaceSelection: WorkspaceSelectionState = {
  selected: null,
  error: null,
  retryWorkspaceId: null,
};

export function automaticWorkspaceSelectionId(
  workspaces: { id: string }[],
  storedWorkspaceId: string | null,
  switching: boolean,
  attemptedWorkspaceId: string | null,
): string | null {
  if (switching) return null;
  const candidate =
    storedWorkspaceId && workspaces.some((workspace) => workspace.id === storedWorkspaceId)
      ? storedWorkspaceId
      : workspaces.length === 1
        ? workspaces[0].id
        : null;
  return candidate === attemptedWorkspaceId ? null : candidate;
}

export async function completeWorkspaceSelection(
  workspaceId: string,
  navigate: () => void,
): Promise<boolean> {
  const identity = captureApiRequestIdentity();
  const committed = await commitWorkspaceIdForIdentity(workspaceId, identity);
  if (!committed) return false;

  navigate();
  return true;
}

export async function selectWorkspaceForNavigation(
  workspaceId: string,
  navigate: () => void,
  publishState: (state: WorkspaceSelectionState) => void,
): Promise<boolean> {
  publishState({ selected: workspaceId, error: null, retryWorkspaceId: null });
  const committed = await completeWorkspaceSelection(workspaceId, navigate).catch(() => false);
  if (committed) return true;
  publishState({
    selected: null,
    error: "Could not select that workspace. Try again.",
    retryWorkspaceId: workspaceId,
  });
  return false;
}
