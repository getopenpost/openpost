import { describe, expect, it } from 'vitest';
import type { MediaMetadata } from './types';
import {
	fitReverseConformSize,
	reverseConformKey,
	sourceSecondsToReverseConformSeconds
} from './reverse-conform-service';

function media(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
	return {
		id: 'media',
		storageType: 'workspace',
		contentHash: 'sha256-source',
		fileName: 'source.mp4',
		fileSize: 100,
		mimeType: 'video/mp4',
		duration: 12,
		width: 3840,
		height: 2160,
		fps: 60,
		codec: 'avc',
		bitrate: 1_000_000,
		tags: ['video'],
		...overrides
	};
}

describe('reverse conform planning', () => {
	it('keys the cache by source fingerprint, fps, and preview geometry', () => {
		const baseline = reverseConformKey(media());
		expect(reverseConformKey(media())).toBe(baseline);
		expect(reverseConformKey(media({ contentHash: 'different' }))).not.toBe(baseline);
		expect(reverseConformKey(media({ fps: 30 }))).not.toBe(baseline);
		expect(reverseConformKey(media({ width: 1920, height: 1080 }))).toBe(baseline);
	});

	it('maps original source time into the forward-playing reverse conform', () => {
		const conform = { durationFrames: 120, fps: 30 };
		expect(sourceSecondsToReverseConformSeconds(conform, 119 / 30)).toBe(0);
		expect(sourceSecondsToReverseConformSeconds(conform, 0)).toBeCloseTo(119 / 30);
	});
});
