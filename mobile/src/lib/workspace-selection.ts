import { captureApiRequestIdentity, commitWorkspaceIdForIdentity } from "./api/client";

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
