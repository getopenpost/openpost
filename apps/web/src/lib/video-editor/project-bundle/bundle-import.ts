import { Unzip, UnzipInflate, UnzipPassThrough, type UnzipFile } from 'fflate';
import { bytesToHex } from '@noble/hashes/utils';
import { resolveMediaBlob } from '../media/resolve-media-blob';
import type { MediaMetadata } from '../media/types';
import { openBlobWriter, writeBlob } from '../workspace-fs/fs-primitives';
import { createMedia, deleteMedia, getAllMedia } from '../workspace-fs/media';
import {
	mediaSourceByFileName,
	projectThumbnailPath,
	sanitizeWorkspaceFileName
} from '../workspace-fs/paths';
import { deleteProject } from '../workspace-fs/projects';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import {
	PROJECT_BUNDLE_COVER_PATH,
	PROJECT_BUNDLE_MANIFEST_PATH,
	PROJECT_BUNDLE_SNAPSHOT_PATH,
	type BundleImportResult,
	type BundleMediaEntry,
	type BundleMediaWriter,
	type BundleProgress,
	type ProjectBundleManifest
} from './bundle-types';
import {
	createSha256,
	hashBlob,
	isSafeBundlePath,
	sha256Hex,
	throwIfBundleAborted,
	validateBundleManifest
} from './bundle-utils';
import { importProjectSnapshot, type SnapshotImportOptions } from './snapshot-service';
import type { JsonValue, ProjectSnapshot, SnapshotImportResult } from './snapshot-types';
import { validateProjectSnapshot } from './snapshot-utils';

const MAX_BUNDLE_BYTES = 1024 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
const MAX_COVER_BYTES = 32 * 1024 * 1024;
const MAX_BUNDLE_FILES = 100_003;

export interface BundleImportRuntime {
	getAllMedia(): Promise<MediaMetadata[]>;
	resolveMediaBlob(media: MediaMetadata): Promise<Blob>;
	openMediaWriter(mediaId: string, fileName: string): Promise<BundleMediaWriter>;
	createMedia(metadata: MediaMetadata): Promise<MediaMetadata>;
	deleteMedia(mediaId: string): Promise<void>;
	importSnapshot(
		snapshot: ProjectSnapshot,
		options: SnapshotImportOptions
	): Promise<SnapshotImportResult>;
	deleteProject(projectId: string): Promise<void>;
	writeProjectThumbnail(projectId: string, thumbnail: Blob): Promise<void>;
}

function parseJson(bytes: Uint8Array, label: string): JsonValue {
	try {
		// SAFETY: JSON.parse only returns JSON primitives, arrays, and objects.
		return JSON.parse(new TextDecoder().decode(bytes)) as JsonValue;
	} catch (error) {
		throw new Error(`${label} is not valid JSON.`, { cause: error });
	}
}

function combineChunks(chunks: Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function mediaFromEntry(entry: BundleMediaEntry, id: string, fileName: string): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		contentHash: entry.sha256,
		fileName,
		fileSize: entry.fileSize,
		mimeType: entry.mimeType,
		...entry.metadata
	};
}

