import { describe, expect, it } from 'vitest';
import {
	directUploadSupportedFromStorageResponse,
	directUploadHeadersForBrowser,
	directUploadRequestPolicy,
	normalizedUploadErrorMessage,
	shouldUseMultipartFallback,
	UploadRequestError
} from './media-upload-client';

describe('media-upload-client', () => {
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
});
