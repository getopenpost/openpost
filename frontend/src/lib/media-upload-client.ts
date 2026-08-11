import { applyAPIRequestHeaders } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { getApiBase } from '$lib/stores/instance.svelte';
import type { VideoConstraint, VideoPreparationProgress } from '$lib/video/types';
import type { StockMediaProvenance } from '@openpost/video-project';
import { isSVGFile, rasterizeSVGToPNG } from '$lib/media/svg-rasterize';
import { m } from '$lib/paraglide/messages';

export type MediaUploadResult = components['schemas']['MediaUploadResult'];

export interface UploadMediaFileOptions {
	workspaceId: string;
	file: File;
	altText?: string;
	source?:
		| 'upload'
		| 'camera'
		| 'image_editor_export'
		| 'image_editor_edit'
		| 'background_removal'
		| 'video_editor_source'
		| 'video_editor_export'
		| 'stock_import'
		| 'meme_generator';
	assetKind?: 'library' | 'brand_asset' | 'brand_font' | 'design_preview' | 'template_preview';
	retentionClass?: 'library' | 'temporary';
	tagId?: string;
	parentMediaId?: string;
	designDocumentId?: string;
	designPageId?: string;
	videoProjectId?: string;
	clientSHA256?: string;
	stockProvenance?: StockMediaProvenance;
	prepareVideo?: boolean;
	videoConstraints?: VideoConstraint[];
	onProgress?: (progress: VideoPreparationProgress) => void;
	signal?: AbortSignal;
}

interface UploadProblem {
	detail?: string;
	error?: string;
	title?: string;
}

const directUploadCapabilityByWorkspace = new Map<string, Promise<boolean>>();

export class UploadRequestError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'UploadRequestError';
		this.status = status;
	}
}

export async function uploadMediaFile({
	workspaceId,
	file,
	altText = '',
	source = 'upload',
	assetKind = 'library',
	retentionClass = 'library',
	tagId = '',
	parentMediaId = '',
	designDocumentId = '',
	designPageId = '',
	videoProjectId = '',
	clientSHA256 = '',
	stockProvenance,
	prepareVideo = true,
	videoConstraints = [],
	onProgress,
	signal
}: UploadMediaFileOptions): Promise<MediaUploadResult> {
	let uploadFile = file;
	if (isSVGFile(file)) {
		try {
			uploadFile = await rasterizeSVGToPNG(file);
		} catch {
			throw new Error(m.media_svg_conversion_failed());
		}
	}
	if (prepareVideo && (file.type.startsWith('video/') || looksLikeVideo(file.name))) {
		const { prepareVideoForUpload } = await import('$lib/video/prepare');
		const prepared = await prepareVideoForUpload(file, videoConstraints, onProgress, signal);
		uploadFile = prepared.file;
	}
	const metadata = {
		source,
		assetKind,
		retentionClass,
		tagId,
		parentMediaId,
		designDocumentId,
		designPageId,
		videoProjectId,
		clientSHA256,
		stockProvenance
	};
	if (!(await mediaStorageSupportsDirectUploads(workspaceId))) {
		return uploadViaMultipart(workspaceId, uploadFile, altText, metadata, onProgress, signal);
	}
	try {
		return await uploadViaDirectSession(
			workspaceId,
			uploadFile,
			altText,
			metadata,
			onProgress,
			signal
		);
	} catch (error) {
		if (!shouldUseMultipartFallback(error)) {
			throw error;
		}
		return uploadViaMultipart(workspaceId, uploadFile, altText, metadata, onProgress, signal);
	}
}

export function isSupportedMediaFile(file: File): boolean {
	return (
		file.type.startsWith('image/') ||
		file.type.startsWith('video/') ||
		file.type.startsWith('audio/') ||
		[
			'application/pdf',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/vnd.ms-powerpoint',
			'application/vnd.openxmlformats-officedocument.presentationml.presentation'
		].includes(file.type)
	);
}

export function shouldUseMultipartFallback(error: unknown): boolean {
	if (!(error instanceof UploadRequestError)) {
		return false;
	}
	if (error.status === 404 || error.status === 405) {
		return true;
	}
	return error.message.toLowerCase().includes('direct media upload sessions require s3 storage');
}

export function directUploadSupportedFromStorageResponse(value: unknown): boolean {
	if (!value || typeof value !== 'object') return true;
	return (value as { direct_upload_supported?: unknown }).direct_upload_supported !== false;
}

export function directUploadHeadersForBrowser(headers: Record<string, string>): Headers {
	const directHeaders = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (!value || isForbiddenBrowserUploadHeader(key)) {
			continue;
		}
		directHeaders.set(key, value);
	}
	return directHeaders;
}

