import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '../media/types';
import { createBlankProject } from '../project/defaults';
import type { Project } from '../project/types';
import {
	PROJECT_BUNDLE_MANIFEST_PATH,
	type BundleMediaWriter,
	type BundleOutput,
	type ProjectBundleManifest
} from './bundle-types';
import { createBundleExportService, type BundleExportRuntime } from './bundle-export';
import { createBundleImportService, type BundleImportRuntime } from './bundle-import';
import { computeBundleManifestChecksum } from './bundle-utils';
import { PROJECT_SNAPSHOT_VERSION, type ProjectSnapshot } from './snapshot-types';
import { computeSnapshotChecksum } from './snapshot-utils';

function media(id = 'source-media'): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: 'launch.mp4',
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

async function sourceSnapshot(): Promise<ProjectSnapshot> {
	const project = createBlankProject('Launch');
	project.timeline!.items = [
		{
			id: 'clip',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 30,
			label: 'launch.mp4',
			type: 'video',
			mediaId: 'source-media'
		}
	];
	const snapshot: ProjectSnapshot = {
		version: PROJECT_SNAPSHOT_VERSION,
		exportedAt: '2026-08-24T00:00:00.000Z',
		editorVersion: 'test',
		project,
		mediaReferences: [
			{
				id: 'source-media',
				fileName: 'launch.mp4',
				fileSize: 11,
				mimeType: 'video/mp4',
				duration: 1,
				width: 1920,
				height: 1080,
				fps: 30
			}
		]
	};
	snapshot.checksum = await computeSnapshotChecksum(snapshot);
	return snapshot;
}

async function bundleBytes(): Promise<Uint8Array<ArrayBuffer>> {
	const source = new Blob(['hello video'], { type: 'video/mp4' });
	const metadata = media();
	const runtime: BundleExportRuntime = {
		exportSnapshot: sourceSnapshot,
		getProjectMediaIds: async () => [metadata.id],
		getMedia: async () => metadata,
		resolveMediaBlob: async () => source,
		readProjectThumbnail: async () => null
	};
	const chunks: Uint8Array[] = [];
	const output: BundleOutput = {
		write: async (chunk) => {
			chunks.push(chunk.slice());
		},
		close: async () => undefined,
		abort: async () => undefined
	};
	await createBundleExportService(runtime).exportProjectBundle('project', output);
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function importRuntime(existingMedia: MediaMetadata[] = []) {
	const written = new Map<string, Uint8Array[]>();
	const created: MediaMetadata[] = [];
	const deleted: string[] = [];
	const aborted: string[] = [];
	let receivedMap: ReadonlyMap<string, string> | undefined;
	const openMediaWriter = vi.fn(async (mediaId: string): Promise<BundleMediaWriter> => {
		const chunks: Uint8Array[] = [];
		written.set(mediaId, chunks);
		return {
			write: async (chunk) => {
				chunks.push(chunk.slice());
			},
			close: async () => undefined,
			abort: async () => {
				aborted.push(mediaId);
			}
		};
	});
	const runtime: BundleImportRuntime = {
		getAllMedia: async () => existingMedia,
		resolveMediaBlob: async () => new Blob(['hello video'], { type: 'video/mp4' }),
		openMediaWriter,
		createMedia: async (metadata) => {
			created.push(metadata);
			return metadata;
		},
		deleteMedia: async (mediaId) => {
			deleted.push(mediaId);
		},
		importSnapshot: async (snapshot, options) => {
			receivedMap = options.mediaIdMap;
			const project: Project = {
				...snapshot.project,
				id: 'imported-project',
				name: options.name ?? `${snapshot.project.name} imported`
			};
			return {
				project,
				matchedMedia: options.mediaIdMap?.size ?? 0,
				unmatchedMedia: [],
				warnings: []
			};
		},
		deleteProject: async () => undefined,
		writeProjectThumbnail: async () => undefined
	};
	return {
		aborted,
		created,
		deleted,
		openMediaWriter,
		receivedMap: () => receivedMap,
		runtime,
		written
	};
}

function joined(chunks: Uint8Array[]): Uint8Array {
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const owned = new Uint8Array(bytes.byteLength);
	owned.set(bytes);
	return owned;
}

function chunkedFile(bytes: Uint8Array<ArrayBuffer>, name: string, chunkSize: number): File {
	const file = new File([bytes], name, { type: 'application/zip' });
	Object.defineProperty(file, 'stream', {
		value: () =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
						controller.enqueue(bytes.slice(offset, offset + chunkSize));
					}
					controller.close();
				}
			})
	});
	return file;
}

