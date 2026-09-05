import { mediaQueryKeys, type MediaStorage } from '@openpost/query-catalog';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { queryClient } from './query/client';
import {
	directUploadSupportedFromStorageResponse,
	directUploadHeadersForBrowser,
	directUploadRequestPolicy,
	normalizedUploadErrorMessage,
	shouldUseMultipartFallback,
	isTransientUploadError,
	withUploadRetry,
	UploadRequestError,
	uploadMediaFile
} from './media-upload-client';

describe('media-upload-client', () => {
	afterEach(() => {
		queryClient.clear();
		vi.unstubAllGlobals();
	});

	it('binds hash-deduplicated Project Asset uploads to their reservation', async () => {
		queryClient.setQueryData(mediaQueryKeys.storage('workspace-1'), {
			asset_count: 0,
			direct_upload_supported: true,
			internal_bytes: 0,
			limit_bytes: 0,
			used_bytes: 0
		} satisfies MediaStorage);
		let capturedRequest: RequestInit | undefined;
		const fetchMock = vi.fn((_input: RequestInfo | URL, request?: RequestInit) => {
			capturedRequest = request;
			return Promise.resolve(
				Response.json({
					media_id: 'server-media-1',
					deduped: true,
					complete_url: '/api/v1/media/upload-session/server-media-1/complete',
					upload: {
						method: 'PUT',
						url: '/api/v1/media/upload-session/server-media-1/content',
						headers: {},
						expires_at: '2026-09-05T00:00:00Z',
						object_key: 'server-media-1.mp4'
					}
				})
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		await uploadMediaFile({
			workspaceId: 'workspace-1',
			file: new File(['video'], 'launch.mp4', { type: 'video/mp4' }),
			source: 'video_editor_source',
			assetKind: 'project_asset',
			retentionClass: 'temporary',
			projectAssetId: 'project-asset-1',
			clientSHA256: 'a'.repeat(64),
			prepareVideo: false
		});

		expect(capturedRequest).toBeDefined();
		expect(JSON.parse(String(capturedRequest?.body))).toMatchObject({
			asset_kind: 'project_asset',
			client_sha256: 'a'.repeat(64),
			project_asset_id: 'project-asset-1',
			retention_class: 'temporary',
			source: 'video_editor_source'
		});
	});

	it('filters headers that browser uploads cannot set manually', () => {
		const headers = directUploadHeadersForBrowser({
			Host: 'uploads.openpost.test',
			'Content-Length': '12',
			'Content-Type': 'image/png',
			'x-amz-meta-workspace': 'ws-1'
		});

		expect(headers.has('Host')).toBe(false);
		expect(headers.has('Content-Length')).toBe(false);
		expect(headers.get('Content-Type')).toBe('image/png');
		expect(headers.get('x-amz-meta-workspace')).toBe('ws-1');
	});

	it('sends OpenPost credentials only to instance-hosted upload targets', () => {
		const openPostHeaders = new Headers({
			Authorization: 'Bearer op_cli_secret',
			'X-PostHog-Distinct-ID': 'browser-user-1',
			'X-PostHog-Session-ID': 'session-1'
		});
		const internal = directUploadRequestPolicy(
			'/api/v1/media/upload-session/media-1/content',
			{ 'Content-Type': 'video/mp4' },
			openPostHeaders
		);
		expect(internal.isExternal).toBe(false);
		expect(internal.withCredentials).toBe(true);
		expect(internal.headers.get('Authorization')).toBe('Bearer op_cli_secret');
		expect(internal.headers.get('X-PostHog-Distinct-ID')).toBe('browser-user-1');
		expect(internal.headers.get('X-PostHog-Session-ID')).toBe('session-1');

		const external = directUploadRequestPolicy(
			'https://bucket.example/media-1',
			{
				Authorization: 'Bearer must-not-leak',
				Cookie: 'openpost_session=must-not-leak',
				'Content-Type': 'video/mp4',
				'x-amz-meta-workspace': 'ws-1'
			},
			openPostHeaders
		);
		expect(external.isExternal).toBe(true);
		expect(external.withCredentials).toBe(false);
		expect(external.headers.has('Authorization')).toBe(false);
		expect(external.headers.has('Cookie')).toBe(false);
		expect(external.headers.has('X-PostHog-Distinct-ID')).toBe(false);
		expect(external.headers.has('X-PostHog-Session-ID')).toBe(false);
		expect(external.headers.get('Content-Type')).toBe('video/mp4');
		expect(external.headers.get('x-amz-meta-workspace')).toBe('ws-1');

		const protocolRelative = directUploadRequestPolicy(
			'//bucket.example/media-1',
			{},
			openPostHeaders
		);
		expect(protocolRelative.isExternal).toBe(true);
		expect(protocolRelative.headers.has('Authorization')).toBe(false);
	});

	it('uses multipart uploads only when the storage capability explicitly disables upload sessions', () => {
		expect(directUploadSupportedFromStorageResponse({ direct_upload_supported: false })).toBe(
			false
		);
		expect(directUploadSupportedFromStorageResponse({ direct_upload_supported: true })).toBe(true);
		expect(directUploadSupportedFromStorageResponse({})).toBe(true);
	});

	it('stops before upload work when storage capability lookup is cancelled', async () => {
		queryClient.setQueryData(mediaQueryKeys.storage('workspace-1'), {
			asset_count: 0,
			direct_upload_supported: true,
			internal_bytes: 0,
			limit_bytes: 0,
			used_bytes: 0
		} satisfies MediaStorage);
		const controller = new AbortController();
		const onProgress = vi.fn();
		controller.abort();

		await expect(
			uploadMediaFile({
				workspaceId: 'workspace-1',
				file: new File(['content'], 'post.txt', { type: 'text/plain' }),
				onProgress,
				signal: controller.signal
			})
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(onProgress).not.toHaveBeenCalled();
	});

	it('falls back only when direct upload sessions are unavailable', () => {
		expect(shouldUseMultipartFallback(new UploadRequestError('missing route', 404))).toBe(true);
		expect(
			shouldUseMultipartFallback(
				new UploadRequestError('direct media upload sessions require s3 storage', 400)
			)
		).toBe(true);
		expect(
			shouldUseMultipartFallback(new UploadRequestError('media_bytes_stored limit exceeded', 400))
		).toBe(false);
	});

	it('normalizes JSON upload problems without exposing serialized response bodies', () => {
		expect(
			normalizedUploadErrorMessage(
				JSON.stringify({ title: 'Upload failed', detail: 'This image exceeds the limit.' }),
				'application/problem+json',
				'Upload failed',
				413
			)
		).toBe('This image exceeds the limit.');
		expect(
			normalizedUploadErrorMessage(
				JSON.stringify({ unexpected: true }),
				'application/json',
				'Upload failed',
				422
			)
		).toBe('Upload failed (422)');
		expect(
			normalizedUploadErrorMessage(
				JSON.stringify({ detail: 'Upload quota reached.' }),
				null,
				'Upload failed',
				429
			)
		).toBe('Upload quota reached.');
		expect(
			normalizedUploadErrorMessage('Temporary upload failure', 'text/plain', 'Upload failed', 503)
		).toBe('Temporary upload failure');
	});

	it('classifies transient upload errors for retry', () => {
		expect(isTransientUploadError(new UploadRequestError('server error', 500))).toBe(true);
		expect(isTransientUploadError(new UploadRequestError('bad gateway', 502))).toBe(true);
		expect(isTransientUploadError(new UploadRequestError('unavailable', 503))).toBe(true);
		expect(isTransientUploadError(new UploadRequestError('gateway timeout', 504))).toBe(true);
		expect(isTransientUploadError(new UploadRequestError('timeout', 408))).toBe(true);
		expect(isTransientUploadError(new UploadRequestError('rate limited', 429))).toBe(true);
		expect(isTransientUploadError(new UploadRequestError('not found', 404))).toBe(false);
		expect(isTransientUploadError(new UploadRequestError('bad request', 400))).toBe(false);
		expect(isTransientUploadError(new TypeError('Failed to fetch'))).toBe(true);
		expect(isTransientUploadError(new DOMException('Aborted', 'AbortError'))).toBe(false);
	});
});

describe('withUploadRetry', () => {
	let originalWindow: typeof globalThis.window;

	beforeEach(() => {
		originalWindow = globalThis.window;
		// Provide a minimal window so abortableDelay works in server-side tests.
		const windowStub = { setTimeout, clearTimeout };
		// SAFETY: windowStub provides only the two timer functions abortableDelay
		// reads from window; no other window members are observed.
		(globalThis as { window?: unknown }).window = windowStub;
	});

	afterEach(() => {
		globalThis.window = originalWindow;
	});

	it('retries transient failures and succeeds', async () => {
		let attempts = 0;
		const result = await withUploadRetry(async () => {
			attempts++;
			if (attempts < 3) throw new UploadRequestError('server error', 500);
			return 'ok';
		});
		expect(result).toBe('ok');
		expect(attempts).toBe(3);
	});

	it('stops retrying after max attempts', async () => {
		let attempts = 0;
		await expect(
			withUploadRetry(async () => {
				attempts++;
				throw new UploadRequestError('server error', 500);
			})
		).rejects.toThrow('server error');
		expect(attempts).toBe(3);
	});

	it('does not retry non-transient errors', async () => {
		let attempts = 0;
		await expect(
			withUploadRetry(async () => {
				attempts++;
				throw new UploadRequestError('bad request', 400);
			})
		).rejects.toThrow('bad request');
		expect(attempts).toBe(1);
	});
});