export function createBundleImportService(runtime: BundleImportRuntime) {
	async function importProjectBundle(
		file: File,
		options: { name?: string; signal?: AbortSignal } = {},
		onProgress?: (progress: BundleProgress) => void
	): Promise<BundleImportResult> {
		const { signal } = options;
		throwIfBundleAborted(signal);
		if (file.size > MAX_BUNDLE_BYTES) throw new Error('Project bundle is larger than 1 TB.');
		const existingMedia = await runtime.getAllMedia();
		const existingByHash = new Map(
			existingMedia.flatMap((media) => (media.contentHash ? [[media.contentHash, media]] : []))
		);
		const allocatedMediaIds: string[] = [];
		const createdMediaIds: string[] = [];
		const mediaIdMap = new Map<string, string>();
		let manifest: ProjectBundleManifest | undefined;
		let snapshot: ProjectSnapshot | undefined;
		let cover: Uint8Array<ArrayBuffer> | undefined;
		let importedProjectId: string | undefined;
		let mediaImported = 0;
		let mediaReused = 0;
		let extractedMediaBytes = 0;
		let declaredMediaBytes = 0;
		let discoveredFiles = 0;
		let entryFailure: Error | undefined;
		let setupQueue = Promise.resolve();
		let writeQueue = Promise.resolve();
		let manifestSettled = false;
		const seenPaths = new Set<string>();
		const activeEntries = new Set<UnzipFile>();
		const activeWriters = new Set<BundleMediaWriter>();
		const entryCompletions: Promise<void>[] = [];
		let manifestEntriesByPath = new Map<string, BundleMediaEntry[]>();

		function fail(error: Error): void {
			entryFailure ??= error;
		}

		function enqueueWrite(task: () => Promise<void>): void {
			writeQueue = writeQueue
				.then(async () => {
					if (entryFailure) return;
					await task();
				})
				.catch((error) => {
					fail(error instanceof Error ? error : new Error(String(error)));
				});
		}

		function stopActiveEntries(): void {
			for (const entry of activeEntries) entry.terminate();
			activeEntries.clear();
		}

		function collectSmallEntry(
			zipFile: UnzipFile,
			maxBytes: number,
			onComplete: (bytes: Uint8Array<ArrayBuffer>) => void,
			onSettled?: () => void
		): void {
			const chunks: Uint8Array[] = [];
			let size = 0;
			let settled = false;
			let resolveCompletion = (): void => undefined;
			const completion = new Promise<void>((resolve) => {
				resolveCompletion = resolve;
			});
			entryCompletions.push(completion);
			activeEntries.add(zipFile);

			function settle(): void {
				if (settled) return;
				settled = true;
				activeEntries.delete(zipFile);
				onSettled?.();
				resolveCompletion();
			}

			zipFile.ondata = (error, chunk, final) => {
				if (error) {
					fail(error);
					settle();
					return;
				}
				if (signal?.aborted) {
					try {
						throwIfBundleAborted(signal);
					} catch (abortError) {
						fail(abortError instanceof Error ? abortError : new Error(String(abortError)));
					}
					zipFile.terminate();
					settle();
					return;
				}
				size += chunk.byteLength;
				if (size > maxBytes) {
					fail(new Error(`Bundle entry is too large: ${zipFile.name}`));
					zipFile.terminate();
					settle();
					return;
				}
				chunks.push(chunk.slice());
				if (final) {
					try {
						onComplete(combineChunks(chunks, size));
					} catch (completionError) {
						fail(
							completionError instanceof Error
								? completionError
								: new Error(String(completionError))
						);
					}
					settle();
				}
			};
			zipFile.start();
		}

		async function prepareMediaEntry(
			zipFile: UnzipFile,
			entries: BundleMediaEntry[]
		): Promise<void> {
			const entry = entries[0];
			if (!entry) throw new Error(`Bundle has no manifest entry for ${zipFile.name}`);
			const reusableCandidate = existingByHash.get(entry.sha256);
			const reusable = reusableCandidate
				? await runtime
						.resolveMediaBlob(reusableCandidate)
						.then(async (blob) =>
							blob.size === entry.fileSize &&
							(await hashBlob(blob, undefined, signal)) === entry.sha256
								? reusableCandidate
								: undefined
						)
						.catch(() => {
							throwIfBundleAborted(signal);
							return undefined;
						})
				: undefined;
			const newMediaId = reusable ? undefined : crypto.randomUUID();
			const fileName = sanitizeWorkspaceFileName(entry.fileName);
			const writer = newMediaId ? await runtime.openMediaWriter(newMediaId, fileName) : undefined;
			if (newMediaId) allocatedMediaIds.push(newMediaId);
			if (writer) activeWriters.add(writer);
			const hash = createSha256();
			let size = 0;
			activeEntries.add(zipFile);
			zipFile.ondata = (error, chunk, final) => {
				if (error) {
					fail(error);
					activeEntries.delete(zipFile);
					return;
				}
				if (signal?.aborted) {
					try {
						throwIfBundleAborted(signal);
					} catch (abortError) {
						fail(abortError instanceof Error ? abortError : new Error(String(abortError)));
					}
					zipFile.terminate();
					activeEntries.delete(zipFile);
					return;
				}
				size += chunk.byteLength;
				extractedMediaBytes += chunk.byteLength;
				if (size > entry.fileSize) {
					fail(new Error(`Media size does not match the manifest: ${entry.fileName}`));
					zipFile.terminate();
					return;
				}
				hash.update(chunk);
				if (writer) enqueueWrite(() => writer.write(chunk));
				onProgress?.({
					stage: 'extracting',
					percent:
						declaredMediaBytes === 0 ? 85 : 10 + (extractedMediaBytes / declaredMediaBytes) * 75,
					currentFile: entry.fileName,
					completedBytes: extractedMediaBytes,
					totalBytes: declaredMediaBytes
				});
				if (!final) return;
				activeEntries.delete(zipFile);
				enqueueWrite(async () => {
					if (size !== entry.fileSize || bytesToHex(hash.digest()) !== entry.sha256) {
						if (writer) {
							await writer.abort(new Error('Bundle media integrity check failed.'));
							activeWriters.delete(writer);
						}
						throw new Error(`Media checksum does not match: ${entry.fileName}`);
					}
					if (reusable) {
						for (const linked of entries) mediaIdMap.set(linked.originalId, reusable.id);
						mediaReused += entries.length;
						return;
					}
					if (!writer || !newMediaId) throw new Error('Bundle media writer was not created.');
					await writer.close();
					activeWriters.delete(writer);
					await runtime.createMedia(mediaFromEntry(entry, newMediaId, fileName));
					createdMediaIds.push(newMediaId);
					for (const linked of entries) mediaIdMap.set(linked.originalId, newMediaId);
					mediaImported += entries.length;
				});
			};
			zipFile.start();
		}

		async function prepareEntry(zipFile: UnzipFile): Promise<void> {
			discoveredFiles += 1;
			if (discoveredFiles > MAX_BUNDLE_FILES) throw new Error('Project bundle has too many files.');
			if (!isSafeBundlePath(zipFile.name)) throw new Error(`Unsafe bundle path: ${zipFile.name}`);
			if (seenPaths.has(zipFile.name)) throw new Error(`Bundle repeats file: ${zipFile.name}`);
			seenPaths.add(zipFile.name);
			if (zipFile.compression !== 0 && zipFile.compression !== 8) {
				throw new Error(`Unsupported ZIP compression for ${zipFile.name}`);
			}
			onProgress?.({ stage: 'extracting', percent: 10, currentFile: zipFile.name });

			if (zipFile.name === PROJECT_BUNDLE_MANIFEST_PATH) {
				if (discoveredFiles !== 1) throw new Error('Bundle manifest must be the first file.');
				collectSmallEntry(
					zipFile,
					MAX_MANIFEST_BYTES,
					(bytes) => {
						manifest = validateBundleManifest(parseJson(bytes, 'Bundle manifest'));
						declaredMediaBytes = [
							...new Map(manifest.media.map((entry) => [entry.relativePath, entry])).values()
						].reduce((total, entry) => total + entry.fileSize, 0);
						const totalDeclared =
							manifest.project.fileSize + (manifest.cover?.fileSize ?? 0) + declaredMediaBytes;
						if (totalDeclared > MAX_BUNDLE_BYTES)
							throw new Error('Bundle contents are larger than 1 TB.');
						manifestEntriesByPath = new Map();
						for (const entry of manifest.media) {
							const entries = manifestEntriesByPath.get(entry.relativePath) ?? [];
							entries.push(entry);
							manifestEntriesByPath.set(entry.relativePath, entries);
						}
					},
					() => {
						manifestSettled = true;
					}
				);
				return;
			}

			if (!manifest) throw new Error('Bundle manifest must finish before other files.');
			if (zipFile.name === manifest.project.relativePath) {
				collectSmallEntry(zipFile, MAX_PROJECT_BYTES, (bytes) => {
					if (
						bytes.byteLength !== manifest?.project.fileSize ||
						sha256Hex(bytes) !== manifest.project.sha256
					) {
						throw new Error('Project snapshot checksum does not match.');
					}
					const validation = validateProjectSnapshot(parseJson(bytes, 'Project snapshot'));
					if (!validation.snapshot) throw new Error(validation.errors.join('\n'));
					snapshot = validation.snapshot;
				});
				return;
			}
			if (manifest.cover && zipFile.name === manifest.cover.relativePath) {
				collectSmallEntry(zipFile, MAX_COVER_BYTES, (bytes) => {
					if (
						bytes.byteLength !== manifest?.cover?.fileSize ||
						sha256Hex(bytes) !== manifest.cover.sha256
					) {
						throw new Error('Project cover checksum does not match.');
					}
					cover = bytes;
				});
				return;
			}
			const mediaEntries = manifestEntriesByPath.get(zipFile.name);
			if (!mediaEntries) throw new Error(`Bundle contains an unexpected file: ${zipFile.name}`);
			if (zipFile.compression !== 0) {
				throw new Error(`Bundle media must be stored without ZIP compression: ${zipFile.name}`);
			}
			await prepareMediaEntry(zipFile, mediaEntries);
		}

		const unzip = new Unzip((zipFile) => {
			setupQueue = setupQueue
				.then(() => prepareEntry(zipFile))
				.catch((error) => {
					fail(error instanceof Error ? error : new Error(String(error)));
				});
		});
		unzip.register(UnzipPassThrough);
		unzip.register(UnzipInflate);

		try {
			onProgress?.({ stage: 'validating', percent: 0 });
			const reader = file.stream().getReader();
			let readBytes = 0;
			try {
				while (true) {
					throwIfBundleAborted(signal);
					const { done, value } = await reader.read();
					if (done) break;
					readBytes += value.byteLength;
					unzip.push(value, false);
					if (manifestSettled) {
						await setupQueue;
						await writeQueue;
						if (entryFailure) throw entryFailure;
					} else {
						onProgress?.({
							stage: 'validating',
							percent: Math.min(9, (readBytes / Math.max(file.size, 1)) * 10),
							completedBytes: readBytes,
							totalBytes: file.size
						});
					}
				}
				unzip.push(new Uint8Array(), true);
				await setupQueue;
				await Promise.all(entryCompletions);
				await writeQueue;
				if (entryFailure) throw entryFailure;
				throwIfBundleAborted(signal);
			} catch (error) {
				await reader.cancel(error).catch(() => undefined);
				throw error;
			} finally {
				reader.releaseLock();
			}

			if (!manifest) throw new Error('Bundle is missing manifest.json.');
			if (!snapshot) throw new Error('Bundle is missing the project snapshot.');
			if (snapshot.project.id !== manifest.projectId) {
				throw new Error('Bundle project id does not match its manifest.');
			}
			for (const path of manifestEntriesByPath.keys()) {
				if (!seenPaths.has(path)) throw new Error(`Bundle is missing media: ${path}`);
			}
			if (manifest.cover && !seenPaths.has(manifest.cover.relativePath)) {
				throw new Error('Bundle is missing its project cover.');
			}

			onProgress?.({ stage: 'linking', percent: 90 });
			const imported = await runtime.importSnapshot(snapshot, {
				name: options.name,
				mediaIdMap,
				matchMediaByHash: false,
				matchMediaByName: false
			});
			importedProjectId = imported.project.id;
			if (cover) {
				await runtime.writeProjectThumbnail(
					imported.project.id,
					new Blob([cover], { type: 'image/jpeg' })
				);
			}
			onProgress?.({ stage: 'complete', percent: 100 });
			return {
				projectId: imported.project.id,
				projectName: imported.project.name,
				mediaImported,
				mediaReused
			};
		} catch (error) {
			const cause = error instanceof Error ? error : new Error(String(error));
			stopActiveEntries();
			const cleanupErrors: Error[] = [];
			for (const writer of activeWriters) {
				await writer.abort(cause).catch((cleanupError) => {
					cleanupErrors.push(
						cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))
					);
				});
			}
			activeWriters.clear();
			if (importedProjectId) {
				await runtime.deleteProject(importedProjectId).catch((cleanupError) => {
					cleanupErrors.push(
						cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))
					);
				});
			}
			for (const mediaId of [...new Set([...allocatedMediaIds, ...createdMediaIds])]) {
				await runtime.deleteMedia(mediaId).catch((cleanupError) => {
					cleanupErrors.push(
						cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))
					);
				});
			}
			if (cleanupErrors.length > 0) {
				throw new AggregateError(
					[cause, ...cleanupErrors],
					'Bundle import failed and some partial files could not be removed.'
				);
			}
			throw cause;
		}
	}

	return { importProjectBundle };
}

const productionRuntime: BundleImportRuntime = {
	getAllMedia,
	resolveMediaBlob,
	openMediaWriter: (mediaId, fileName) =>
		openBlobWriter(requireWorkspaceRoot(), mediaSourceByFileName(mediaId, fileName)),
	createMedia,
	deleteMedia,
	importSnapshot: importProjectSnapshot,
	deleteProject,
	writeProjectThumbnail: (projectId, thumbnail) =>
		writeBlob(requireWorkspaceRoot(), projectThumbnailPath(projectId), thumbnail)
};

export const { importProjectBundle } = createBundleImportService(productionRuntime);
