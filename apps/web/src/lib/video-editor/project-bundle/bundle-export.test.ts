import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '../media/types';
import { createBlankProject } from '../project/defaults';
import {
	PROJECT_BUNDLE_MANIFEST_PATH,
	PROJECT_BUNDLE_SNAPSHOT_PATH,
	PROJECT_BUNDLE_VERSION,
	type BundleOutput,
	type ProjectBundleManifest
} from './bundle-types';
import { createBundleExportService, type BundleExportRuntime } from './bundle-export';
import { computeBundleManifestChecksum, sha256Hex } from './bundle-utils';
import { PROJECT_SNAPSHOT_VERSION, type ProjectSnapshot } from './snapshot-types';
import { computeSnapshotChecksum } from './snapshot-utils';

function metadata(id: string, fileName: string): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName,
		fileSize: 11,
		mimeType: 'video/mp4',
		duration: 1,
		width: 1920,
		height: 1080,
		fps: 30,
		codec: 'avc1',
		bitrate: 88,
		tags: ['video']
	};
}

async function snapshot(): Promise<ProjectSnapshot> {
	const project = createBlankProject('Launch / final');
	const value: ProjectSnapshot = {
		version: PROJECT_SNAPSHOT_VERSION,
		exportedAt: '2026-08-24T00:00:00.000Z',
		editorVersion: 'test',
		project,
		mediaReferences: []
	};
	value.checksum = await computeSnapshotChecksum(value);
	return value;
}

function memoryOutput() {
	const chunks: Uint8Array[] = [];
	const abort = vi.fn(async () => undefined);
	const output: BundleOutput = {
		write: async (chunk) => {
			chunks.push(chunk.slice());
		},
		close: async () => undefined,
		abort
	};
	return {
		abort,
		bytes: () => {
			const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return bytes;
		},
		output
	};
}

describe('project bundle export', () => {
	it('streams a checksummed bundle and stores duplicate source bytes once', async () => {
		const source = new Blob(['hello video'], { type: 'video/mp4' });
		const media = [metadata('media-1', 'launch.mp4'), metadata('media-2', 'copy.mp4')];
		const runtime: BundleExportRuntime = {
			exportSnapshot: async () => snapshot(),
			getProjectMediaIds: async () => media.map((item) => item.id),
			getMedia: async (id) => media.find((item) => item.id === id),
			resolveMediaBlob: async () => source,
			readProjectThumbnail: async () => new Blob(['cover'], { type: 'image/jpeg' })
		};
		const memory = memoryOutput();
		const progress: string[] = [];

		const result = await createBundleExportService(runtime).exportProjectBundle(
			'project-1',
			memory.output,
			(update) => progress.push(update.stage)
		);

		const files = unzipSync(memory.bytes());
		// SAFETY: the export service created this manifest from a typed ProjectBundleManifest.
		const manifest = JSON.parse(
			new TextDecoder().decode(files[PROJECT_BUNDLE_MANIFEST_PATH])
		) as ProjectBundleManifest;
		expect(manifest.version).toBe(PROJECT_BUNDLE_VERSION);
		expect(manifest.checksum).toBe(computeBundleManifestChecksum(manifest));
		expect(manifest.project.sha256).toBe(sha256Hex(files[PROJECT_BUNDLE_SNAPSHOT_PATH]!));
		expect(manifest.media).toHaveLength(2);
		expect(manifest.media[0]?.relativePath).toBe(manifest.media[1]?.relativePath);
		expect(files[manifest.media[0]!.relativePath]).toEqual(
			new Uint8Array(await source.arrayBuffer())
		);
		expect(Object.keys(files).filter((path) => path.startsWith('media/'))).toHaveLength(1);
		expect(result.fileName).toBe('Launch _ final.openpost.zip');
		expect(result.mediaCount).toBe(2);
		expect(progress).toEqual(
			expect.arrayContaining(['collecting', 'hashing', 'packaging', 'complete'])
		);
	});

	it('aborts without producing a bundle when a linked source changed', async () => {
		const changed = metadata('media-1', 'launch.mp4');
		changed.fileSize = 100;
		const runtime: BundleExportRuntime = {
			exportSnapshot: async () => snapshot(),
			getProjectMediaIds: async () => [changed.id],
			getMedia: async () => changed,
			resolveMediaBlob: async () => new Blob(['changed']),
			readProjectThumbnail: async () => null
		};
		const memory = memoryOutput();

		await expect(
			createBundleExportService(runtime).exportProjectBundle('project-1', memory.output)
		).rejects.toThrow('Source changed since import');
		expect(memory.abort).toHaveBeenCalledOnce();
		expect(memory.bytes()).toHaveLength(0);
	});

	it('reports hash progress per chunk and removes partial output when canceled', async () => {
		const sourceBytes = new Uint8Array(512 * 1024);
		const source = new Blob([sourceBytes], { type: 'video/mp4' });
		const item = metadata('media-1', 'long-take.mp4');
		item.fileSize = source.size;
		const runtime: BundleExportRuntime = {
			exportSnapshot: async () => snapshot(),
			getProjectMediaIds: async () => [item.id],
			getMedia: async () => item,
			resolveMediaBlob: async () => source,
			readProjectThumbnail: async () => null
		};
		const memory = memoryOutput();
		const controller = new AbortController();
		const hashingBytes: number[] = [];

		await expect(
			createBundleExportService(runtime).exportProjectBundle(
				'project-1',
				memory.output,
				(progress) => {
					if (progress.stage !== 'hashing' || !progress.completedBytes) return;
					hashingBytes.push(progress.completedBytes);
					controller.abort();
				},
				controller.signal
			)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(hashingBytes[0]).toBeGreaterThan(0);
		expect(hashingBytes[0]).toBeLessThan(source.size);
		expect(memory.abort).toHaveBeenCalledOnce();
		expect(memory.bytes()).toHaveLength(0);
	});

	it('surfaces output failures and aborts the destination once', async () => {
		const runtime: BundleExportRuntime = {
			exportSnapshot: async () => snapshot(),
			getProjectMediaIds: async () => [],
			getMedia: async () => undefined,
			resolveMediaBlob: async () => new Blob(),
			readProjectThumbnail: async () => null
		};
		const failure = new Error('disk full');
		const abort = vi.fn(async () => undefined);
		const output: BundleOutput = {
			write: async () => {
				throw failure;
			},
			close: async () => undefined,
			abort
		};

		await expect(
			createBundleExportService(runtime).exportProjectBundle('project-1', output)
		).rejects.toBe(failure);
		expect(abort).toHaveBeenCalledOnce();
	});
});
