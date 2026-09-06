import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { MediaMetadata } from '../media/types';
import { resolveMediaBlob } from '../media/resolve-media-blob';
import { readBlob } from '../workspace-fs/fs-primitives';
import { getMedia } from '../workspace-fs/media';
import { getProjectMediaIds } from '../workspace-fs/project-media';
import { projectThumbnailPath } from '../workspace-fs/paths';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import {
	PROJECT_BUNDLE_COVER_PATH,
	PROJECT_BUNDLE_MANIFEST_PATH,
	PROJECT_BUNDLE_SNAPSHOT_PATH,
	PROJECT_BUNDLE_VERSION,
	type BundleExportResult,
	type BundleFileEntry,
	type BundleMediaEntry,
	type BundleOutput,
	type BundleProgress,
	type ProjectBundleManifest
} from './bundle-types';
import {
	bundleMediaPath,
	computeBundleManifestChecksum,
	hashBlob,
	sanitizeBundleFileName,
	sha256Hex,
	throwIfBundleAborted
} from './bundle-utils';
import { exportProjectSnapshot } from './snapshot-service';
import { m } from '$lib/paraglide/messages';

const MAX_IN_MEMORY_BUNDLE_BYTES = 1024 * 1024 * 1024;

interface PreparedBundleMedia {
	metadata: MediaMetadata;
	blob: Blob;
	hash: string;
	relativePath: string;
}

export interface BundleExportRuntime {
	exportSnapshot(projectId: string): ReturnType<typeof exportProjectSnapshot>;
	getProjectMediaIds(projectId: string): Promise<string[]>;
	getMedia(mediaId: string): Promise<MediaMetadata | undefined>;
	resolveMediaBlob(media: MediaMetadata): Promise<Blob>;
	readProjectThumbnail(projectId: string): Promise<Blob | null>;
}

function mediaManifestEntry(prepared: PreparedBundleMedia): BundleMediaEntry {
	const { metadata, hash, relativePath, blob } = prepared;
	return {
		originalId: metadata.id,
		relativePath,
		fileName: metadata.fileName,
		fileSize: blob.size,
		sha256: hash,
		mimeType: metadata.mimeType,
		metadata: {
			duration: metadata.duration,
			width: metadata.width,
			height: metadata.height,
			fps: metadata.fps,
			codec: metadata.codec,
			bitrate: metadata.bitrate,
			audioCodec: metadata.audioCodec,
			audioCodecSupported: metadata.audioCodecSupported,
			videoCodecSupported: metadata.videoCodecSupported,
			keyframeTimestamps: metadata.keyframeTimestamps,
			gopInterval: metadata.gopInterval,
			lottieTotalFrames: metadata.lottieTotalFrames,
			lottieMarkers: metadata.lottieMarkers,
			attribution: metadata.attribution,
			tags: metadata.tags
		}
	};
}

function addBytes(zip: Zip, path: string, bytes: Uint8Array, compress: boolean): void {
	const entry = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
	zip.add(entry);
	entry.push(bytes, true);
}

