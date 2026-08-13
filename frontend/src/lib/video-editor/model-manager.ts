import { sha256 } from '@noble/hashes/sha256';
import type { VideoEditorConfig } from './api';
import {
	listModelCacheMetadata,
	removeModelCacheMetadata,
	saveModelCacheMetadata
} from './storage';
import type { ModelCacheMetadata } from './types';

const TRANSFORMERS_CACHE = 'transformers-cache';
const MODEL_PARTIAL_DIRECTORY = 'model-downloads';

interface StaticModelFile {
	path: string;
	size_bytes: number;
	sha256: string;
}

interface StaticModel {
	id: string;
	kind: ModelCacheMetadata['kind'];
	version: string;
	base_path?: string;
	path?: string;
	size_bytes: number;
	sha256: string;
	files: StaticModelFile[];
}

interface StaticModelManifest {
	version: 1;
	models: StaticModel[];
}

export interface ModelDownloadProgress {
	model_id: string;
	file_name: string;
	completed_bytes: number;
	total_bytes: number;
	fraction: number;
}

export async function ensureVideoEditorModel(
	config: VideoEditorConfig,
	modelID: string,
	onProgress?: (progress: ModelDownloadProgress) => void,
	signal?: AbortSignal
): Promise<{ model: StaticModel; baseURL: string }> {
	const advertised = config.model_manifest?.find((item) => item.id === modelID);
	if (!advertised)
		throw new Error(`The ${modelID} model is not available on this OpenPost instance.`);
	const baseURL = advertised.url.replace(/\/[^/]+$/u, '');
	const response = await fetch(`${baseURL}/manifest.json`, { signal });
	if (!response.ok)
		throw new Error('The local OpenPost Video Editor model manifest could not be loaded.');
	const manifest = (await response.json()) as StaticModelManifest;
	const model = manifest.models.find((item) => item.id === modelID);
	if (!model) throw new Error(`The ${modelID} model is missing from the local model manifest.`);
	if (
		model.version !== advertised.version ||
		model.size_bytes !== advertised.size_bytes ||
		model.sha256 !== advertised.sha256
	) {
		throw new Error(
			'The advertised OpenPost Video Editor model does not match its pinned manifest.'
		);
	}

	const cache = await caches.open(TRANSFORMERS_CACHE);
	let completedBytes = 0;
	for (const file of model.files) {
		signal?.throwIfAborted();
		const url = new URL(`${baseURL}/${file.path}`, location.href).href;
		const request = new Request(url);
		const cached = await cache.match(request);
		const cachedValid =
			cached?.headers.get('X-OpenPost-SHA256') === file.sha256 &&
			Number(cached.headers.get('Content-Length')) === file.size_bytes;
		if (!cachedValid) {
			if (cached) await cache.delete(request);
			await downloadAndVerifyIntoCache(
				cache,
				request,
				file,
				modelID,
				completedBytes,
				model.size_bytes,
				onProgress,
				signal
			);
		}
		completedBytes += file.size_bytes;
		onProgress?.({
			model_id: modelID,
			file_name: file.path,
			completed_bytes: completedBytes,
			total_bytes: model.size_bytes,
			fraction: Math.min(1, completedBytes / model.size_bytes)
		});
	}
	const now = new Date().toISOString();
	await saveModelCacheMetadata({
		id: model.id,
		kind: model.kind,
		version: model.version,
		size_bytes: model.size_bytes,
		sha256: model.sha256,
		cached_at: now,
		last_used_at: now
	});
	return { model, baseURL };
}

export async function removeVideoEditorModel(
	config: VideoEditorConfig,
	modelID: string
): Promise<void> {
	const advertised = config.model_manifest?.find((item) => item.id === modelID);
	const cache = await caches.open(TRANSFORMERS_CACHE);
	if (advertised) {
		const baseURL = advertised.url.replace(/\/[^/]+$/u, '');
		const response = await fetch(`${baseURL}/manifest.json`);
		if (response.ok) {
			const manifest = (await response.json()) as StaticModelManifest;
			const model = manifest.models.find((item) => item.id === modelID);
			for (const file of model?.files ?? []) {
				await cache.delete(new URL(`${baseURL}/${file.path}`, location.href).href);
			}
		}
	}
	await removeModelCacheMetadata(modelID);
}

export async function cachedVideoEditorModels(): Promise<ModelCacheMetadata[]> {
	return await listModelCacheMetadata();
}

