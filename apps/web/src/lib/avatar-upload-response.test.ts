import { describe, expect, it } from 'vitest';
import { parseAvatarUploadErrorDetail, parseAvatarUploadResponse } from './avatar-upload-response';

describe('avatar upload responses', () => {
	it('returns a trimmed avatar URL from a successful response', () => {
		expect(parseAvatarUploadResponse('{"avatar_url":" /api/avatar "}')).toEqual({
			avatar_url: '/api/avatar'
		});
	});

	it('ignores malformed response fields', () => {
		expect(parseAvatarUploadResponse('{"avatar_url":42}')).toEqual({});
		expect(parseAvatarUploadErrorDetail('{"detail":{"message":"private"}}')).toBeUndefined();
	});

	it('uses the first non-empty public error field', () => {
		expect(parseAvatarUploadErrorDetail('{"detail":" ","error":"Upload denied"}')).toBe(
			'Upload denied'
		);
	});
});
