/**
 * Active workspace root owner.
 *
 * Holds the single FileSystemDirectoryHandle the editor writes to.
 * `setWorkspaceRoot` is called once by the workspace gate after the user
 * picks (or re-grants) their workspace folder. Every storage module calls
 * `requireWorkspaceRoot()` to get the handle.
 *
 * Ported from FreeCut (MIT) — docs/references/freecut/src/infrastructure/storage/workspace-fs/root.ts
 */

import { createLogger } from './logger';

const logger = createLogger('WorkspaceRoot');

let activeRoot: FileSystemDirectoryHandle | null = null;

type PermissionLostListener = () => void;
const permissionLostListeners = new Set<PermissionLostListener>();

export function setWorkspaceRoot(handle: FileSystemDirectoryHandle | null): void {
	activeRoot = handle;
	if (handle) logger.info(`Workspace root set: ${handle.name}`);
	else logger.info('Workspace root cleared');
}

export function getWorkspaceRoot(): FileSystemDirectoryHandle | null {
	return activeRoot;
}

/**
 * Return the active root or throw — every storage operation calls this.
 * Throwing is correct: if the gate did its job, a storage op can never run
 * without an active root.
 */
export function requireWorkspaceRoot(): FileSystemDirectoryHandle {
	if (!activeRoot) {
		throw new Error(
			'Workspace root is not set. The workspace gate must run before any storage operation.'
		);
	}
	return activeRoot;
}

/**
 * Subscribe to permission-lost events. Fires when any FS op catches a
 * NotAllowedError from the active root — UI can show a reconnect modal.
 */
export function onPermissionLost(listener: PermissionLostListener): () => void {
	permissionLostListeners.add(listener);
	return () => permissionLostListeners.delete(listener);
}

export function notifyPermissionLost(): void {
	logger.warn('Permission lost on workspace root');
	for (const listener of permissionLostListeners) {
		try {
			listener();
		} catch (error) {
			logger.warn('permission-lost listener threw', error);
		}
	}
}