async function downloadAndVerifyIntoCache(
	cache: Cache,
	request: Request,
	file: StaticModelFile,
	modelID: string,
	completedBefore: number,
	totalBytes: number,
	onProgress?: (progress: ModelDownloadProgress) => void,
	signal?: AbortSignal
): Promise<void> {
	const partials = await modelPartialDirectory();
	const partialName = `${file.sha256}.partial`;
	const etagName = `${file.sha256}.etag`;
	const partialHandle = await partials.getFileHandle(partialName, { create: true });
	let partial = await partialHandle.getFile();
	if (partial.size > file.size_bytes) {
		await partials.removeEntry(partialName);
		await partials.removeEntry(etagName).catch(() => undefined);
		partial = await (await partials.getFileHandle(partialName, { create: true })).getFile();
	}
	const hash = sha256.create();
	let received = await hashExistingPartial(partial, hash, signal);
	reportModelProgress(modelID, file.path, completedBefore, received, totalBytes, onProgress);
	if (received < file.size_bytes) {
		const headers = new Headers(request.headers);
		if (received > 0) {
			headers.set('Range', `bytes=${received}-`);
			const etag = await readPartialETag(partials, etagName);
			if (etag) headers.set('If-Range', etag);
		}
		const response = await fetch(new Request(request, { headers }), { signal });
		if (received > 0 && response.status !== 206) {
			await response.body?.cancel();
			await partials.removeEntry(partialName).catch(() => undefined);
			await partials.removeEntry(etagName).catch(() => undefined);
			const freshHandle = await partials.getFileHandle(partialName, { create: true });
			partial = await freshHandle.getFile();
			received = 0;
			hash.destroy();
			return await downloadAndVerifyIntoCache(
				cache,
				request,
				file,
				modelID,
				completedBefore,
				totalBytes,
				onProgress,
				signal
			);
		}
		if (!response.ok || !response.body) {
			throw new Error(`The ${modelID} model download failed at ${file.path}.`);
		}
		const responseETag = response.headers.get('ETag');
		if (responseETag) await writePartialETag(partials, etagName, responseETag);
		const currentHandle = await partials.getFileHandle(partialName);
		const writable = await currentHandle.createWritable({ keepExistingData: true });
		const reader = response.body.getReader();
		try {
			await writable.seek(received);
			while (true) {
				signal?.throwIfAborted();
				const { done, value } = await reader.read();
				if (done) break;
				if (!value.byteLength) continue;
				hash.update(value);
				await writable.write(value);
				received += value.byteLength;
				reportModelProgress(modelID, file.path, completedBefore, received, totalBytes, onProgress);
			}
			await writable.close();
		} catch (cause) {
			await reader.cancel(cause).catch(() => undefined);
			await writable.close().catch(async () => {
				await writable.abort(cause).catch(() => undefined);
			});
			throw cause;
		} finally {
			reader.releaseLock();
		}
	}
	const digest = toHex(hash.digest());
	const completed = await (await partials.getFileHandle(partialName)).getFile();
	if (
		received !== file.size_bytes ||
		completed.size !== file.size_bytes ||
		digest !== file.sha256
	) {
		await partials.removeEntry(partialName).catch(() => undefined);
		await partials.removeEntry(etagName).catch(() => undefined);
		throw new Error(`The ${modelID} model failed its SHA-256 integrity check.`);
	}
	try {
		await cache.put(
			request,
			new Response(completed.stream(), {
				status: 200,
				headers: {
					'Content-Type': modelContentType(file.path),
					'Content-Length': String(file.size_bytes),
					'X-OpenPost-SHA256': file.sha256
				}
			})
		);
	} catch (cause) {
		await cache.delete(request);
		throw cause;
	}
	await partials.removeEntry(partialName).catch(() => undefined);
	await partials.removeEntry(etagName).catch(() => undefined);
}

async function modelPartialDirectory(): Promise<FileSystemDirectoryHandle> {
	const storage = navigator.storage as StorageManager & {
		getDirectory?: () => Promise<FileSystemDirectoryHandle>;
	};
	if (!storage.getDirectory) throw new Error('Origin-private model storage is unavailable.');
	const root = await storage.getDirectory();
	const editorDirectory = await root.getDirectoryHandle('openpost-video-editor', { create: true });
	return await editorDirectory.getDirectoryHandle(MODEL_PARTIAL_DIRECTORY, { create: true });
}

async function hashExistingPartial(
	file: File,
	hash: ReturnType<typeof sha256.create>,
	signal?: AbortSignal
): Promise<number> {
	const reader = file.stream().getReader();
	let received = 0;
	try {
		while (true) {
			signal?.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) break;
			hash.update(value);
			received += value.byteLength;
		}
		return received;
	} finally {
		reader.releaseLock();
	}
}

async function readPartialETag(
	directory: FileSystemDirectoryHandle,
	name: string
): Promise<string | undefined> {
	try {
		const file = await (await directory.getFileHandle(name)).getFile();
		const value = (await file.text()).trim();
		return value || undefined;
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === 'NotFoundError') return undefined;
		throw cause;
	}
}

async function writePartialETag(
	directory: FileSystemDirectoryHandle,
	name: string,
	value: string
): Promise<void> {
	const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
	try {
		await writable.write(value);
		await writable.close();
	} catch (cause) {
		await writable.abort(cause).catch(() => undefined);
		throw cause;
	}
}

function reportModelProgress(
	modelID: string,
	fileName: string,
	completedBefore: number,
	received: number,
	totalBytes: number,
	onProgress?: (progress: ModelDownloadProgress) => void
): void {
	onProgress?.({
		model_id: modelID,
		file_name: fileName,
		completed_bytes: completedBefore + received,
		total_bytes: totalBytes,
		fraction: Math.min(1, (completedBefore + received) / totalBytes)
	});
}

function modelContentType(path: string): string {
	if (path.endsWith('.json')) return 'application/json';
	if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
	if (path.endsWith('.onnx')) return 'application/octet-stream';
	return 'application/octet-stream';
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
