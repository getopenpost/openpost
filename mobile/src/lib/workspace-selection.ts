export function automaticWorkspaceId({
  automaticSelectionAttempted,
  selectionPending,
  storedWorkspaceId,
  switching,
  workspaces,
}: {
  automaticSelectionAttempted: boolean;
  selectionPending: boolean;
  storedWorkspaceId: string | null;
  switching: boolean;
  workspaces: readonly { id: string }[];
}): string | null {
  if (switching || selectionPending || automaticSelectionAttempted || workspaces.length === 0) {
    return null;
  }
  if (storedWorkspaceId && workspaces.some(({ id }) => id === storedWorkspaceId)) {
    return storedWorkspaceId;
  }
  return workspaces.length === 1 ? workspaces[0]!.id : null;
}