export function createBundleExportService(runtime: BundleExportRuntime) {
	async function exportProjectBundle(
		projectId: string,
		output: BundleOutput,
		onProgress?: (progress: BundleProgress) => void,
		signal?: AbortSignal
	): Promise<BundleExportResult> {
		let zipFailure: Error | undefined;
		let outputSize = 0;
		let pendingWrite = Promise.resolve();
		const zip = new Zip((error, chunk) => {
			if (error) {
				zipFailure = error;
				return;
			}
			if (chunk.byteLength === 0) return;
			outputSize += chunk.byteLength;
			pendingWrite = pendingWrite.then(async () => {
				if (zipFailure) return;
				try {
					throwIfBundleAborted(signal);
					await output.write(chunk);
				} catch (error) {
					zipFailure = error instanceof Error ? error : new Error(String(error));
				}
			});
		});

		async function flushOutput(): Promise<void> {
			await pendingWrite;
			if (zipFailure) throw zipFailure;
			throwIfBundleAborted(signal);
		}

		try {
			throwIfBundleAborted(signal);
			onProgress?.({ stage: 'collecting', percent: 0 });
			const snapshot = await runtime.exportSnapshot(projectId);
			throwIfBundleAborted(signal);
			const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
			const mediaIds = [...new Set(await runtime.getProjectMediaIds(projectId))];
			const collected: Array<{ metadata: MediaMetadata; blob: Blob }> = [];
			for (const mediaId of mediaIds) {
				throwIfBundleAborted(signal);
				const metadata = await runtime.getMedia(mediaId);
				if (!metadata) throw new Error(`Project media is missing: ${mediaId}`);
				const blob = await runtime.resolveMediaBlob(metadata);
				if (blob.size !== metadata.fileSize) {
					throw new Error(`Source changed since import: ${metadata.fileName}`);
				}
				collected.push({ metadata, blob });
			}

			const totalMediaBytes = collected.reduce((total, item) => total + item.blob.size, 0);
			let hashedBytes = 0;
			const prepared: PreparedBundleMedia[] = [];
			const pathByHash = new Map<string, string>();
			for (const item of collected) {
				onProgress?.({
					stage: 'hashing',
					percent: totalMediaBytes === 0 ? 35 : 5 + (hashedBytes / totalMediaBytes) * 30,
					currentFile: item.metadata.fileName,
					completedBytes: hashedBytes,
					totalBytes: totalMediaBytes
				});
				const hash = await hashBlob(
					item.blob,
					(bytes) => {
						hashedBytes += bytes;
						onProgress?.({
							stage: 'hashing',
							percent: totalMediaBytes === 0 ? 35 : 5 + (hashedBytes / totalMediaBytes) * 30,
							currentFile: item.metadata.fileName,
							completedBytes: hashedBytes,
							totalBytes: totalMediaBytes
						});
					},
					signal
				);
				const relativePath = pathByHash.get(hash) ?? bundleMediaPath(hash, item.metadata.fileName);
				pathByHash.set(hash, relativePath);
				prepared.push({ ...item, hash, relativePath });
			}

			const projectEntry: BundleFileEntry = {
				relativePath: PROJECT_BUNDLE_SNAPSHOT_PATH,
				fileSize: snapshotBytes.byteLength,
				sha256: sha256Hex(snapshotBytes)
			};
			const cover = await runtime.readProjectThumbnail(projectId);
			const coverEntry: BundleFileEntry | undefined = cover
				? {
						relativePath: PROJECT_BUNDLE_COVER_PATH,
						fileSize: cover.size,
						sha256: await hashBlob(cover, undefined, signal)
					}
				: undefined;
			const manifest: ProjectBundleManifest = {
				version: PROJECT_BUNDLE_VERSION,
				createdAt: new Date().toISOString(),
				editorVersion: snapshot.editorVersion,
				projectId: snapshot.project.id,
				projectName: snapshot.project.name,
				project: projectEntry,
				media: prepared.map(mediaManifestEntry),
				...(coverEntry && { cover: coverEntry }),
				checksum: ''
			};
			manifest.checksum = computeBundleManifestChecksum(manifest);

			onProgress?.({ stage: 'packaging', percent: 40, totalBytes: totalMediaBytes });
			addBytes(
				zip,
				PROJECT_BUNDLE_MANIFEST_PATH,
				new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
				true
			);
			addBytes(zip, PROJECT_BUNDLE_SNAPSHOT_PATH, snapshotBytes, true);
			if (cover)
				addBytes(zip, PROJECT_BUNDLE_COVER_PATH, new Uint8Array(await cover.arrayBuffer()), false);
			await flushOutput();

			let packagedBytes = 0;
			const writtenPaths = new Set<string>();
			const totalPackagedBytes = [
				...new Map(prepared.map((item) => [item.relativePath, item])).values()
			].reduce((total, item) => total + item.blob.size, 0);
			for (const item of prepared) {
				if (writtenPaths.has(item.relativePath)) continue;
				writtenPaths.add(item.relativePath);
				const entry = new ZipPassThrough(item.relativePath);
				zip.add(entry);
				const reader = item.blob.stream().getReader();
				try {
					while (true) {
						throwIfBundleAborted(signal);
						const { done, value } = await reader.read();
						if (done) break;
						entry.push(value, false);
						packagedBytes += value.byteLength;
						await flushOutput();
						onProgress?.({
							stage: 'packaging',
							percent:
								totalPackagedBytes === 0 ? 95 : 40 + (packagedBytes / totalPackagedBytes) * 55,
							currentFile: item.metadata.fileName,
							completedBytes: packagedBytes,
							totalBytes: totalPackagedBytes
						});
					}
					entry.push(new Uint8Array(), true);
					await flushOutput();
				} finally {
					reader.releaseLock();
				}
			}

			zip.end();
			await flushOutput();
			await output.close();
			onProgress?.({ stage: 'complete', percent: 100 });
			return {
				fileName: sanitizeBundleFileName(snapshot.project.name),
				size: outputSize,
				mediaCount: prepared.length
			};
		} catch (error) {
			const cause = error instanceof Error ? error : new Error(String(error));
			zip.terminate();
			try {
				await output.abort(cause);
			} catch (cleanupError) {
				throw new AggregateError(
					[cause, cleanupError],
					'Bundle export failed and the partial output could not be removed.'
				);
			}
			throw cause;
		}
	}

	return { exportProjectBundle };
}

