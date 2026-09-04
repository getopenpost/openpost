import { describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from './types';
import {
	applyMediaDirectoryRecovery,
	planMediaDirectoryRecovery,
	scanMediaRecoveryDirectory
} from './media-directory-recovery';
import type { MediaSourceIssue } from './media-recovery';

interface TestTree {
	[name: string]: File | TestTree;
}

function directory(name: string, tree: TestTree): FileSystemDirectoryHandle {
	const entries = Object.entries(tree).map(([entryName, entry]) => {
		if (entry instanceof File) {
			// SAFETY: this test file handle implements every member used by the directory scanner.
			return {
				kind: 'file',
				name: entryName,
				getFile: async () => entry
			} as FileSystemFileHandle;
		}
		return directory(entryName, entry);
	});
	// SAFETY: this test directory handle implements every member used by the directory scanner.
	return {
		kind: 'directory',
		name,
		values: async function* () {
			for (const entry of entries) yield entry;
		}
	} as FileSystemDirectoryHandle;
}

function source(
	id: string,
	fileName: string,
	fileSize: number,
	sourcePath?: string
): MediaMetadata {
	return {
		id,
		storageType: 'handle',
		fileName,
		fileSize,
		sourcePath,
		mimeType: 'video/mp4',
		duration: 1,
		width: 1920,
		height: 1080,
		fps: 30,
		codec: 'h264',
		bitrate: 1,
		tags: ['video']
	};
}

function issue(mediaId: string, fileName: string): MediaSourceIssue {
	return { mediaId, fileName, kind: 'missing' };
}

describe('media directory recovery', () => {
	it('scans nested folders and keeps stable relative paths', async () => {
		const root = directory('Shoot', {
			'poster.png': new File(['art'], 'poster.png', { type: 'image/png' }),
			camera: {
				'A.mov': new File(['camera'], 'A.mov', { type: 'video/quicktime' })
			}
		});

		const files = await scanMediaRecoveryDirectory(root);

		expect(files.map(({ path, file }) => [path, file.size])).toEqual([
			['camera/A.mov', 6],
			['poster.png', 3]
		]);
	});

	it('matches only one path or filename with the persisted size', () => {
		const media = [
			source('path', 'A.mov', 6, 'camera/A.mov'),
			source('name', 'poster.png', 3),
			{
				...source('converted', 'art.png', 10),
				sourceFileName: 'art.svg',
				sourceFileSize: 5
			},
			source('duplicate', 'voice.wav', 5),
			source('changed', 'stale.mp4', 6),
			source('gone', 'gone.mp4', 9)
		];
		const root = directory('Shoot', {});
		// SAFETY: this test file handle implements every member used by the recovery planner.
		const handle = (name: string) =>
			({ kind: 'file', name, getFile: async () => new File([], name) }) as FileSystemFileHandle;
		const candidates = [
			{ path: 'camera/A.mov', file: new File(['camera'], 'A.mov'), handle: handle('A.mov') },
			{ path: 'other/A.mov', file: new File(['camera'], 'A.mov'), handle: handle('A.mov') },
			{ path: 'poster.png', file: new File(['art'], 'poster.png'), handle: handle('poster.png') },
			{ path: 'art.svg', file: new File(['12345'], 'art.svg'), handle: handle('art.svg') },
			{
				path: 'one/voice.wav',
				file: new File(['12345'], 'voice.wav'),
				handle: handle('voice.wav')
			},
			{
				path: 'two/voice.wav',
				file: new File(['12345'], 'voice.wav'),
				handle: handle('voice.wav')
			},
			{ path: 'stale.mp4', file: new File(['1234567'], 'stale.mp4'), handle: handle('stale.mp4') }
		];

		const plan = planMediaDirectoryRecovery(
			media.map((entry) => issue(entry.id, entry.fileName)),
			media,
			candidates,
			root.name
		);

		expect(
			plan.entries.map(({ mediaId, status, candidatePath, candidatePaths }) => ({
				mediaId,
				status,
				candidatePath,
				candidatePaths
			}))
		).toEqual([
			{
				mediaId: 'path',
				status: 'exact',
				candidatePath: 'camera/A.mov',
				candidatePaths: undefined
			},
			{ mediaId: 'name', status: 'exact', candidatePath: 'poster.png', candidatePaths: undefined },
			{
				mediaId: 'converted',
				status: 'exact',
				candidatePath: 'art.svg',
				candidatePaths: undefined
			},
			{
				mediaId: 'duplicate',
				status: 'conflict',
				candidatePath: undefined,
				candidatePaths: ['one/voice.wav', 'two/voice.wav']
			},
			{
				mediaId: 'changed',
				status: 'conflict',
				candidatePath: undefined,
				candidatePaths: ['stale.mp4']
			},
			{ mediaId: 'gone', status: 'unmatched', candidatePath: undefined, candidatePaths: undefined }
		]);
	});

	it('applies exact matches only and reports individual failures', async () => {
		const first = source('first', 'first.mp4', 1);
		const second = source('second', 'second.mp4', 1);
		const conflicting = source('conflict', 'same.mp4', 1);
		const firstHandle = directory('root', {
			'first.mp4': new File(['1'], 'first.mp4'),
			'second.mp4': new File(['2'], 'second.mp4'),
			one: { 'same.mp4': new File(['3'], 'same.mp4') },
			two: { 'same.mp4': new File(['4'], 'same.mp4') }
		});
		const candidates = await scanMediaRecoveryDirectory(firstHandle);
		const plan = planMediaDirectoryRecovery(
			[
				issue('first', first.fileName),
				issue('second', second.fileName),
				issue('conflict', conflicting.fileName)
			],
			[first, second, conflicting],
			candidates,
			firstHandle.name
		);
		const recover = vi.fn(
			async (media: MediaMetadata, _handle: FileSystemFileHandle, sourcePath: string) => {
				if (media.id === 'second') throw new Error('probe failed');
				return { ...media, sourcePath };
			}
		);

		const result = await applyMediaDirectoryRecovery(plan, recover);

		expect(recover.mock.calls.map(([media, , path]) => [media.id, path])).toEqual([
			['first', 'first.mp4'],
			['second', 'second.mp4']
		]);
		expect(result).toEqual({
			restoredMediaIds: ['first'],
			failures: [{ mediaId: 'second', fileName: 'second.mp4', message: 'probe failed' }]
		});
	});
});
