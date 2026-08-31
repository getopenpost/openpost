/**
 * Workspace gate state machine.
 *
 * Drives the /video-editor entry: decide whether the browser can run the
 * editor at all, whether a known workspace exists, and whether its handle
 * still has permission. Adapted from FreeCut (MIT) to Svelte 5 runes.
 */

import { onMount } from 'svelte';
import {
	activateWorkspaceHandle,
	ensureKnownWorkspaceForCurrent,
	getWorkspaceHandleRecord,
	isFileSystemAccessSupported,
	listKnownWorkspaces,
	queryHandlePermission,
	requestHandlePermission,
	removeKnownWorkspace,
	saveWorkspaceHandleRecord,
	type HandleRecord
} from '../workspace-fs/handles-db';
import { getWorkspaceRoot, onPermissionLost, setWorkspaceRoot } from '../workspace-fs/root';
import { bootstrapWorkspace } from '../workspace-fs/bootstrap';

export type WorkspaceGateState = 'initializing' | 'unavailable' | 'pick' | 'reconnect' | 'ready';

export function createWorkspaceGate() {
	const existingRoot = getWorkspaceRoot();
	let state = $state<WorkspaceGateState>(existingRoot ? 'ready' : 'initializing');
	let workspaceName = $state(existingRoot?.name ?? '');
	let activeWorkspaceId = $state<string | null>(null);
	let workspaceRevision = $state(0);
	let knownWorkspaces = $state.raw<HandleRecord[]>([]);
	let busy = $state(false);
	let error = $state('');

	async function activate(record: HandleRecord): Promise<boolean> {
		// SAFETY: workspace records always store a directory handle.
		const handle = record.handle as FileSystemDirectoryHandle;
		const permission = await queryHandlePermission(handle);
		if (permission !== 'granted') return false;
		setWorkspaceRoot(handle);
		await bootstrapWorkspace(handle);
		workspaceName = record.name;
		activeWorkspaceId = record.activeWorkspaceId ?? (record.id === 'current' ? null : record.id);
		knownWorkspaces = await listKnownWorkspaces();
		workspaceRevision += 1;
		state = 'ready';
		return true;
	}

	onMount(() => {
		let cancelled = false;
		void (async () => {
			if (!isFileSystemAccessSupported()) {
				if (!cancelled) state = 'unavailable';
				return;
			}
			try {
				await ensureKnownWorkspaceForCurrent();
				const current = await getWorkspaceHandleRecord();
				if (!current) {
					if (!cancelled) state = 'pick';
					return;
				}
				const activated = await activate(current);
				if (!cancelled && !activated) {
					knownWorkspaces = await listKnownWorkspaces();
					workspaceName = current.name;
					state = 'reconnect';
				}
			} catch (err) {
				if (!cancelled) {
					error = err instanceof Error ? err.message : String(err);
					state = 'pick';
				}
			}
		})();

		const stopPermissionListener = onPermissionLost(() => {
			void (async () => {
				const current = await getWorkspaceHandleRecord();
				if (cancelled) return;
				setWorkspaceRoot(null);
				knownWorkspaces = await listKnownWorkspaces();
				workspaceName = current?.name ?? workspaceName;
				state = current ? 'reconnect' : 'pick';
			})();
		});

		return () => {
			cancelled = true;
			stopPermissionListener();
		};
	});

	async function pickFolder(): Promise<void> {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const handle = await window.showDirectoryPicker?.({
				id: 'openpost-video-workspace',
				mode: 'readwrite',
				startIn: 'documents'
			});
			if (!handle) return;
			const permission = await queryHandlePermission(handle);
			if (permission !== 'granted') {
				const granted = await requestHandlePermission(handle);
				if (granted !== 'granted') {
					state = 'reconnect';
					workspaceName = handle.name;
					return;
				}
			}
			await saveWorkspaceHandleRecord(handle);
			const current = await getWorkspaceHandleRecord();
			if (!current || !(await activate(current))) {
				throw new Error('The selected workspace could not be activated.');
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function reconnect(): Promise<void> {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const current = await getWorkspaceHandleRecord();
			if (!current) {
				state = 'pick';
				return;
			}
			// SAFETY: the current record is a workspace, so its handle is a directory.
			const granted = await requestHandlePermission(current.handle as FileSystemDirectoryHandle);
			if (granted !== 'granted') return;
			const activated = await activate(current);
			if (!activated) state = 'reconnect';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function chooseDifferentFolder(): Promise<void> {
		await pickFolder();
	}

	async function switchWorkspace(workspaceId: string): Promise<void> {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const record = await activateWorkspaceHandle(workspaceId);
			if (!record) {
				knownWorkspaces = await listKnownWorkspaces();
				return;
			}
			// SAFETY: known workspace records always store directory handles.
			const handle = record.handle as FileSystemDirectoryHandle;
			const existing = await queryHandlePermission(handle);
			const granted = existing === 'granted' ? existing : await requestHandlePermission(handle);
			if (granted !== 'granted') {
				setWorkspaceRoot(null);
				workspaceName = record.name;
				activeWorkspaceId = workspaceId;
				knownWorkspaces = await listKnownWorkspaces();
				state = 'reconnect';
				return;
			}
			await activate(record);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function forgetWorkspace(workspaceId: string): Promise<void> {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const current = await getWorkspaceHandleRecord();
			const wasActive = current?.activeWorkspaceId === workspaceId;
			await removeKnownWorkspace(workspaceId);
			knownWorkspaces = await listKnownWorkspaces();
			if (wasActive) {
				setWorkspaceRoot(null);
				workspaceName = '';
				activeWorkspaceId = null;
				state = 'pick';
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	return {
		get state() {
			return state;
		},
		get workspaceName() {
			return workspaceName;
		},
		get activeWorkspaceId() {
			return activeWorkspaceId;
		},
		get workspaceRevision() {
			return workspaceRevision;
		},
		get knownWorkspaces() {
			return knownWorkspaces;
		},
		get busy() {
			return busy;
		},
		get error() {
			return error;
		},
		pickFolder,
		reconnect,
		chooseDifferentFolder,
		switchWorkspace,
		forgetWorkspace
	};
}

export type WorkspaceGate = ReturnType<typeof createWorkspaceGate>;
