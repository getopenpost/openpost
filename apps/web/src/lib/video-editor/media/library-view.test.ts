import { describe, expect, it } from 'vitest';
import {
	countUnsupportedCodecMedia,
	hasMediaHealthIssues,
	type MediaHealthCounts
} from './library-view';
import type { MediaMetadata } from './types';

function media(id: string, audioCodecSupported?: boolean): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: `${id}.mp4`,
		mimeType: 'video/mp4',
		fileSize: 1024,
		duration: 10,
		width: 1920,
		height: 1080,
		fps: 30,
		bitrate: 1_000_000,
		codec: 'avc1',
		audioCodecSupported,
		tags: ['video']
	};
}

describe('countUnsupportedCodecMedia', () => {
	it('counts only items the browser cannot decode', () => {
		const items = [media('ok'), media('bad', false), media('unknown'), media('bad2', false)];
		expect(countUnsupportedCodecMedia(items)).toBe(2);
	});

	it('returns zero when every codec is supported', () => {
		expect(countUnsupportedCodecMedia([media('a'), media('b', true)])).toBe(0);
	});
});

describe('hasMediaHealthIssues', () => {
	it('is false when every count is zero', () => {
		const counts: MediaHealthCounts = { missing: 0, proxyPending: 0, unsupportedCodec: 0 };
		expect(hasMediaHealthIssues(counts)).toBe(false);
	});

	it('is true when any single count is positive', () => {
		expect(hasMediaHealthIssues({ missing: 1, proxyPending: 0, unsupportedCodec: 0 })).toBe(true);
		expect(hasMediaHealthIssues({ missing: 0, proxyPending: 2, unsupportedCodec: 0 })).toBe(true);
		expect(hasMediaHealthIssues({ missing: 0, proxyPending: 0, unsupportedCodec: 3 })).toBe(true);
	});
});