describe('project bundle import', () => {
	it('streams verified media into fresh workspace records and links the exact id map', async () => {
		const bytes = await bundleBytes();
		const testRuntime = importRuntime();

		const result = await createBundleImportService(testRuntime.runtime).importProjectBundle(
			chunkedFile(ownedBytes(bytes), 'launch.openpost.zip', 7),
			{ name: 'Imported launch' }
		);

		expect(result).toEqual({
			projectId: 'imported-project',
			projectName: 'Imported launch',
			mediaImported: 1,
			mediaReused: 0
		});
		expect(testRuntime.created).toHaveLength(1);
		const importedMedia = testRuntime.created[0]!;
		expect(importedMedia.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(joined(testRuntime.written.get(importedMedia.id)!)).toEqual(
			new TextEncoder().encode('hello video')
		);
		expect(testRuntime.receivedMap()?.get('source-media')).toBe(importedMedia.id);
	});

	it('verifies bundled bytes while reusing existing content by hash', async () => {
		const bytes = await bundleBytes();
		const files = unzipSync(bytes);
		// SAFETY: this manifest came from the typed bundle exporter above.
		const manifest = JSON.parse(new TextDecoder().decode(files[PROJECT_BUNDLE_MANIFEST_PATH])) as {
			media: Array<{ sha256: string }>;
		};
		const existing = media('existing-media');
		existing.contentHash = manifest.media[0]!.sha256;
		const testRuntime = importRuntime([existing]);

		const result = await createBundleImportService(testRuntime.runtime).importProjectBundle(
			new File([ownedBytes(bytes)], 'launch.openpost.zip')
		);

		expect(result.mediaReused).toBe(1);
		expect(result.mediaImported).toBe(0);
		expect(testRuntime.openMediaWriter).not.toHaveBeenCalled();
		expect(testRuntime.receivedMap()?.get('source-media')).toBe('existing-media');
	});

	it('rejects changed media and removes the allocated workspace folder', async () => {
		const files = unzipSync(await bundleBytes());
		// SAFETY: this manifest came from the typed bundle exporter above.
		const manifest = JSON.parse(new TextDecoder().decode(files[PROJECT_BUNDLE_MANIFEST_PATH])) as {
			media: Array<{ relativePath: string }>;
		};
		files[manifest.media[0]!.relativePath]![0] ^= 0xff;
		const corrupted = zipSync(files, { level: 0 });
		const testRuntime = importRuntime();

		await expect(
			createBundleImportService(testRuntime.runtime).importProjectBundle(
				new File([ownedBytes(corrupted)], 'corrupt.openpost.zip')
			)
		).rejects.toThrow('checksum does not match');
		expect(testRuntime.deleted).toHaveLength(1);
		expect(testRuntime.aborted).toHaveLength(1);
		expect(testRuntime.created).toEqual([]);
	});

	it('stops queued writes and removes partial media after a workspace write fails', async () => {
		const testRuntime = importRuntime();
		const writes = vi.fn(async () => {
			throw new Error('Workspace storage is full.');
		});
		testRuntime.runtime.openMediaWriter = vi.fn(async (mediaId) => ({
			write: writes,
			close: async () => undefined,
			abort: async () => {
				testRuntime.aborted.push(mediaId);
			}
		}));

		await expect(
			createBundleImportService(testRuntime.runtime).importProjectBundle(
				new File([ownedBytes(await bundleBytes())], 'write-failure.openpost.zip')
			)
		).rejects.toThrow('Workspace storage is full.');
		expect(writes).toHaveBeenCalledOnce();
		expect(testRuntime.aborted).toHaveLength(1);
		expect(testRuntime.created).toEqual([]);
	});

	it('rejects compressed media and bundles that omit declared media', async () => {
		const files = unzipSync(await bundleBytes());
		// SAFETY: this manifest came from the typed bundle exporter above.
		const manifest = JSON.parse(new TextDecoder().decode(files[PROJECT_BUNDLE_MANIFEST_PATH])) as {
			media: Array<{ relativePath: string }>;
		};
		const compressed = zipSync(files, { level: 9 });
		const compressedRuntime = importRuntime();
		await expect(
			createBundleImportService(compressedRuntime.runtime).importProjectBundle(
				new File([ownedBytes(compressed)], 'compressed.openpost.zip')
			)
		).rejects.toThrow('must be stored without ZIP compression');
		expect(compressedRuntime.created).toEqual([]);

		delete files[manifest.media[0]!.relativePath];
		const missingRuntime = importRuntime();
		await expect(
			createBundleImportService(missingRuntime.runtime).importProjectBundle(
				new File([ownedBytes(zipSync(files, { level: 0 }))], 'missing.openpost.zip')
			)
		).rejects.toThrow('missing media');
		expect(missingRuntime.created).toEqual([]);
	});

	it('does not reuse a local file whose bytes no longer match its content hash', async () => {
		const bytes = await bundleBytes();
		const files = unzipSync(bytes);
		// SAFETY: this manifest came from the typed bundle exporter above.
		const manifest = JSON.parse(new TextDecoder().decode(files[PROJECT_BUNDLE_MANIFEST_PATH])) as {
			media: Array<{ sha256: string }>;
		};
		const existing = media('changed-existing');
		existing.contentHash = manifest.media[0]!.sha256;
		const testRuntime = importRuntime([existing]);
		testRuntime.runtime.resolveMediaBlob = async () => new Blob(['wrong bytes']);

		const result = await createBundleImportService(testRuntime.runtime).importProjectBundle(
			new File([ownedBytes(bytes)], 'launch.openpost.zip')
		);

		expect(result.mediaImported).toBe(1);
		expect(result.mediaReused).toBe(0);
		expect(testRuntime.openMediaWriter).toHaveBeenCalledOnce();
		expect(testRuntime.receivedMap()?.get('source-media')).not.toBe('changed-existing');
	});

	it('counts every logical media link when bundled bytes are deduplicated', async () => {
		const files = unzipSync(await bundleBytes());
		// SAFETY: manifest is the typed bundle manifest produced by bundleBytes(); decode is trusted.
		const manifest = JSON.parse(
			new TextDecoder().decode(files[PROJECT_BUNDLE_MANIFEST_PATH])
		) as ProjectBundleManifest;
		manifest.media.push({ ...manifest.media[0]!, originalId: 'duplicate-source-media' });
		manifest.checksum = computeBundleManifestChecksum(manifest);
		files[PROJECT_BUNDLE_MANIFEST_PATH] = new TextEncoder().encode(
			JSON.stringify(manifest, null, 2)
		);
		const testRuntime = importRuntime();

		const result = await createBundleImportService(testRuntime.runtime).importProjectBundle(
			new File([ownedBytes(zipSync(files, { level: 0 }))], 'deduplicated.openpost.zip')
		);

		expect(result.mediaImported).toBe(2);
		expect(testRuntime.created).toHaveLength(1);
		expect(testRuntime.receivedMap()?.get('source-media')).toBe(
			testRuntime.receivedMap()?.get('duplicate-source-media')
		);
	});

	it('cancels extraction and removes every partial media record', async () => {
		const bytes = await bundleBytes();
		const testRuntime = importRuntime();
		const controller = new AbortController();

		await expect(
			createBundleImportService(testRuntime.runtime).importProjectBundle(
				chunkedFile(ownedBytes(bytes), 'launch.openpost.zip', 11),
				{ signal: controller.signal },
				(progress) => {
					if (
						progress.stage === 'extracting' &&
						progress.currentFile === 'launch.mp4' &&
						progress.completedBytes
					) {
						controller.abort();
					}
				}
			)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(testRuntime.deleted).toHaveLength(1);
		expect(testRuntime.aborted).toHaveLength(1);
		expect(testRuntime.created).toEqual([]);
	});
});
