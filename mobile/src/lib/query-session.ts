export type WorkspaceQueryScope = {
  revision: number;
  workspaceId: string;
};

let revision = 0;
let actorRevision = 0;
const actorListeners = new Set<() => void>();

export function getQueryActorRevision(): number {
  return actorRevision;
}

export function subscribeQueryActor(listener: () => void): () => void {
  actorListeners.add(listener);
  return () => actorListeners.delete(listener);
}

export function captureWorkspaceQueryScope(workspaceId: string): WorkspaceQueryScope {
  return { revision, workspaceId };
}

export function markQuerySessionChanged(): void {
  revision += 1;
}

export function markQueryActorChanged(): void {
  markQuerySessionChanged();
  actorRevision += 1;
  for (const listener of actorListeners) listener();
}

export function querySessionIsCurrent(scope: WorkspaceQueryScope): boolean {
  return scope.revision === revision;
}

export function requireCurrentQuerySession(scope: WorkspaceQueryScope): void {
  if (!querySessionIsCurrent(scope)) {
    throw new Error("The signed-in session changed before this action could run");
  }
}

export function workspaceQueryScopeIsCurrent(
  scope: WorkspaceQueryScope,
  workspaceId: string | null,
): boolean {
  return querySessionIsCurrent(scope) && scope.workspaceId === workspaceId;
}
