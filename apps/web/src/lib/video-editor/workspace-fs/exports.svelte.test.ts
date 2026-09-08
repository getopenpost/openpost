import { expect, it } from 'vitest';
import { saveExportFile, listExportEntries, readExportFile, deleteExportEntry } from './exports';
import { registerCloudExportProject } from './export-storage';
import { getWorkspaceRoot, setWorkspaceRoot } from './root';
import { loadProjectRenderQueue, saveProjectRenderQueue } from '../export/render-queue-persistence';

it('keeps cloud exports and queue state in browser storage without a picked folder', async () => {
	const previous = getWorkspaceRoot();
	setWorkspaceRoot(null);
	const projectId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	registerCloudExportProject(projectId, workspaceId);
	try {
		const output = new Blob(['encoded video'], { type: 'video/mp4' });
		await saveExportFile(projectId, 'Launch.mp4', output);
		const localFolder = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle('export-test-local', { create: true });
		setWorkspaceRoot(localFolder);
		const files = await listExportEntries(projectId);
		expect(files).toHaveLength(1);
		expect(files[0].name).toBe('Launch.mp4');
		expect(await (await readExportFile(files[0].path))?.text()).toBe('encoded video');
		await saveProjectRenderQueue(projectId, [], true);
		expect(await loadProjectRenderQueue(projectId)).toEqual({ jobs: [], isPaused: true });
		await deleteExportEntry(files[0].path);
		expect(await listExportEntries(projectId)).toEqual([]);
	} finally {
		const root = await navigator.storage.getDirectory();
		const exports = await root.getDirectoryHandle('openpost-video-exports');
		await exports.removeEntry(workspaceId, { recursive: true });
		setWorkspaceRoot(previous);
	}
});