export function directUploadRequestPolicy(
	uploadURL: string,
	returnedHeaders: Record<string, string>,
	openPostHeaders: Headers
): { headers: Headers; isExternal: boolean; withCredentials: boolean } {
	const headers = directUploadHeadersForBrowser(returnedHeaders);
	const isExternal = !uploadURL.startsWith('/') || uploadURL.startsWith('//');
	if (isExternal) {
		for (const sensitiveHeader of ['Authorization', 'Cookie', 'Proxy-Authorization']) {
			headers.delete(sensitiveHeader);
		}
	} else {
		for (const [key, value] of openPostHeaders) {
			if (!headers.has(key)) headers.set(key, value);
		}
	}
	return { headers, isExternal, withCredentials: !isExternal };
}

export function normalizedUploadErrorMessage(
	body: string,
	contentType: string | null,
	fallback: string,
	status: number
): string {
	const fallbackWithStatus = status > 0 ? `${fallback} (${status})` : fallback;
	const trimmed = body.trim();
	if (!trimmed) return fallbackWithStatus;
	const looksLikeJSON =
		(contentType ?? '').toLowerCase().includes('json') || trimmed.startsWith('{');
	if (!looksLikeJSON) return trimmed;
	try {
		const problem = JSON.parse(trimmed) as UploadProblem;
		for (const value of [problem.detail, problem.error, problem.title]) {
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
	} catch {
		// Invalid JSON is an invalid problem response, not useful user-facing copy.
	}
	return fallbackWithStatus;
}

async function mediaStorageSupportsDirectUploads(workspaceId: string): Promise<boolean> {
	const cacheKey = `${getApiBase()}:${workspaceId}`;
	const cached = directUploadCapabilityByWorkspace.get(cacheKey);
	if (cached) return cached;

	const request = fetch(apiURL(`/media/storage?workspace_id=${encodeURIComponent(workspaceId)}`), {
		credentials: 'include',
		headers: apiHeaders(false)
	})
		.then(async (response) => {
			if (!response.ok) return true;
			return directUploadSupportedFromStorageResponse(await response.json());
		})
		.catch(() => true);
	directUploadCapabilityByWorkspace.set(cacheKey, request);
	return request;
}

async function uploadViaDirectSession(
	workspaceId: string,
	file: File,
	altText: string,
	metadata: {
		source: NonNullable<UploadMediaFileOptions['source']>;
		assetKind: NonNullable<UploadMediaFileOptions['assetKind']>;
		retentionClass: NonNullable<UploadMediaFileOptions['retentionClass']>;
		tagId: string;
		parentMediaId: string;
		designDocumentId: string;
		designPageId: string;
		videoProjectId: string;
		clientSHA256: string;
		stockProvenance?: StockMediaProvenance;
	},
	onProgress?: (progress: VideoPreparationProgress) => void,
	signal?: AbortSignal
): Promise<MediaUploadResult> {
	onProgress?.({ stage: 'uploading', fraction: 0, message: 'Starting upload' });
	const sessionResp = await fetch(apiURL('/media/upload-session'), {
		method: 'POST',
		credentials: 'include',
		headers: apiHeaders(true),
		signal,
		body: JSON.stringify({
			workspace_id: workspaceId,
			filename: file.name,
			mime_type: file.type || 'application/octet-stream',
			size: file.size,
			...(altText ? { alt_text: altText } : {}),
			source: metadata.source,
			asset_kind: metadata.assetKind,
			retention_class: metadata.retentionClass,
			...(metadata.tagId ? { tag_id: metadata.tagId } : {}),
			...(metadata.parentMediaId ? { parent_media_id: metadata.parentMediaId } : {}),
			...(metadata.designDocumentId ? { design_document_id: metadata.designDocumentId } : {}),
			...(metadata.designPageId ? { design_page_id: metadata.designPageId } : {}),
			...(metadata.videoProjectId ? { video_project_id: metadata.videoProjectId } : {}),
			...(metadata.clientSHA256 ? { client_sha256: metadata.clientSHA256 } : {}),
			...(metadata.stockProvenance ? { stock_provenance: metadata.stockProvenance } : {})
		})
	});
	if (!sessionResp.ok) {
		throw await uploadErrorFromResponse(sessionResp, 'Failed to create upload session');
	}

	const session =
		(await sessionResp.json()) as components['schemas']['CreateMediaUploadSessionOutputBody'];
	if (session.deduped) {
		onProgress?.({ stage: 'finalizing', fraction: 1, message: 'Existing media reused' });
		return {
			id: session.media_id,
			mime_type: file.type || 'application/octet-stream',
			url: `/media/${session.media_id}`,
			size: file.size,
			deduped: true,
			alt_text: altText,
			original_filename: file.name,
			source: metadata.source,
			asset_kind: metadata.assetKind,
			retention_class: metadata.retentionClass,
			processing_status: 'ready',
			processing_progress: 100,
			analysis_status: 'ready',
			...(metadata.videoProjectId ? { video_project_id: metadata.videoProjectId } : {})
		};
	}
	const uploadRequest = directUploadRequestPolicy(
		session.upload.url,
		session.upload.headers ?? {},
		apiHeaders(false)
	);
	const uploadHeaders = uploadRequest.headers;
	if (!uploadHeaders.has('Content-Type') && file.type) {
		uploadHeaders.set('Content-Type', file.type);
	}
	await putBlobWithProgress(
		uploadRequest.isExternal ? session.upload.url : apiURL(session.upload.url),
		session.upload.method || 'PUT',
		uploadHeaders,
		file,
		uploadRequest.withCredentials,
		(fraction) => onProgress?.({ stage: 'uploading', fraction, message: 'Uploading video' }),
		signal
	);

	onProgress?.({ stage: 'finalizing', fraction: 0.96, message: 'Finalizing upload' });
	const completeResp = await fetch(apiURL(session.complete_url), {
		method: 'POST',
		credentials: 'include',
		headers: apiHeaders(true),
		signal,
		body: JSON.stringify({ workspace_id: workspaceId })
	});
	if (!completeResp.ok) {
		throw await uploadErrorFromResponse(completeResp, 'Failed to finalize media upload');
	}
	const result = (await completeResp.json()) as MediaUploadResult;
	return waitForVideoProcessing(workspaceId, result, onProgress, signal);
}

async function uploadViaMultipart(
	workspaceId: string,
	file: File,
	altText: string,
	metadata: {
		source: NonNullable<UploadMediaFileOptions['source']>;
		assetKind: NonNullable<UploadMediaFileOptions['assetKind']>;
		retentionClass: NonNullable<UploadMediaFileOptions['retentionClass']>;
		tagId: string;
		parentMediaId: string;
		designDocumentId: string;
		designPageId: string;
		videoProjectId: string;
		clientSHA256: string;
		stockProvenance?: StockMediaProvenance;
	},
	onProgress?: (progress: VideoPreparationProgress) => void,
	signal?: AbortSignal
): Promise<MediaUploadResult> {
	const formData = new FormData();
	formData.append('file', file);
	formData.append('workspace_id', workspaceId);
	if (altText) {
		formData.append('alt_text', altText);
	}
	formData.append('source', metadata.source);
	formData.append('asset_kind', metadata.assetKind);
	formData.append('retention_class', metadata.retentionClass);
	if (metadata.tagId) formData.append('tag_id', metadata.tagId);
	if (metadata.parentMediaId) formData.append('parent_media_id', metadata.parentMediaId);
	if (metadata.designDocumentId) formData.append('design_document_id', metadata.designDocumentId);
	if (metadata.designPageId) formData.append('design_page_id', metadata.designPageId);
	if (metadata.videoProjectId) formData.append('video_project_id', metadata.videoProjectId);
	if (metadata.stockProvenance) {
		formData.append('stock_provenance', JSON.stringify(metadata.stockProvenance));
	}

	onProgress?.({ stage: 'uploading', fraction: 0, message: 'Starting upload' });
	const response = await uploadFormWithProgress(
		apiURL('/media/upload'),
		formData,
		(fraction) => onProgress?.({ stage: 'uploading', fraction, message: 'Uploading video' }),
		signal
	);
	return waitForVideoProcessing(workspaceId, response as MediaUploadResult, onProgress, signal);
}

function apiURL(path: string): string {
	if (path.startsWith('http://') || path.startsWith('https://')) {
		return path;
	}
	const apiPath = path.startsWith('/api/v1/') ? path.slice('/api/v1'.length) : path;
	return `${getApiBase()}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
}

function apiHeaders(json: boolean): Headers {
	const headers = applyAPIRequestHeaders(new Headers());
	if (json) {
		headers.set('Content-Type', 'application/json');
	}
	return headers;
}

async function uploadErrorFromResponse(
	response: Response,
	fallback: string
): Promise<UploadRequestError> {
	const message = normalizedUploadErrorMessage(
		await response.text(),
		response.headers.get('Content-Type'),
		fallback,
		response.status
	);
	return new UploadRequestError(message, response.status);
}

function isForbiddenBrowserUploadHeader(header: string): boolean {
	const normalized = header.toLowerCase();
	return normalized === 'host' || normalized === 'content-length';
}

function looksLikeVideo(filename: string): boolean {
	return /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg)$/i.test(filename);
}

async function waitForVideoProcessing(
	workspaceId: string,
	result: MediaUploadResult,
	onProgress?: (progress: VideoPreparationProgress) => void,
	signal?: AbortSignal
): Promise<MediaUploadResult> {
	type ProcessedResult = MediaUploadResult & {
		processing_status?: string;
		processing_progress?: number;
		analysis_status?: string;
		analysis_error?: string;
		poster_thumbnail_url?: string;
	};
	type MetadataResponse = {
		media?: Array<{
			id: string;
			processing_status?: string;
			processing_progress?: number;
			analysis_status?: string;
			analysis_error?: string;
			poster_thumbnail_url?: string;
		}>;
	};

	let current = result as ProcessedResult;
	if (!current.mime_type.startsWith('video/') || current.processing_status !== 'processing') {
		return result;
	}

	const deadline = Date.now() + 2 * 60 * 1000;
	while (Date.now() < deadline) {
		assertUploadNotAborted(signal);
		onProgress?.({
			stage: 'processing',
			fraction: Math.max(0, Math.min(1, (current.processing_progress ?? 0) / 100)),
			message: 'Checking video compatibility'
		});
		await abortableDelay(650, signal);
		const params = new URLSearchParams({
			workspace_id: workspaceId,
			media_ids: current.id
		});
		const response = await fetch(apiURL(`/media/metadata?${params.toString()}`), {
			credentials: 'include',
			headers: apiHeaders(false),
			signal
		});
		if (!response.ok) throw await uploadErrorFromResponse(response, 'Failed to check video');
		const metadata = ((await response.json()) as MetadataResponse).media?.find(
			(item) => item.id === current.id
		);
		if (!metadata) throw new UploadRequestError('Uploaded video could not be found', 404);
		current = { ...current, ...metadata };
		if (metadata.processing_status === 'ready' && metadata.analysis_status === 'ready') {
			onProgress?.({ stage: 'processing', fraction: 1, message: 'Video is ready' });
			return current;
		}
		if (metadata.processing_status === 'failed' || metadata.analysis_status === 'failed') {
			throw new UploadRequestError(
				metadata.analysis_error || 'OpenPost could not process this video',
				422
			);
		}
	}
	throw new UploadRequestError(
		'Video processing is taking longer than expected. It remains in Media and can be retried there.',
		408
	);
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const timer = window.setTimeout(() => {
			signal?.removeEventListener('abort', abort);
			resolve();
		}, milliseconds);
		const abort = () => {
			window.clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', abort, { once: true });
	});
}

function assertUploadNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function putBlobWithProgress(
	url: string,
	method: string,
	headers: Headers,
	body: Blob,
	withCredentials: boolean,
	onProgress: (fraction: number) => void,
	signal?: AbortSignal
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const xhr = new XMLHttpRequest();
		xhr.open(method, url);
		xhr.withCredentials = withCredentials;
		headers.forEach((value, key) => xhr.setRequestHeader(key, value));
		const abort = () => xhr.abort();
		signal?.addEventListener('abort', abort, { once: true });
		const cleanup = () => signal?.removeEventListener('abort', abort);
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
		};
		xhr.onload = () => {
			cleanup();
			if (xhr.status >= 200 && xhr.status < 300) {
				onProgress(1);
				resolve();
				return;
			}
			reject(
				new UploadRequestError(
					normalizedUploadErrorMessage(
						xhr.responseText,
						xhr.getResponseHeader('Content-Type'),
						'Media upload failed',
						xhr.status
					),
					xhr.status
				)
			);
		};
		xhr.onerror = () => {
			cleanup();
			reject(new UploadRequestError('Network error while uploading media', 0));
		};
		xhr.onabort = () => {
			cleanup();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		xhr.send(body);
	});
}

function uploadFormWithProgress(
	url: string,
	body: FormData,
	onProgress: (fraction: number) => void,
	signal?: AbortSignal
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url);
		xhr.withCredentials = true;
		for (const [key, value] of apiHeaders(false)) xhr.setRequestHeader(key, value);
		const abort = () => xhr.abort();
		signal?.addEventListener('abort', abort, { once: true });
		const cleanup = () => signal?.removeEventListener('abort', abort);
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
		};
		xhr.onload = () => {
			cleanup();
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(
					new UploadRequestError(
						normalizedUploadErrorMessage(
							xhr.responseText,
							xhr.getResponseHeader('Content-Type'),
							'Upload failed',
							xhr.status
						),
						xhr.status
					)
				);
				return;
			}
			try {
				onProgress(1);
				resolve(JSON.parse(xhr.responseText));
			} catch {
				reject(new UploadRequestError('The upload response was invalid', xhr.status));
			}
		};
		xhr.onerror = () => {
			cleanup();
			reject(new UploadRequestError('Network error while uploading media', 0));
		};
		xhr.onabort = () => {
			cleanup();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		xhr.send(body);
	});
}