const productionRuntime: BundleExportRuntime = {
	exportSnapshot: exportProjectSnapshot,
	getProjectMediaIds,
	getMedia,
	resolveMediaBlob,
	readProjectThumbnail: (projectId) =>
		readBlob(requireWorkspaceRoot(), projectThumbnailPath(projectId))
};

export const { exportProjectBundle } = createBundleExportService(productionRuntime);

export async function createProjectBundleBlob(
	projectId: string,
	onProgress?: (progress: BundleProgress) => void,
	signal?: AbortSignal
): Promise<{ result: BundleExportResult; blob: Blob }> {
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let size = 0;
	const output: BundleOutput = {
		write: async (chunk) => {
			size += chunk.byteLength;
			if (size > MAX_IN_MEMORY_BUNDLE_BYTES) {
				throw new Error('This project is too large for an in-memory browser download.');
			}
			const owned = new Uint8Array(chunk.byteLength);
			owned.set(chunk);
			chunks.push(owned);
		},
		close: async () => undefined,
		abort: async () => {
			chunks.length = 0;
		}
	};
	const result = await exportProjectBundle(projectId, output, onProgress, signal);
	return { result, blob: new Blob(chunks, { type: 'application/zip' }) };
}

export async function saveProjectBundle(
	projectId: string,
	projectName: string,
	onProgress?: (progress: BundleProgress) => void,
	signal?: AbortSignal
): Promise<BundleExportResult> {
	throwIfBundleAborted(signal);
	const fileName = sanitizeBundleFileName(projectName);
	if (window.showSaveFilePicker) {
		const handle = await window.showSaveFilePicker({
			suggestedName: fileName,
			types: [
				{
					description: m.video_editor_project_bundle_file_type(),
					accept: { 'application/zip': ['.zip'] }
				}
			]
		});
		const writable = await handle.createWritable();
		const output: BundleOutput = {
			write: (chunk) => {
				// SAFETY: FileSystemWritableFileStream accepts Uint8Array bytes as a write chunk.
				return writable.write(chunk as Uint8Array<ArrayBuffer>);
			},
			close: () => writable.close(),
			abort: (reason) => writable.abort(reason)
		};
		return exportProjectBundle(projectId, output, onProgress, signal);
	}

	const { result, blob } = await createProjectBundleBlob(projectId, onProgress, signal);
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = result.fileName;
	link.style.display = 'none';
	document.body.append(link);
	try {
		link.click();
	} finally {
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}
	return result;
}
