import { expect, it, vi } from 'vitest';
import { createBlankProject } from '../project/defaults';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import {
	renderImageSequenceFrames,
	renderImageSequenceToDirectoryHandle,
	renderImageSequenceToWorkspace,
	renderImageSequenceZip
} from './image-sequence-export';

function sequenceProject() {
	const project = createBlankProject('Sequence lifecycle');
	project.metadata = { width: 16, height: 16, fps: 30 };
	project.duration = 1 / 30;
	project.timeline!.items = [
		{
			id: 'square',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#ff0000',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 1,
			label: 'Square'
		}
	];
	return project;
}

async function entryNames(directory: FileSystemDirectoryHandle) {
	const names: string[] = [];
	for await (const [name] of directory.entries()) names.push(name);
	return names.sort();
}

it.each(['directory', 'workspace'] as const)(
	'removes incomplete %s sequence files after a disk write fails',
	async (destination) => {
		const browserRoot = await navigator.storage.getDirectory();
		const name = `sequence-failure-${crypto.randomUUID()}`;
		const root = await browserRoot.getDirectoryHandle(name, { create: true });
		const previousRoot = getWorkspaceRoot();
		setWorkspaceRoot(root);
		const project = sequenceProject();
		const projectDir = await root.getDirectoryHandle('projects', { create: true });
		const ownedProject = await projectDir.getDirectoryHandle(project.id, { create: true });
		const exports = await ownedProject.getDirectoryHandle('exports', { create: true });
		const destinationRoot = destination === 'directory' ? root : exports;
		await destinationRoot.getDirectoryHandle('older-export', { create: true });
		const streams: FileSystemWritableFileStream[] = [];
		const createWritable = FileSystemFileHandle.prototype.createWritable;
		const capture = vi
			.spyOn(FileSystemFileHandle.prototype, 'createWritable')
			.mockImplementation(async function (this: FileSystemFileHandle, options) {
				const stream = await createWritable.call(this, options);
				streams.push(stream);
				return stream;
			});
		const write = vi
			.spyOn(FileSystemWritableFileStream.prototype, 'write')
			.mockRejectedValue(new DOMException('Disk full', 'QuotaExceededError'));
		try {
			const render =
				destination === 'directory'
					? renderImageSequenceToDirectoryHandle(root, project, { format: 'png' })
					: renderImageSequenceToWorkspace(project, { format: 'png' });
			await expect(render).rejects.toThrow();
			expect(await entryNames(destinationRoot)).toEqual(
				destination === 'directory' ? ['older-export', 'projects'] : ['older-export']
			);
		} finally {
			write.mockRestore();
			capture.mockRestore();
			for (const stream of streams) await stream.abort().catch(() => undefined);
			setWorkspaceRoot(previousRoot);
			await browserRoot.removeEntry(name, { recursive: true });
		}
	}
);

it.each(['directory', 'workspace', 'zip'] as const)(
	'does not report or retain a %s export cancelled at finalization',
	async (destination) => {
		const browserRoot = await navigator.storage.getDirectory();
		const name = `sequence-cancel-${crypto.randomUUID()}`;
		const root = await browserRoot.getDirectoryHandle(name, { create: true });
		const previousRoot = getWorkspaceRoot();
		setWorkspaceRoot(root);
		const project = sequenceProject();
		const controller = new AbortController();
		const options = {
			format: 'png' as const,
			signal: controller.signal,
			onProgress: ({ phase }: { phase: string }) => {
				if (phase === 'finalizing') controller.abort();
			}
		};
		try {
			const render =
				destination === 'directory'
					? renderImageSequenceToDirectoryHandle(root, project, options)
					: destination === 'workspace'
						? renderImageSequenceToWorkspace(project, options)
						: renderImageSequenceZip(project, options);
			await expect(render).rejects.toMatchObject({ name: 'AbortError' });
			if (destination === 'directory') expect(await entryNames(root)).toEqual([]);
			else {
				const projects = await root.getDirectoryHandle('projects', { create: true });
				const folder = await projects.getDirectoryHandle(project.id, { create: true });
				const exports = await folder.getDirectoryHandle('exports', { create: true });
				expect(await entryNames(exports)).toEqual([]);
			}
		} finally {
			setWorkspaceRoot(previousRoot);
			await browserRoot.removeEntry(name, { recursive: true });
		}
	}
);

it('does not yield a frame cancelled while encoding its image', async () => {
	const controller = new AbortController();
	const convert = OffscreenCanvas.prototype.convertToBlob;
	const encoding = vi
		.spyOn(OffscreenCanvas.prototype, 'convertToBlob')
		.mockImplementation(async function (this: OffscreenCanvas, options) {
			const blob = await convert.call(this, options);
			controller.abort();
			return blob;
		});
	try {
		const frames = renderImageSequenceFrames(sequenceProject(), {
			format: 'png',
			signal: controller.signal
		});
		try {
			await expect(frames.next()).rejects.toMatchObject({ name: 'AbortError' });
		} finally {
			await frames.return(undefined);
		}
	} finally {
		encoding.mockRestore();
	}
});

it.each(['cancel', 'disk-full'] as const)(
	'removes an unfinished ZIP after %s during its final disk write',
	async (failure) => {
		const browserRoot = await navigator.storage.getDirectory();
		const name = `sequence-zip-${crypto.randomUUID()}`;
		const root = await browserRoot.getDirectoryHandle(name, { create: true });
		const previousRoot = getWorkspaceRoot();
		setWorkspaceRoot(root);
		const project = sequenceProject();
		const projects = await root.getDirectoryHandle('projects', { create: true });
		const folder = await projects.getDirectoryHandle(project.id, { create: true });
		const exports = await folder.getDirectoryHandle('exports', { create: true });
		const existing = await exports.getFileHandle('Sequence lifecycle.zip', { create: true });
		const oldWriter = await existing.createWritable();
		await oldWriter.write('previous export');
		await oldWriter.close();
		const controller = new AbortController();
		const streams: FileSystemWritableFileStream[] = [];
		const createWritable = FileSystemFileHandle.prototype.createWritable;
		const capture = vi
			.spyOn(FileSystemFileHandle.prototype, 'createWritable')
			.mockImplementation(async function (this: FileSystemFileHandle, options) {
				const stream = await createWritable.call(this, options);
				streams.push(stream);
				return stream;
			});
		const write = FileSystemWritableFileStream.prototype.write;
		const failureInjection = vi
			.spyOn(FileSystemWritableFileStream.prototype, 'write')
			.mockImplementation(async function (this: FileSystemWritableFileStream, data) {
				if (failure === 'disk-full') throw new DOMException('Disk full', 'QuotaExceededError');
				await write.call(this, data);
				controller.abort();
			});
		try {
			const render = renderImageSequenceZip(project, { format: 'png', signal: controller.signal });
			if (failure === 'cancel') await expect(render).rejects.toMatchObject({ name: 'AbortError' });
			else {
				// A failed optional save still leaves the completed ZIP available for download.
				const result = await render;
				expect(result.savedToWorkspace).toBe(false);
				expect(result.blob.size).toBeGreaterThan(0);
			}
			expect(await entryNames(exports)).toEqual(['Sequence lifecycle.zip']);
			expect(await (await existing.getFile()).text()).toBe('previous export');
		} finally {
			failureInjection.mockRestore();
			capture.mockRestore();
			for (const stream of streams) await stream.abort().catch(() => undefined);
			setWorkspaceRoot(previousRoot);
			await browserRoot.removeEntry(name, { recursive: true });
		}
	}
);
