import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Fixture from './workspace-gate.fixture.svelte';
import {
	deleteHandle,
	listKnownWorkspaces,
	removeKnownWorkspace,
	saveWorkspaceHandleRecord
} from '@openpost/editor-shared/workspace';
import { getWorkspaceRoot, setWorkspaceRoot } from '@openpost/editor-shared/workspace';
import { readJson } from '@openpost/editor-shared/workspace';

async function clearKnownWorkspaces() {
	for (const record of await listKnownWorkspaces()) {
		await removeKnownWorkspace(record.id);
	}
	await deleteHandle('workspace', 'current');
}

it('disconnects a revoked folder even when the saved workspace catalogue is unavailable', async () => {
	await clearKnownWorkspaces();
	const storage = await navigator.storage.getDirectory();
	const name = `gate-permission-${crypto.randomUUID()}`;
	const folder = await storage.getDirectoryHandle(name, { create: true });
	await saveWorkspaceHandleRecord(folder);
	const screen = await render(Fixture);
	try {
		await expect
			.element(screen.getByRole('status', { name: 'Workspace state' }))
			.toHaveTextContent('ready');
		const root = getWorkspaceRoot();
		if (!root) throw new Error('Expected the saved workspace to open');
		const denied = new DOMException('Folder permission revoked', 'NotAllowedError');
		const directory = vi.spyOn(root, 'getDirectoryHandle').mockRejectedValue(denied);
		const catalogue = vi.spyOn(IDBObjectStore.prototype, 'index').mockImplementation(() => {
			throw new DOMException('Browser storage unavailable', 'InvalidStateError');
		});
		try {
			await expect(readJson(root, ['projects', 'project.json'])).rejects.toBe(denied);
			expect(getWorkspaceRoot()).toBeNull();
			await expect
				.element(screen.getByRole('status', { name: 'Workspace state' }))
				.toHaveTextContent('reconnect');
			await expect.element(screen.getByText(name)).toBeVisible();
		} finally {
			directory.mockRestore();
			catalogue.mockRestore();
		}
	} finally {
		await screen.unmount();
		setWorkspaceRoot(null);
		await clearKnownWorkspaces();
		await storage.removeEntry(name, { recursive: true });
	}
});
