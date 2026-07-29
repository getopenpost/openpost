import { sha256 } from '@noble/hashes/sha256';
import type { VideoStudioConfig } from './api';
import {
	listModelCacheMetadata,
	removeModelCacheMetadata,
	saveModelCacheMetadata
} from './storage';
import type { ModelCacheMetadata } from './types';

const TRANSFORMERS_CACHE = 'transformers-cache';

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

export async function ensureVideoStudioModel(
	config: VideoStudioConfig,
	modelID: string,
	onProgress?: (progress: ModelDownloadProgress) => void,
	signal?: AbortSignal
): Promise<{ model: StaticModel; baseURL: string }> {
	const advertised = config.model_manifest?.find((item) => item.id === modelID);
	if (!advertised)
		throw new Error(`The ${modelID} model is not available on this OpenPost instance.`);
	const baseURL = advertised.url.replace(/\/[^/]+$/u, '');
	const response = await fetch(`${baseURL}/manifest.json`, { signal });
	if (!response.ok) throw new Error('The local Video Studio model manifest could not be loaded.');
	const manifest = (await response.json()) as StaticModelManifest;
	const model = manifest.models.find((item) => item.id === modelID);
	if (!model) throw new Error(`The ${modelID} model is missing from the local model manifest.`);
	if (
		model.version !== advertised.version ||
		model.size_bytes !== advertised.size_bytes ||
		model.sha256 !== advertised.sha256
	) {
		throw new Error('The advertised Video Studio model does not match its pinned manifest.');
	}

	const cache = await caches.open(TRANSFORMERS_CACHE);
	let completedBytes = 0;
	for (const file of model.files) {
		signal?.throwIfAborted();
		const url = new URL(`${baseURL}/${file.path}`, location.href).href;
		const request = new Request(url);
		const cached = await cache.match(request);
		if (!cached) {
			const downloaded = await downloadAndVerify(
				request,
				file,
				modelID,
				completedBytes,
				model.size_bytes,
				onProgress,
				signal
			);
			await cache.put(request, downloaded);
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

export async function removeVideoStudioModel(
	config: VideoStudioConfig,
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

export async function cachedVideoStudioModels(): Promise<ModelCacheMetadata[]> {
	return await listModelCacheMetadata();
}

async function downloadAndVerify(
	request: Request,
	file: StaticModelFile,
	modelID: string,
	completedBefore: number,
	totalBytes: number,
	onProgress?: (progress: ModelDownloadProgress) => void,
	signal?: AbortSignal
): Promise<Response> {
	const response = await fetch(request, { signal });
	if (!response.ok || !response.body) {
		throw new Error(`The ${modelID} model download failed at ${file.path}.`);
	}
	const reader = response.body.getReader();
	const hash = sha256.create();
	const chunks: Uint8Array[] = [];
	let received = 0;
	while (true) {
		signal?.throwIfAborted();
		const { done, value } = await reader.read();
		if (done) break;
		hash.update(value);
		chunks.push(value);
		received += value.byteLength;
		onProgress?.({
			model_id: modelID,
			file_name: file.path,
			completed_bytes: completedBefore + received,
			total_bytes: totalBytes,
			fraction: Math.min(1, (completedBefore + received) / totalBytes)
		});
	}
	if (received !== file.size_bytes || toHex(hash.digest()) !== file.sha256) {
		throw new Error(`The ${modelID} model failed its SHA-256 integrity check.`);
	}
	return new Response(new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer)), {
		headers: {
			'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
			'Content-Length': String(received)
		}
	});
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
