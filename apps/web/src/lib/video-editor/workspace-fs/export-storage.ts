import { getWorkspaceRoot, requireWorkspaceRoot } from './root';

// Keep routing for projects opened in this tab, including exports finishing after navigation.
const cloudWorkspaces = new Map<string, string>();

export function registerCloudExportProject(projectId: string, workspaceId: string): void {
	cloudWorkspaces.set(projectId, workspaceId);
}

export async function exportStorageRoot(projectId?: string): Promise<FileSystemDirectoryHandle> {
	const workspaceId = projectId ? cloudWorkspaces.get(projectId) : undefined;
	if (!workspaceId) return requireWorkspaceRoot();
	const browserRoot = await navigator.storage.getDirectory();
	const exports = await browserRoot.getDirectoryHandle('openpost-video-exports', { create: true });
	return exports.getDirectoryHandle(workspaceId, { create: true });
}

export function exportFolderName(projectId: string): string | null {
	return cloudWorkspaces.has(projectId) ? null : (getWorkspaceRoot()?.name ?? null);
}
