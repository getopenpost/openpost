import { afterEach, describe, expect, it } from 'vitest';
import { listExportEntries, saveExportFile } from './exports';
import { setWorkspaceRoot } from './root';

afterEach(() => setWorkspaceRoot(null));

describe('workspace exports', () => {
	it('lists image-sequence directories beside rendered files', async () => {
		const browserRoot = await navigator.storage.getDirectory();
		const workspaceName = `exports-${crypto.randomUUID()}`;
		const workspace = await browserRoot.getDirectoryHandle(workspaceName, { create: true });
		setWorkspaceRoot(workspace);

		try {
			await saveExportFile('project', 'render.mp4', new Blob(['video'], { type: 'video/mp4' }));
			const projects = await workspace.getDirectoryHandle('projects', { create: false });
			const project = await projects.getDirectoryHandle('project', { create: false });
			const exportsDirectory = await project.getDirectoryHandle('exports', { create: false });
			const sequence = await exportsDirectory.getDirectoryHandle('frames__proof', { create: true });
			const frame = await sequence.getFileHandle('frame_00001.png', { create: true });
			const writable = await frame.createWritable();
			await writable.write(new Blob(['frame'], { type: 'image/png' }));
			await writable.close();

			const entries = await listExportEntries('project');
			expect(entries).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: 'render.mp4', kind: 'file' }),
					expect.objectContaining({ name: 'frames__proof', kind: 'directory' })
				])
			);
		} finally {
			await browserRoot.removeEntry(workspaceName, { recursive: true });
		}
	});
});
