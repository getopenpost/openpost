import { describe, expect, it } from 'vitest';
import {
	directUploadHeadersForBrowser,
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
});
